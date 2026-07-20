"""Tests for standalone product config support in the geometry-service.

TDD evidence — tests written alongside the implementation.

Standalone config: pole == arm == baseCover == '' with a non-empty fixture id.
Only 'pdf' format is accepted for standalone configs.

Covered:
1. validate_config accepts standalone config with valid fixture (any slot)
2. validate_config accepts standalone config with finish=''
3. validate_config accepts standalone config with valid finish id
4. validate_config rejects standalone config with unknown fixture id
5. validate_config rejects standalone config with unknown (non-empty) finish id
6. /generate standalone + ['pdf'] → 200, PDF file returned
7. /generate standalone + ['pdf'] → PDF contains product name + disclaimer + config ID
8. /generate standalone + ['step'] → 422 "only spec sheets are available"
9. /generate standalone + ['ifc'] → 422
10. Normal assembly configs still work (no regression)
"""

from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app.adapters._spec_template import _latin1
from app.catalog import load_catalog, validate_config, is_standalone_config
from app.main import app
from app.models import PoleConfig
from app.naming import DISCLAIMER

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _standalone_cfg(fixture_id: str, finish: str = "") -> PoleConfig:
    return PoleConfig(
        configId=f"sa-test-{uuid.uuid4().hex[:8]}",
        pole="",
        baseCover="",
        arm="",
        fixture=fixture_id,
        finish=finish,
        rev=1,
    )


def _extract_text(pdf_bytes: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "".join(page.extract_text() or "" for page in reader.pages)


# ---------------------------------------------------------------------------
# is_standalone_config
# ---------------------------------------------------------------------------

class TestIsStandaloneConfig:
    def test_empty_pole_arm_baseCover_is_standalone(self) -> None:
        cfg = _standalone_cfg("any-fixture-id")
        assert is_standalone_config(cfg) is True

    def test_non_empty_pole_is_not_standalone(self) -> None:
        cfg = PoleConfig(
            configId="x", pole="alum-pole-20", baseCover="", arm="", fixture="gvx-pendant",
            finish="", rev=1,
        )
        assert is_standalone_config(cfg) is False

    def test_empty_fixture_is_not_standalone(self) -> None:
        cfg = PoleConfig(
            configId="x", pole="", baseCover="", arm="", fixture="",
            finish="", rev=1,
        )
        assert is_standalone_config(cfg) is False


# ---------------------------------------------------------------------------
# validate_config — standalone path
# ---------------------------------------------------------------------------

class TestValidateConfigStandalone:
    @pytest.fixture(scope="class")
    def cat(self) -> dict:
        load_catalog.cache_clear()
        return load_catalog()

    def _first_standalone_fixture(self, cat: dict) -> str:
        """Return the id of the first standalone-slot part in the catalog."""
        for p in cat["parts"]:
            if p.get("slot") == "standalone":
                return p["id"]
        raise RuntimeError("No standalone parts in catalog")

    def _first_assembly_fixture(self, cat: dict) -> str:
        for p in cat["parts"]:
            if p.get("slot") == "fixture":
                return p["id"]
        raise RuntimeError("No fixture parts in catalog")

    def test_standalone_fixture_valid_no_finish(self, cat: dict) -> None:
        """Standalone config with a real standalone-slot part and finish='' must not raise."""
        fixture_id = self._first_standalone_fixture(cat)
        cfg = _standalone_cfg(fixture_id, finish="")
        validate_config(cat, cfg)  # must not raise

    def test_assembly_fixture_as_standalone_valid(self, cat: dict) -> None:
        """Any catalog part id is accepted in the fixture field of a standalone config."""
        fixture_id = self._first_assembly_fixture(cat)
        cfg = _standalone_cfg(fixture_id, finish="")
        validate_config(cat, cfg)  # must not raise

    def test_standalone_with_valid_finish_accepted(self, cat: dict) -> None:
        fixture_id = self._first_standalone_fixture(cat)
        first_finish = cat["finishes"][0]["id"]
        cfg = _standalone_cfg(fixture_id, finish=first_finish)
        validate_config(cat, cfg)  # must not raise

    def test_standalone_unknown_fixture_raises(self, cat: dict) -> None:
        cfg = _standalone_cfg("totally-nonexistent-part", finish="")
        with pytest.raises(ValueError, match="totally-nonexistent-part"):
            validate_config(cat, cfg)

    def test_standalone_unknown_finish_raises(self, cat: dict) -> None:
        fixture_id = self._first_standalone_fixture(cat)
        cfg = _standalone_cfg(fixture_id, finish="not-a-real-finish")
        with pytest.raises(ValueError, match="not-a-real-finish"):
            validate_config(cat, cfg)


# ---------------------------------------------------------------------------
# /generate — standalone config + formats
# ---------------------------------------------------------------------------

def _post(cfg_dict: dict, formats: list[str]) -> object:
    return client.post(
        "/generate",
        json={"config": cfg_dict, "formats": formats, "renderPng": None},
    )


def _first_standalone_id() -> str:
    cat = load_catalog()
    for p in cat["parts"]:
        if p.get("slot") == "standalone":
            return p["id"]
    raise RuntimeError("No standalone parts")


class TestStandaloneGenerate:
    def test_standalone_pdf_returns_200(self) -> None:
        fixture_id = _first_standalone_id()
        cfg = {
            "configId": f"sa-pdf-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["pdf"])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        pdf_files = [f for f in body["files"] if f["format"] == "pdf"]
        assert len(pdf_files) == 1, f"Expected 1 pdf file, got {pdf_files}"
        assert pdf_files[0]["filename"].endswith(".pdf")

    def test_standalone_pdf_contains_product_name(self) -> None:
        """PDF must contain the product name from the catalog."""
        cat = load_catalog()
        fixture_id = _first_standalone_id()
        part_obj = next(p for p in cat["parts"] if p["id"] == fixture_id)
        part_name = part_obj["name"]

        cfg = {
            "configId": f"sa-name-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["pdf"])
        assert resp.status_code == 200
        body = resp.json()
        pdf_files = [f for f in body["files"] if f["format"] == "pdf"]
        assert pdf_files

        # Download and parse the PDF
        file_url = pdf_files[0]["url"]
        dl = client.get(file_url)
        assert dl.status_code == 200
        text = _extract_text(dl.content)
        # fpdf2 core fonts are latin-1: names go through the _latin1 sanitizer
        # (e.g. "NAFCO(R)" for "NAFCO(r-mark)"), so compare the sanitized form.
        expected = _latin1(part_name)
        assert expected in text, f"Part name {expected!r} not found in standalone PDF"

    def test_standalone_pdf_contains_config_id(self) -> None:
        fixture_id = _first_standalone_id()
        config_id = f"sa-cfgid-{uuid.uuid4().hex[:8]}"
        cfg = {
            "configId": config_id,
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["pdf"])
        assert resp.status_code == 200
        body = resp.json()
        pdf_files = [f for f in body["files"] if f["format"] == "pdf"]
        dl = client.get(pdf_files[0]["url"])
        assert dl.status_code == 200
        text = _extract_text(dl.content)
        assert config_id in text, f"configId {config_id!r} not found in standalone PDF"

    def test_standalone_pdf_contains_disclaimer(self) -> None:
        fixture_id = _first_standalone_id()
        cfg = {
            "configId": f"sa-disc-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["pdf"])
        assert resp.status_code == 200
        body = resp.json()
        pdf_files = [f for f in body["files"] if f["format"] == "pdf"]
        dl = client.get(pdf_files[0]["url"])
        assert dl.status_code == 200
        text = _extract_text(dl.content)
        assert DISCLAIMER[:40] in text, "DISCLAIMER not found in standalone PDF"

    def test_standalone_step_returns_422(self) -> None:
        fixture_id = _first_standalone_id()
        cfg = {
            "configId": f"sa-step-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["step"])
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body
        assert "standalone" in body["detail"].lower(), (
            f"Expected 'standalone' in detail: {body['detail']!r}"
        )

    def test_standalone_ifc_returns_422(self) -> None:
        fixture_id = _first_standalone_id()
        cfg = {
            "configId": f"sa-ifc-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["ifc"])
        assert resp.status_code == 422

    def test_standalone_dxf_returns_422(self) -> None:
        fixture_id = _first_standalone_id()
        cfg = {
            "configId": f"sa-dxf-{uuid.uuid4().hex[:8]}",
            "pole": "", "baseCover": "", "arm": "",
            "fixture": fixture_id,
            "finish": "",
            "rev": 1,
        }
        resp = _post(cfg, ["dxf"])
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Regression: normal assembly configs unchanged
# ---------------------------------------------------------------------------

class TestNormalConfigRegression:
    def test_normal_pdf_still_works(self) -> None:
        """Normal assembly config + pdf must still return 200."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "regression-pdf-001",
                    "pole": "alum-pole-20",
                    "baseCover": "bc-fluted",
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["pdf"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_normal_step_still_works(self) -> None:
        """Normal assembly config + step must still return 200."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "regression-step-001",
                    "pole": "alum-pole-20",
                    "baseCover": "bc-fluted",
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
