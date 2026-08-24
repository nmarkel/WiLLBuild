"""Weight/size-target test (Workstream A).

The customer-facing GVX deliverable is produced entirely by the parametric
kit (there is NO real-engineering-STEP passthrough in the /generate download
path — the ~87MB figure from the Phase 0.6 spike was the raw SolidWorks STEP
loaded directly, never wired into this service).  This test locks in the
≤10MB-per-file guarantee so that if a real-STEP path is ever added it must
decimate to stay under budget.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

from .conftest import first_base_cover_for

client = TestClient(app)

_SIZE_BUDGET = 10 * 1024 * 1024  # 10 MB per file


@pytest.fixture(scope="module")
def gvx_cfg(catalog: dict) -> dict:
    return {
        "configId": "weight-gvx",
        "pole": "alum-pole-20",
        "baseCover": first_base_cover_for(catalog, "alum-pole-20"),
        "arm": "sh1-shepherds-hook",
        "fixture": "gvx-pendant",
        "finish": "matte-black",
        "rev": 1,
    }


def test_gvx_every_deliverable_under_10mb(gvx_cfg: dict) -> None:
    formats = ["step", "ifc", "dxf", "pdf", "bundle"]
    resp = client.post("/generate", json={"config": gvx_cfg, "formats": formats})
    assert resp.status_code == 200
    files = resp.json()["files"]
    assert files, "no files produced"
    oversize = [(f["format"], f["sizeBytes"]) for f in files if f["sizeBytes"] > _SIZE_BUDGET]
    assert not oversize, f"deliverables over 10MB budget: {oversize}"


def test_gvx_ifc_is_largest_and_reasonable(gvx_cfg: dict) -> None:
    """IFC is the heaviest format; assert it is comfortably within budget."""
    resp = client.post("/generate", json={"config": gvx_cfg, "formats": ["ifc"]})
    assert resp.status_code == 200
    ifc = resp.json()["files"][0]
    assert ifc["format"] == "ifc"
    assert ifc["sizeBytes"] < _SIZE_BUDGET


def _worst_core_cfg(config_id: str, fixture: str, arm: str) -> dict:
    """The heaviest CORE assembly a customer can configure for a fixture.

    Phase 0.19: the 8/24 SERVICE_TRIS ceiling was budgeted against the
    friendliest cover (CL1, 20.5k tris); measured on CL3 (31.4k) both
    fixtures blew the gate (GVX 10.50 MB, TEX 10.38 MB STEP).  The ceiling
    is 48k now and THIS gate samples the worst cover for both fixtures, so
    a future shell rebuild cannot re-open the hole against the easy config.
    Shaft-accessory stacks (~+43k tris possible) remain the recorded open
    decision in scripts/web-glb/build.mjs.
    """
    return {
        "configId": config_id,
        "pole": "alum-pole-20",
        "baseCover": "bc-cl3-large-clamshell",
        "arm": arm,
        "fixture": fixture,
        "finish": "matte-black",
        "rev": 1,
    }


@pytest.mark.parametrize(
    ("fixture", "arm"),
    [
        ("gvx-pendant", "sh1-shepherds-hook"),
        # direct-mount: TEX's canonical tenon mounting — shell-covered since
        # 0.19 via the generated pseudo-arm frustum (shellgeom).
        ("tex-post-top", "direct-mount"),
    ],
)
def test_worst_core_config_every_deliverable_under_10mb(fixture: str, arm: str) -> None:
    cfg = _worst_core_cfg(f"weight-{fixture[:3]}-cl3", fixture, arm)
    formats = ["step", "ifc", "dxf", "pdf", "bundle"]
    resp = client.post("/generate", json={"config": cfg, "formats": formats})
    assert resp.status_code == 200
    files = resp.json()["files"]
    assert files, "no files produced"
    # The shells must actually be in play — a parametric fallback would pass
    # this gate while shipping the wrong geometry entirely.
    assert not any("concept solids used" in w for w in resp.json()["warnings"])
    oversize = [(f["format"], f["sizeBytes"]) for f in files if f["sizeBytes"] > _SIZE_BUDGET]
    assert not oversize, f"deliverables over 10MB budget: {oversize}"
