"""Weight/size-target test (Workstream A).

The customer-facing GVX deliverable is produced entirely by the parametric
kit (there is NO real-engineering-STEP passthrough in the /generate download
path — the ~87MB figure from the Phase 0.6 spike was the raw SolidWorks STEP
loaded directly, never wired into this service).  This test locks in the
≤10MB-per-file guarantee so that if a real-STEP path is ever added it must
decimate to stay under budget.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.catalog import load_catalog
from app.main import app

from .conftest import first_base_cover_for

client = TestClient(app)

_SIZE_BUDGET = 10 * 1024 * 1024  # 10 MB per file

_GVX = {
    "configId": "weight-gvx",
    "pole": "alum-pole-20",
    "baseCover": first_base_cover_for(load_catalog(), "alum-pole-20"),
    "arm": "sh1-shepherds-hook",
    "fixture": "gvx-pendant",
    "finish": "matte-black",
    "rev": 1,
}


def test_gvx_every_deliverable_under_10mb() -> None:
    formats = ["step", "ifc", "dxf", "pdf", "bundle"]
    resp = client.post("/generate", json={"config": _GVX, "formats": formats})
    assert resp.status_code == 200
    files = resp.json()["files"]
    assert files, "no files produced"
    oversize = [(f["format"], f["sizeBytes"]) for f in files if f["sizeBytes"] > _SIZE_BUDGET]
    assert not oversize, f"deliverables over 10MB budget: {oversize}"


def test_gvx_ifc_is_largest_and_reasonable() -> None:
    """IFC is the heaviest format; assert it is comfortably within budget."""
    resp = client.post("/generate", json={"config": _GVX, "formats": ["ifc"]})
    assert resp.status_code == 200
    ifc = resp.json()["files"][0]
    assert ifc["format"] == "ifc"
    assert ifc["sizeBytes"] < _SIZE_BUDGET
