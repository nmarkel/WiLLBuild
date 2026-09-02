"""Artifact cache correctness (Phase 0.20, Workstream C).

`_OUTPUT_VERSION` already rides inside `config_hash`, so bumping it changes
every filename and orphans the previous generation's artifacts. That is enough
to stop a stale file being SERVED for a fresh request — but not enough to stop
it being served at all:

  * the orphans stay on disk forever (553 MB when this was written), and
  * `/files/{filename}` hands back anything whose name you know, without ever
    asking which schema produced it — so an artifact generated before Phase
    0.20's merchandising gate is still reachable to anyone holding its URL.

The fix is to make the schema VISIBLE in the filename instead of dissolved into
an opaque hash: a name either carries the current `_OUTPUT_VERSION` or it does
not, which makes stale files identifiable, refusable and purgeable.

This is the class of bug that shipped a "Custom RAL" sheet against a
stock-finish order — one cache key change away from serving the wrong artifact
with complete confidence.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import OUT_DIR, app
from app.models import PoleConfig
from app.naming import _OUTPUT_VERSION, base_name

client = TestClient(app)


def _cfg(config_id: str = "cache-test-0001") -> PoleConfig:
    return PoleConfig(
        configId=config_id,
        pole="alum-pole-20",
        baseCover="bc-cl1-small-clamshell",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


# ---------------------------------------------------------------------------
# The filename carries the schema
# ---------------------------------------------------------------------------

def test_base_name_carries_the_output_version():
    """Visible, not dissolved into the hash.

    `_OUTPUT_VERSION` is part of `config_hash`, which is what makes a bump
    orphan old files — but a hash is opaque, so nothing downstream can tell a
    current artifact from a stale one by looking at it. Putting the version in
    the name is what lets the read path and the purge both decide.
    """
    name = base_name({}, _cfg())
    assert name.startswith(f"WiLL_v{_OUTPUT_VERSION}_"), name


def test_base_name_is_still_deterministic():
    """Same config in, same name out — the whole cache depends on it."""
    assert base_name({}, _cfg()) == base_name({}, _cfg())


def test_two_versions_cannot_collide():
    from app.artifacts import is_current_schema

    current = base_name({}, _cfg())
    stale = current.replace(f"WiLL_v{_OUTPUT_VERSION}_", f"WiLL_v{_OUTPUT_VERSION - 1}_")
    assert current != stale
    assert is_current_schema(current + ".pdf")
    assert not is_current_schema(stale + ".pdf")


# ---------------------------------------------------------------------------
# The read path refuses a stale schema
# ---------------------------------------------------------------------------

@pytest.fixture
def stale_file():
    """A real file on disk whose name carries a previous schema version."""
    path = OUT_DIR / f"WiLL_v{_OUTPUT_VERSION - 1}_deadbeef_{uuid.uuid4().hex[:8]}.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4 stale artifact from an older schema")
    yield path
    path.unlink(missing_ok=True)


@pytest.fixture
def unversioned_file():
    """A pre-0.20 name: no version segment at all."""
    path = OUT_DIR / f"WiLL_abc12345_{uuid.uuid4().hex[:8]}.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4 artifact from before the schema was named")
    yield path
    path.unlink(missing_ok=True)


def test_a_stale_schema_artifact_is_not_served(stale_file):
    """Present on disk, refused anyway — presence is not currency."""
    resp = client.get(f"/files/{stale_file.name}")
    assert resp.status_code == 410, resp.text


def test_an_unversioned_artifact_is_not_served(unversioned_file):
    """Every artifact predating Phase 0.20 has this shape.

    They were generated before the merchandising gate existed, so among them
    are held-part downloads that must not be reachable by URL.
    """
    resp = client.get(f"/files/{unversioned_file.name}")
    assert resp.status_code == 410, resp.text


def test_a_current_artifact_is_still_served():
    """Negative control: the guard must not break the actual download path."""
    resp = client.post(
        "/generate",
        json={"config": _cfg("cache-live-01").model_dump(), "formats": ["pdf"]},
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["files"][0]["url"]
    dl = client.get(url)
    assert dl.status_code == 200
    assert len(dl.content) > 0


def test_path_traversal_is_still_rejected():
    """The 0.3 guard must survive the new one; 400 before any schema question."""
    assert client.get("/files/../naming.py").status_code in (400, 404)


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------

def test_purge_removes_stale_and_keeps_current(tmp_path):
    from app.artifacts import purge_stale_artifacts

    keep = tmp_path / f"WiLL_v{_OUTPUT_VERSION}_abc12345_keepme.pdf"
    drop_old = tmp_path / f"WiLL_v{_OUTPUT_VERSION - 1}_abc12345_dropme.pdf"
    drop_unversioned = tmp_path / "WiLL_abc12345_dropme.step"
    for f in (keep, drop_old, drop_unversioned):
        f.write_bytes(b"x")

    removed = purge_stale_artifacts(tmp_path)

    assert keep.exists(), "purge deleted a current-schema artifact"
    assert not drop_old.exists()
    assert not drop_unversioned.exists()
    assert removed == 2


def test_purge_leaves_foreign_files_alone(tmp_path):
    """Only WiLL_ artifacts are ours to delete.

    out/ is a directory on someone's machine; a purge that treats every file as
    disposable is a footgun waiting for the day out/ is pointed somewhere real.
    """
    from app.artifacts import purge_stale_artifacts

    foreign = tmp_path / "notes.txt"
    foreign.write_text("not mine")
    (tmp_path / f"WiLL_v{_OUTPUT_VERSION - 1}_abc12345_x.pdf").write_bytes(b"x")

    removed = purge_stale_artifacts(tmp_path)

    assert foreign.exists()
    assert removed == 1


def test_purge_is_idempotent(tmp_path):
    from app.artifacts import purge_stale_artifacts

    (tmp_path / f"WiLL_v{_OUTPUT_VERSION - 1}_abc12345_x.pdf").write_bytes(b"x")
    assert purge_stale_artifacts(tmp_path) == 1
    assert purge_stale_artifacts(tmp_path) == 0
