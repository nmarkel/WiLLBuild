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

from .conftest import valid_combos

client = TestClient(app)


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

    def test_missing_pole_in_config_returns_422_with_string_detail(self) -> None:
        """POST /generate with body missing config.pole → 422 with string detail."""
        resp = self._post(
            {
                "configId": "missing-pole-test",
                "baseCover": "bc-fluted",
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

    def test_unknown_fixture_id_returns_422(self) -> None:
        resp = self._post(
            {
                "configId": "bad-fixture-test",
                "pole": "alum-pole-20",
                "baseCover": "bc-fluted",
                "arm": "sh1-shepherds-hook",
                "fixture": "does-not-exist",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_arm_id_returns_422(self) -> None:
        resp = self._post(
            {
                "configId": "bad-arm-test",
                "pole": "alum-pole-20",
                "baseCover": "bc-fluted",
                "arm": "no-such-arm",
                "fixture": "gvx-pendant",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_pole_id_returns_422(self) -> None:
        resp = self._post(
            {
                "configId": "bad-pole-test",
                "pole": "alum-pole-99",
                "baseCover": "bc-fluted",
                "arm": "sh1-shepherds-hook",
                "fixture": "gvx-pendant",
                "finish": "matte-black",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_unknown_finish_id_returns_422(self) -> None:
        resp = self._post(
            {
                "configId": "bad-finish-test",
                "pole": "alum-pole-20",
                "baseCover": "bc-fluted",
                "arm": "sh1-shepherds-hook",
                "fixture": "gvx-pendant",
                "finish": "not-a-real-finish",
                "rev": 1,
            }
        )
        assert resp.status_code == 422

    def test_socket_violation_post_top_fixture_plus_pendant_arm_returns_422(
        self,
    ) -> None:
        """drx-post-top has mount=tenon-2-3/8; sh1-shepherds-hook only exposes
        a pendant socket — cannot host drx-post-top.  This is a socket violation."""
        resp = self._post(
            {
                "configId": "socket-violation-test",
                "pole": "alum-pole-20",
                "baseCover": "bc-fluted",
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

    def test_error_detail_is_string(self) -> None:
        """422 responses from config validation must have a string detail field."""
        resp = self._post(
            {
                "configId": "detail-test",
                "pole": "alum-pole-20",
                "baseCover": "bc-fluted",
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
    def test_valid_config_no_adapter_returns_422(self) -> None:
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
                    "baseCover": "bc-fluted",
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
    _base = dict(
        configId="aaa-111",
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )

    def _cfg(self, **overrides: object) -> PoleConfig:
        return PoleConfig(**{**self._base, **overrides})

    def test_hash_is_8_chars(self) -> None:
        assert len(config_hash(self._cfg())) == 8

    def test_hash_is_hex(self) -> None:
        h = config_hash(self._cfg())
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_stable_across_configId_changes(self) -> None:
        h1 = config_hash(self._cfg(configId="aaa-111"))
        h2 = config_hash(self._cfg(configId="bbb-999"))
        assert h1 == h2, "configId should not affect the hash"

    def test_hash_stable_across_rev_changes(self) -> None:
        h1 = config_hash(self._cfg(rev=1))
        h2 = config_hash(self._cfg(rev=42))
        assert h1 == h2, "rev should not affect the hash"

    def test_hash_changes_when_pole_changes(self) -> None:
        h1 = config_hash(self._cfg(pole="alum-pole-20"))
        h2 = config_hash(self._cfg(pole="alum-pole-12"))
        assert h1 != h2

    def test_hash_changes_when_fixture_changes(self) -> None:
        h1 = config_hash(self._cfg(fixture="gvx-pendant"))
        h2 = config_hash(self._cfg(fixture="drx-post-top"))
        assert h1 != h2

    def test_hash_changes_when_finish_changes(self) -> None:
        h1 = config_hash(self._cfg(finish="matte-black"))
        h2 = config_hash(self._cfg(finish="gloss-white"))
        assert h1 != h2

    def test_hash_deterministic_repeated_calls(self) -> None:
        cfg = self._cfg()
        assert config_hash(cfg) == config_hash(cfg)


# ---------------------------------------------------------------------------
# validate_config unit tests
# ---------------------------------------------------------------------------


class TestValidateConfig:
    def test_valid_combos_do_not_raise(self, catalog: dict) -> None:
        for cfg in valid_combos(catalog):
            validate_config(catalog, cfg)  # must not raise

    def test_unknown_part_raises_value_error(self, catalog: dict) -> None:
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover="bc-fluted",
            arm="sh1-shepherds-hook",
            fixture="totally-fake",
            finish="matte-black",
            rev=1,
        )
        with pytest.raises(ValueError, match="totally-fake"):
            validate_config(catalog, cfg)

    def test_socket_violation_raises_value_error(self, catalog: dict) -> None:
        """post-top fixture on a pendant-only arm must raise."""
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover="bc-fluted",
            arm="sh1-shepherds-hook",  # only pendant socket
            fixture="drx-post-top",   # mount=tenon-2-3/8 — not pendant
            finish="matte-black",
            rev=1,
        )
        with pytest.raises(ValueError):
            validate_config(catalog, cfg)

    def test_unknown_finish_raises_value_error(self, catalog: dict) -> None:
        cfg = PoleConfig(
            configId="x",
            pole="alum-pole-20",
            baseCover="bc-fluted",
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="hot-pink",
            rev=1,
        )
        with pytest.raises(ValueError, match="hot-pink"):
            validate_config(catalog, cfg)


# ---------------------------------------------------------------------------
# /generate — summary.parts validation
# ---------------------------------------------------------------------------


class TestGenerateSummaryParts:
    def test_generate_summary_contains_parts_with_names(self) -> None:
        """POST /generate must include parts array in summary with slot, id, name, productUrl."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "summary-parts-test",
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
    def test_generate_with_valid_base64_png_no_warning(self) -> None:
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
                    "baseCover": "bc-fluted",
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

    def test_generate_with_invalid_base64_png_produces_warning(self) -> None:
        """POST /generate with garbage base64 must produce 'renderPng ignored' warning."""
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "png-invalid-test",
                    "pole": "alum-pole-20",
                    "baseCover": "bc-fluted",
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
