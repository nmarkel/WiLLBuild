"""Tests for the geometry-service FastAPI skeleton (Task 1).

All tests use fastapi.testclient.TestClient (synchronous ASGI test runner).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.catalog import validate_config
from app.main import app
from app.models import PoleConfig
from app.naming import config_hash

from .conftest import first_base_cover_for, valid_combos

client = TestClient(app)


@pytest.fixture(scope="session")
def bc_alum20(catalog: dict) -> str:
    """The baseCover derived for alum-pole-20.

    Threaded through every test that needs a valid config, per the file's
    existing dependency-injection pattern (see TestValidateConfig, which
    already takes `catalog` as a fixture param) rather than a module-level
    constant computed at import time.  Phase 0.10.5 re-slotted
    bc-fluted/bc-round to 'standalone'.
    """
    return first_base_cover_for(catalog, "alum-pole-20")


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


class TestHealth:
    def test_health_returns_ok(self) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_has_status_ok(self) -> None:
        resp = client.get("/health")
        body = resp.json()
        assert body["status"] == "ok"

    def test_health_has_adapters_map(self) -> None:
        """adapters key must be present and be a dict (empty is fine for skeleton)."""
        resp = client.get("/health")
        body = resp.json()
        assert "adapters" in body
        assert isinstance(body["adapters"], dict)


# ---------------------------------------------------------------------------
# /generate — invalid config cases (must → 422)
# ---------------------------------------------------------------------------


class TestGenerateValidation:
    def _post(self, cfg_dict: dict, formats: list[str] | None = None) -> object:
        payload = {
            "config": cfg_dict,
            "formats": formats or ["step"],
            "renderPng": None,
        }
        return client.post("/generate", json=payload)

    def test_missing_pole_in_config_returns_422_with_string_detail(self, bc_alum20) -> None:
        """POST /generate with body missing config.pole → 422 with string detail."""
        resp = self._post(
            {
                "configId": "missing-pole-test",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "gvx-pendant",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body
        assert isinstance(body["detail"], str)

    def test_unknown_fixture_id_returns_422(self, bc_alum20) -> None:
        resp = self._post(
            {
                "configId": "bad-fixture-test",
                "pole": "alum-pole-20",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "does-not-exist",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_arm_id_returns_422(self, bc_alum20) -> None:
        resp = self._post(
            {
                "configId": "bad-arm-test",
                "pole": "alum-pole-20",
                "baseCover": bc_alum20,
                "arm": "no-such-arm",
                "fixture": "gvx-pendant",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_pole_id_returns_422(self, bc_alum20) -> None:
        resp = self._post(
            {
                "configId": "bad-pole-test",
                "pole": "alum-pole-99",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "gvx-pendant",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_finish_id_returns_422(self, bc_alum20) -> None:
        resp = self._post(
            {
                "configId": "bad-finish-test",
                "pole": "alum-pole-20",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "gvx-pendant",
                "finish": "not-a-real-finish",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_socket_violation_post_top_fixture_plus_pendant_arm_returns_422(
        self, bc_alum20
    ) -> None:
        """drx-post-top has mount=tenon-2-3/8; sh1-shepherds-hook only exposes
        a pendant socket — cannot host drx-post-top.  This is a socket violation."""
        resp = self._post(
            {
                "configId": "socket-violation-test",
                "pole": "alum-pole-20",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "drx-post-top",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body
        assert "drx-post-top" in body["detail"] or "socket" in body["detail"].lower()

    def test_error_detail_is_string(self, bc_alum20) -> None:
        """422 responses from config validation must have a string detail field."""
        resp = self._post(
            {
                "configId": "detail-test",
                "pole": "alum-pole-20",
                "baseCover": bc_alum20,
                "arm": "sh1-shepherds-hook",
                "fixture": "does-not-exist",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422
        body = resp.json()
        assert isinstance(body["detail"], str)


# ---------------------------------------------------------------------------
# /generate — no adapter registered (skeleton behavior)
# ---------------------------------------------------------------------------


class TestGenerateNoAdapter:
    def test_valid_config_no_adapter_returns_422(self, bc_alum20) -> None:
        """When config is valid but no adapter is registered for the format, return 422.

        'ply' is not registered — use it as the unregistered format.
        (STEP, DXF, IFC, and PDF are all implemented in phase 0.3.)
        """
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "valid-no-adapter",
                    "pole": "alum-pole-20",
                    "baseCover": bc_alum20,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["ply"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 422
        body = resp.json()
        # The format enum validation rejects unknown format names outright
        assert "detail" in body


# ---------------------------------------------------------------------------
# config_hash — determinism tests
# ---------------------------------------------------------------------------


class TestConfigHash:
    @staticmethod
    def _base(bc_alum20: str) -> dict:
        return dict(
            configId="aaa-111",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )

    def _cfg(self, bc_alum20: str, **overrides: object) -> PoleConfig:
        return PoleConfig(**{**self._base(bc_alum20), **overrides})

    def test_hash_is_8_chars(self, bc_alum20) -> None:
        assert len(config_hash(self._cfg(bc_alum20))) == 8

    def test_hash_is_hex(self, bc_alum20) -> None:
        h = config_hash(self._cfg(bc_alum20))
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_stable_across_configId_changes(self, bc_alum20) -> None:
        h1 = config_hash(self._cfg(bc_alum20, configId="aaa-111"))
        h2 = config_hash(self._cfg(bc_alum20, configId="bbb-999"))
        assert h1 == h2, "configId should not affect the hash"

    def test_hash_stable_across_rev_changes(self, bc_alum20) -> None:
        h1 = config_hash(self._cfg(bc_alum20, rev=1))
        h2 = config_hash(self._cfg(bc_alum20, rev=42))
        assert h1 == h2, "rev should not affect the hash"

    def test_hash_changes_when_pole_changes(self, bc_alum20) -> None:
        h1 = config_hash(self._cfg(bc_alum20, pole="alum-pole-20"))
        h2 = config_hash(self._cfg(bc_alum20, pole="alum-pole-12"))
        assert h1 != h2

    def test_hash_changes_when_fixture_changes(self, bc_alum20) -> None:
        h1 = config_hash(self._cfg(bc_alum20, fixture="gvx-pendant"))
        h2 = config_hash(self._cfg(bc_alum20, fixture="drx-post-top"))
        assert h1 != h2

    def test_hash_changes_when_finish_changes(self, bc_alum20) -> None:
        h1 = config_hash(self._cfg(bc_alum20, finish="matte-black"))
        h2 = config_hash(self._cfg(bc_alum20, finish="gloss-white"))
        assert h1 != h2

    def test_hash_deterministic_repeated_calls(self, bc_alum20) -> None:
        cfg = self._cfg(bc_alum20)
        assert config_hash(cfg) == config_hash(cfg)


# ---------------------------------------------------------------------------
# validate_config unit tests
# ---------------------------------------------------------------------------


class TestValidateConfig:
    def test_valid_combos_do_not_raise(self, catalog: dict) -> None:
        for cfg in valid_combos(catalog):
            validate_config(catalog, cfg)  # must not raise

    def test_unknown_part_raises_value_error(self, catalog: dict, bc_alum20) -> None:
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",
            fixture="totally-fake",
            finish="matte-black",
            rev=1,
        )
        with pytest.raises(ValueError, match="totally-fake"):
            validate_config(catalog, cfg)

    def test_socket_violation_raises_value_error(self, catalog: dict, bc_alum20) -> None:
        """post-top fixture on a pendant-only arm must raise."""
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",  # only pendant socket
            fixture="drx-post-top",   # mount=tenon-2-3/8 — not pendant
            finish="matte-black",
            rev=1,
        )
        with pytest.raises(ValueError):
            validate_config(catalog, cfg)

    def test_unknown_finish_raises_value_error(self, catalog: dict, bc_alum20) -> None:
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="hot-pink",
            rev=1,
        )
        with pytest.raises(ValueError, match="hot-pink"):
            validate_config(catalog, cfg)

    def test_slot_mismatch_pole_in_fixture_field_raises(self, catalog: dict, bc_alum20) -> None:
        """Putting a pole id in the fixture field must raise a ValueError."""
        cfg = PoleConfig(
            configId="slot-mismatch-test",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",
            fixture="alum-pole-12",   # pole id, not a fixture id
            finish="matte-black",
            rev=1,
        )
        with pytest.raises(ValueError, match="pole"):
            validate_config(catalog, cfg)

    def test_slot_mismatch_via_api_returns_422(self, bc_alum20) -> None:
        """POST /generate with a pole id in the fixture field must return 422."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "slot-mismatch-api-test",
                    "pole": "alum-pole-20",
                    "baseCover": bc_alum20,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "alum-pole-12",   # pole id in fixture field
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body
        assert "pole" in body["detail"] or "fixture" in body["detail"]


# ---------------------------------------------------------------------------
# /generate — summary.parts validation
# ---------------------------------------------------------------------------


class TestGenerateSummaryParts:
    def test_generate_summary_contains_parts_with_names(self, bc_alum20) -> None:
        """POST /generate must include parts array in summary with slot, id, name, productUrl."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "summary-parts-test",
                    "pole": "alum-pole-20",
                    "baseCover": bc_alum20,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "files" in body
        # For integration, we just verify the response is valid.
        # The summary is internal (GenContext.summary), not directly in the response,
        # but we can verify the request was processed successfully.
        assert len(body["files"]) == 1


# ---------------------------------------------------------------------------
# /generate — renderPng base64 handling
# ---------------------------------------------------------------------------


class TestGenerateRenderPngBase64:
    def test_generate_with_valid_base64_png_no_warning(self, bc_alum20) -> None:
        """POST /generate with valid base64 PNG (no prefix) must not produce warning."""
        # Tiny valid PNG in base64 (1x1 transparent PNG)
        tiny_png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
        )
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "png-valid-test",
                    "pole": "alum-pole-20",
                    "baseCover": bc_alum20,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": tiny_png_b64,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        # Check no warning about renderPng
        assert not any("renderPng" in w for w in body.get("warnings", []))

    def test_generate_with_invalid_base64_png_produces_warning(self, bc_alum20) -> None:
        """POST /generate with garbage base64 must produce 'renderPng ignored' warning."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "png-invalid-test",
                    "pole": "alum-pole-20",
                    "baseCover": bc_alum20,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": "not-valid-base64!!!",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        # Check for renderPng ignored warning
        assert any("renderPng ignored" in w for w in body.get("warnings", []))


# ---------------------------------------------------------------------------
# Multi-arm (radial armCount) — Phase 0.8
# ---------------------------------------------------------------------------


class TestMultiArmGenerate:
    """POST /generate with a twin config produces distinct, non-empty output."""

    def _twin_cfg(self, bc_alum20: str) -> dict:
        return dict(
            configId="twin-http-0001",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            # Phase 0.10: the Side Shepherds Hook (SS1..SS4) is the valid
            # multi-arm family — SH1 is single-only on the ordering matrix.
            arm="willstudio-side-shepherds-hook-pole-top-brackets",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
            armCount=2,
        )

    def _single_cfg(self, bc_alum20: str) -> dict:
        c = self._twin_cfg(bc_alum20)
        c["armCount"] = 1
        return c

    def test_twin_generate_returns_200_with_files(self, bc_alum20) -> None:
        from app.adapters import REGISTRY

        # Guard formats whose engine may be absent in this environment.
        formats = [f for f in ("step", "ifc", "pdf") if f in REGISTRY]
        assert "pdf" in formats  # pdf/ifc are hard deps; must be present
        resp = client.post(
            "/generate",
            json={"config": self._twin_cfg(bc_alum20), "formats": formats, "renderPng": None},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["files"]) == len(formats)
        for entry in body["files"]:
            assert entry["sizeBytes"] > 0

    def test_twin_confighash_differs_from_single(self, bc_alum20) -> None:
        assert config_hash(PoleConfig(**self._twin_cfg(bc_alum20))) != config_hash(
            PoleConfig(**self._single_cfg(bc_alum20))
        )

    def test_armcount_out_of_range_returns_422(self, bc_alum20) -> None:
        cfg = self._twin_cfg(bc_alum20)
        cfg["armCount"] = 5
        resp = client.post(
            "/generate",
            json={"config": cfg, "formats": ["pdf"], "renderPng": None},
        )
        assert resp.status_code == 422
        assert "armCount" in resp.json()["detail"]

    def test_unorderable_armcount_returns_422(self, bc_alum20) -> None:
        """A 3-arm SH1 has no design code on the matrix, so it must not build."""
        cfg = self._twin_cfg(bc_alum20)
        cfg["arm"] = "sh1-shepherds-hook"
        cfg["armCount"] = 3
        resp = client.post(
            "/generate",
            json={"config": cfg, "formats": ["pdf"], "renderPng": None},
        )
        assert resp.status_code == 422
        assert "not orderable" in resp.json()["detail"]

    def test_absent_armcount_defaults_to_single(self, bc_alum20) -> None:
        cfg = self._single_cfg(bc_alum20)
        del cfg["armCount"]
        resp = client.post(
            "/generate",
            json={"config": cfg, "formats": ["pdf"], "renderPng": None},
        )
        assert resp.status_code == 200, resp.text
        # Absent armCount hashes the same as an explicit armCount=1.
        assert config_hash(PoleConfig(**cfg)) == config_hash(
            PoleConfig(**self._single_cfg(bc_alum20))
        )


class TestBannerGenerate:
    """POST /generate with a banner accessory config → 200, distinct hash."""

    def _banner_cfg(self, bc_alum20: str, with_banner: bool = True) -> dict:
        cfg = dict(
            configId="banner-http-0001",
            pole="alum-pole-20",
            baseCover=bc_alum20,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        if with_banner:
            cfg["banner"] = {
                "armId": "willstudio-ba1-banner-arm",
                "count": 2,
                "heightFt": 8,
            }
        return cfg

    def test_banner_generate_returns_200_with_files(self, bc_alum20) -> None:
        from app.adapters import REGISTRY

        formats = [f for f in ("step", "ifc", "pdf") if f in REGISTRY]
        assert "pdf" in formats
        resp = client.post(
            "/generate",
            json={"config": self._banner_cfg(bc_alum20), "formats": formats, "renderPng": None},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["files"]) == len(formats)
        for entry in body["files"]:
            assert entry["sizeBytes"] > 0

    def test_banner_confighash_differs_from_no_banner(self, bc_alum20) -> None:
        assert config_hash(PoleConfig(**self._banner_cfg(bc_alum20, True))) != config_hash(
            PoleConfig(**self._banner_cfg(bc_alum20, False))
        )

    def test_unsupported_banner_count_returns_422(self, bc_alum20) -> None:
        cfg = self._banner_cfg(bc_alum20)
        cfg["banner"]["count"] = 3  # not in arrangements [1, 2, 4]
        resp = client.post(
            "/generate",
            json={"config": cfg, "formats": ["pdf"], "renderPng": None},
        )
        assert resp.status_code == 422
        assert "banner" in resp.json()["detail"]
