"""Ops hardening ladder (Phase 0.20, Workstream D).

The service runs as ONE process on a 2 GB App Runner instance with jobs in a
process-local dict. Everything here is about that shape being survivable rather
than about scale:

  * the job dict is unbounded — the sharper of the two memory risks, because a
    JobRecord holds the whole request;
  * request bodies are unbounded — `renderPng` accepts base64, so a caller can
    post as much as they like;
  * out/ only ever grows;
  * nothing rate-limits anything, and CORS is not access control.

None of this is scale engineering. It is the difference between a bad day and
an outage on a box that cannot scale out (max instances is pinned to 1 —
see docs/DEPLOY.md, because scaling orphans in-flight jobs).
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import jobs as jobs_mod
from app import ratelimit
from app.main import app

client = TestClient(app)

CFG = {
    "configId": "ops-0001",
    "pole": "alum-pole-20",
    "baseCover": "bc-cl1-small-clamshell",
    "arm": "sh1-shepherds-hook",
    "fixture": "gvx-pendant",
    "finish": "matte-black",
    "rev": 1,
}


# ---------------------------------------------------------------------------
# 2 — bounded job dict
# ---------------------------------------------------------------------------

def test_the_job_registry_is_bounded(monkeypatch):
    """An unbounded dict of JobRecords is the memory risk on a 2 GB instance.

    Each record pins the whole GenerateRequest, so the leak is proportional to
    traffic and never returns memory until the process dies.
    """
    monkeypatch.setattr(jobs_mod, "_MAX_JOBS", 5)
    jobs_mod.JOBS.clear()
    for i in range(20):
        jobs_mod.JOBS[f"job-{i}"] = jobs_mod.JobRecord(
            jobId=f"job-{i}", configHash="deadbeef", formats=["pdf"],
            req=None, out_dir=None, status="done",
        )
        jobs_mod.evict_if_needed()
    assert len(jobs_mod.JOBS) <= 5


def test_eviction_prefers_finished_jobs(monkeypatch):
    """A pending job is someone waiting on a poll; a done job is history.

    Evicting the pending one turns a slow download into a 404 the caller cannot
    distinguish from a bad job id.
    """
    monkeypatch.setattr(jobs_mod, "_MAX_JOBS", 3)
    jobs_mod.JOBS.clear()
    for i in range(3):
        jobs_mod.JOBS[f"done-{i}"] = jobs_mod.JobRecord(
            jobId=f"done-{i}", configHash="d", formats=["pdf"],
            req=None, out_dir=None, status="done",
        )
    jobs_mod.JOBS["pending-1"] = jobs_mod.JobRecord(
        jobId="pending-1", configHash="d", formats=["pdf"],
        req=None, out_dir=None, status="pending",
    )
    jobs_mod.evict_if_needed()

    assert "pending-1" in jobs_mod.JOBS, "evicted a job someone is still polling"
    assert len(jobs_mod.JOBS) <= 3


def test_eviction_drops_the_oldest_finished_job_first(monkeypatch):
    monkeypatch.setattr(jobs_mod, "_MAX_JOBS", 2)
    jobs_mod.JOBS.clear()
    for i in range(4):
        jobs_mod.JOBS[f"done-{i}"] = jobs_mod.JobRecord(
            jobId=f"done-{i}", configHash="d", formats=["pdf"],
            req=None, out_dir=None, status="done",
        )
    jobs_mod.evict_if_needed()
    assert "done-0" not in jobs_mod.JOBS
    assert "done-3" in jobs_mod.JOBS


# ---------------------------------------------------------------------------
# 2 — payload caps
# ---------------------------------------------------------------------------

def test_an_oversized_body_is_refused_before_any_work(monkeypatch):
    """413 on Content-Length, so the bytes are never buffered or parsed.

    `renderPng` takes base64, which is the open door: it is the one field with
    no natural size and it is attacker-controlled.
    """
    monkeypatch.setattr("app.main.MAX_REQUEST_BYTES", 2048)
    big = "A" * 8192
    resp = client.post(
        "/generate",
        json={"config": CFG, "formats": ["pdf"], "renderPng": big},
    )
    assert resp.status_code == 413, resp.text


def test_a_normal_body_is_unaffected():
    resp = client.post("/generate", json={"config": CFG, "formats": ["pdf"]})
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# 3 — artifact expiry
# ---------------------------------------------------------------------------

def test_expired_artifacts_are_swept(tmp_path):
    from app.artifacts import sweep_expired_artifacts

    old = tmp_path / "WiLL_v99_abc12345_old.pdf"
    new = tmp_path / "WiLL_v99_abc12345_new.pdf"
    old.write_bytes(b"x")
    new.write_bytes(b"x")
    ancient = time.time() - (72 * 3600)
    import os

    os.utime(old, (ancient, ancient))

    removed = sweep_expired_artifacts(tmp_path, max_age_hours=24)

    assert not old.exists()
    assert new.exists()
    assert removed == 1


def test_the_sweep_leaves_foreign_files_alone(tmp_path):
    import os

    from app.artifacts import sweep_expired_artifacts

    foreign = tmp_path / "someones-notes.txt"
    foreign.write_text("not mine")
    ancient = time.time() - (72 * 3600)
    os.utime(foreign, (ancient, ancient))

    assert sweep_expired_artifacts(tmp_path, max_age_hours=24) == 0
    assert foreign.exists()


# ---------------------------------------------------------------------------
# 4 — rate limiting
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _fresh_limiter():
    """Per-IP counters are process-global; reset them so one test's burst
    cannot fail the next one."""
    ratelimit.reset()
    yield
    ratelimit.reset()


def test_a_burst_from_one_ip_is_throttled(monkeypatch):
    monkeypatch.setattr(ratelimit, "_DEFAULT_LIMIT", 3)
    codes = [client.get("/health").status_code for _ in range(6)]
    assert 429 in codes, codes


def test_the_throttle_says_when_to_come_back(monkeypatch):
    monkeypatch.setattr(ratelimit, "_DEFAULT_LIMIT", 1)
    client.get("/health")
    resp = client.get("/health")
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_health_under_the_limit_is_untouched():
    assert client.get("/health").status_code == 200


def test_lead_capture_has_its_own_tighter_limit(monkeypatch):
    """A form endpoint that writes to durable storage deserves a lower ceiling
    than a read-only health check."""
    assert ratelimit.limit_for("/leads") < ratelimit.limit_for("/health")
