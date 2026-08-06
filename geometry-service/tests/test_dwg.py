"""DWG / ODA wiring tests (Workstream B).

ODA File Converter is a proprietary GUI tool that is NOT installed locally and
NOT on apt/Homebrew.  These tests therefore:

  * SKIP the real-conversion assertions when ODA is absent (no hard failure).
  * Always assert the fallback wiring: when ODA is absent, `dwg` is NOT in the
    REGISTRY, `/health` does not advertise it, and a /generate request that
    asks for `dwg` still succeeds by emitting the DXF plus the DWG_WARNING.
  * When ODA IS present, assert dwg is registered, preferred, and health-visible.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.adapters import DWG_WARNING, REGISTRY
from app.adapters.dwg_adapter import _find_oda
from app.catalog import load_catalog
from app.main import app

from .conftest import first_base_cover_for

client = TestClient(app)

_ODA_PRESENT = _find_oda() is not None

_CFG = {
    "configId": "dwg-test",
    "pole": "alum-pole-20",
    "baseCover": first_base_cover_for(load_catalog(), "alum-pole-20"),
    "arm": "sh1-shepherds-hook",
    "fixture": "gvx-pendant",
    "finish": "matte-black",
    "rev": 1,
}


class TestDwgAbsentFallback:
    """Behaviour when ODA is not installed (the local + current-Docker case)."""

    def test_dwg_not_registered_when_oda_absent(self) -> None:
        if _ODA_PRESENT:
            pytest.skip("ODA present — absence path not exercised")
        assert "dwg" not in REGISTRY
        assert DWG_WARNING  # warning string is populated

    def test_health_omits_dwg_when_oda_absent(self) -> None:
        if _ODA_PRESENT:
            pytest.skip("ODA present — absence path not exercised")
        body = client.get("/health").json()
        assert "dwg" not in body["adapters"]

    def test_generate_dwg_falls_back_to_dxf_with_warning(self) -> None:
        if _ODA_PRESENT:
            pytest.skip("ODA present — fallback path not exercised")
        resp = client.post("/generate", json={"config": _CFG, "formats": ["dwg"]})
        assert resp.status_code == 200
        body = resp.json()
        # No .dwg produced, but the request did not 422 …
        assert not any(f["format"] == "dwg" for f in body["files"])
        # … and the DWG-absent warning is surfaced.
        assert any("ODA File Converter not installed" in w for w in body["warnings"])


class TestDwgPresent:
    """Behaviour when ODA IS installed — skipped entirely when it is not."""

    def test_dwg_registered_and_preferred(self) -> None:
        if not _ODA_PRESENT:
            pytest.skip("ODA File Converter not installed")
        assert "dwg" in REGISTRY
        body = client.get("/health").json()
        assert body["adapters"].get("dwg") is True

    def test_generate_dwg_produces_dwg_file(self) -> None:
        if not _ODA_PRESENT:
            pytest.skip("ODA File Converter not installed")
        resp = client.post("/generate", json={"config": _CFG, "formats": ["dwg"]})
        assert resp.status_code == 200
        body = resp.json()
        dwg_files = [f for f in body["files"] if f["filename"].endswith(".dwg")]
        assert dwg_files, "expected a .dwg output when ODA present"
        assert dwg_files[0]["sizeBytes"] > 0
