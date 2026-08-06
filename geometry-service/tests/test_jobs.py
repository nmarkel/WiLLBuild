"""Async job layer + cache tests (Workstream A).

Covers:
  * POST /jobs validation parity with /generate (422 on invalid config)
  * job lifecycle pending → done with progress/stage/files
  * standalone-only-pdf rule enforced on /jobs
  * 404 for unknown jobId
  * cache hit: a second identical request is served from disk (cached=true)
    WITHOUT re-running the adapter (proven by unchanged file mtime).
"""

from __future__ import annotations

import time
import uuid

from fastapi.testclient import TestClient

from app.catalog import load_catalog
from app.main import OUT_DIR, app
from app.models import GenerateRequest
from app.naming import base_name

from .conftest import first_base_cover_for

client = TestClient(app)

_BC_ALUM20 = first_base_cover_for(load_catalog(), "alum-pole-20")


def _cfg(config_id: str) -> dict:
    return {
        "configId": config_id,
        "pole": "alum-pole-20",
        "baseCover": _BC_ALUM20,
        "arm": "sh1-shepherds-hook",
        "fixture": "gvx-pendant",
        "finish": "matte-black",
        "rev": 1,
    }


def _unique_config_id(prefix: str) -> str:
    """A configId whose entropy lands within the first 8 chars.

    ``base_name`` keys the on-disk cache on ``configId[:8]`` (plus the geometry
    hash), so the random part MUST sit inside that slice — a longer descriptive
    prefix (e.g. ``"job-life-"``) would be truncated away, collapsing every run
    to the same base_name and colliding with artifacts left in the persistent
    ``out/`` dir from earlier runs.  Keep the prefix short and front-load the uuid.
    """
    return f"{prefix}{uuid.uuid4().hex}"[:8]


def _clear_cache(cfg: dict) -> None:
    """Delete any on-disk artifacts for this config so the next job is a
    guaranteed cold-cache miss, independent of prior test runs (``out/`` is a
    persistent directory that is not reset between suite invocations)."""
    bn = base_name({}, GenerateRequest(config=cfg, formats=["step"]).config)
    for path in OUT_DIR.glob(f"{bn}*"):
        path.unlink()


def _poll_until_done(job_id: str, timeout: float = 60.0) -> dict:
    """Poll GET /jobs/{id} until status is done or error (or timeout)."""
    deadline = time.time() + timeout
    body: dict = {}
    while time.time() < deadline:
        resp = client.get(f"/jobs/{job_id}")
        assert resp.status_code == 200
        body = resp.json()
        if body["status"] in ("done", "error"):
            return body
        time.sleep(0.2)
    raise AssertionError(f"job {job_id} did not finish; last={body}")


class TestJobValidation:
    def test_invalid_config_returns_422_string_detail(self) -> None:
        resp = client.post(
            "/jobs",
            json={"config": _cfg("bad") | {"fixture": "nope"}, "formats": ["step"]},
        )
        assert resp.status_code == 422
        assert isinstance(resp.json()["detail"], str)

    def test_standalone_non_pdf_returns_422(self) -> None:
        standalone = {
            "configId": "sa-job",
            "pole": "",
            "baseCover": "",
            "arm": "",
            "fixture": "gvx-pendant",
            "finish": "matte-black",
            "rev": 1,
        }
        resp = client.post("/jobs", json={"config": standalone, "formats": ["step"]})
        assert resp.status_code == 422

    def test_unknown_job_id_returns_404(self) -> None:
        resp = client.get("/jobs/does-not-exist")
        assert resp.status_code == 404


class TestJobLifecycle:
    def test_pending_then_done_with_files(self) -> None:
        cfg = _cfg(_unique_config_id("jl"))
        _clear_cache(cfg)  # force a genuine pending → done run, not a cache hit
        resp = client.post("/jobs", json={"config": cfg, "formats": ["step", "dxf"]})
        assert resp.status_code == 200
        submit = resp.json()
        assert submit["status"] == "pending"
        assert submit["cached"] is False
        assert len(submit["configHash"]) == 8
        job_id = submit["jobId"]

        done = _poll_until_done(job_id)
        assert done["status"] == "done", done
        assert done["progress"] == 100
        assert done["stage"] == "done"
        formats = {f["format"] for f in done["files"]}
        assert {"step", "dxf"} <= formats
        for f in done["files"]:
            assert f["sizeBytes"] > 0
            assert f["url"].startswith("/files/")


class TestJobCache:
    def test_second_identical_request_served_from_cache(self) -> None:
        # Unique configId + cleared artifacts → first request is a guaranteed miss.
        cfg = _cfg(_unique_config_id("c"))
        _clear_cache(cfg)

        r1 = client.post("/jobs", json={"config": cfg, "formats": ["step"]})
        assert r1.status_code == 200
        assert r1.json()["cached"] is False
        done1 = _poll_until_done(r1.json()["jobId"])
        assert done1["status"] == "done"
        step_file = OUT_DIR / done1["files"][0]["filename"]
        assert step_file.exists()
        mtime_before = step_file.stat().st_mtime_ns

        # Second identical request → immediate cache hit, adapter NOT re-run.
        r2 = client.post("/jobs", json={"config": cfg, "formats": ["step"]})
        assert r2.status_code == 200
        submit2 = r2.json()
        assert submit2["status"] == "done"
        assert submit2["cached"] is True

        body2 = client.get(f"/jobs/{submit2['jobId']}").json()
        assert body2["status"] == "done"
        assert body2["files"][0]["filename"] == step_file.name

        # Proof the cached file was NOT regenerated.
        assert step_file.stat().st_mtime_ns == mtime_before
