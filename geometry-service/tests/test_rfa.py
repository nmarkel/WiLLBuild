"""Tests for the RFA adapter — Task 4 (Phase 0.4).

TDD order: tests written before implementation. Watch each fail first.

Covered behaviours
------------------
(a) rfa file produced; ends .rfa
(b) contains configId / config hash + DISCLAIMER + mock note
(c) determinism: two mock runs are byte-identical
(d) no env creds → MockApsClient selected + warning emitted on ctx
(e) both env vars set → RealApsClient selected via get_aps_client (no .submit call)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name, config_hash


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="module")
def default_cfg() -> PoleConfig:
    return PoleConfig(
        configId="test-rfa-abc12345",
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


@pytest.fixture(scope="module")
def built_assembly(cat, default_cfg):
    return build_assembly(cat, default_cfg)


def _make_ctx(out_dir: Path, cat: dict, cfg: PoleConfig, assembly):
    from app.adapters.base import GenContext
    return GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=out_dir,
        base_name=base_name(cat, cfg),
        assembly=assembly,
        render_png=None,
        summary={},
    )


# ---------------------------------------------------------------------------
# Import the adapters under test — fails until implementation exists
# ---------------------------------------------------------------------------

from app.adapters.rfa_adapter import RfaAdapter  # noqa: E402
from app.adapters.aps_client import MockApsClient, RealApsClient, get_aps_client  # noqa: E402


# ---------------------------------------------------------------------------
# (a) File produced; ends .rfa
# ---------------------------------------------------------------------------

class TestRfaFileProduced:
    @pytest.fixture(scope="class")
    def generated_rfa(self, tmp_path_factory, cat, default_cfg, built_assembly) -> Path:
        out = tmp_path_factory.mktemp("rfa_content")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        paths = RfaAdapter().generate(ctx)
        assert len(paths) == 1
        return paths[0]

    def test_file_exists(self, generated_rfa):
        assert generated_rfa.exists()

    def test_file_ends_rfa(self, generated_rfa, cat, default_cfg):
        assert generated_rfa.name.endswith(".rfa")
        assert generated_rfa.name == f"{base_name(cat, default_cfg)}.rfa"


# ---------------------------------------------------------------------------
# (b) Content: configId / config hash + DISCLAIMER + mock note
# ---------------------------------------------------------------------------

class TestRfaContent:
    @pytest.fixture(scope="class")
    def rfa_bytes(self, tmp_path_factory, cat, default_cfg, built_assembly) -> bytes:
        out = tmp_path_factory.mktemp("rfa_bytes")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        paths = RfaAdapter().generate(ctx)
        return paths[0].read_bytes()

    @pytest.fixture(scope="class")
    def rfa_manifest(self, rfa_bytes) -> dict:
        """Parse the JSON manifest from the mock payload."""
        text = rfa_bytes.decode("ascii")
        # Header line is "WiLL-RFA-MOCK v1\n"; JSON follows
        lines = text.split("\n", 1)
        assert lines[0] == "WiLL-RFA-MOCK v1", f"Unexpected header: {lines[0]!r}"
        return json.loads(lines[1])

    def test_header_line(self, rfa_bytes):
        first_line = rfa_bytes.decode("ascii").split("\n", 1)[0]
        assert first_line == "WiLL-RFA-MOCK v1"

    def test_config_id_in_manifest(self, rfa_manifest, default_cfg):
        assert rfa_manifest["params"]["family_name"] == f"WiLL Pole Assembly {default_cfg.configId}"

    def test_config_hash_in_manifest(self, rfa_manifest, default_cfg):
        assert rfa_manifest["configHash"] == config_hash(default_cfg)

    def test_disclaimer_in_manifest(self, rfa_manifest):
        assert rfa_manifest["disclaimer"] == DISCLAIMER

    def test_mock_note_in_manifest(self, rfa_manifest):
        assert "Mock APS output" in rfa_manifest["note"]
        assert "Autodesk" in rfa_manifest["note"]


# ---------------------------------------------------------------------------
# (c) Determinism: two mock runs are byte-identical
# ---------------------------------------------------------------------------

class TestRfaDeterminism:
    def test_two_runs_byte_identical(self, tmp_path_factory, cat, default_cfg, built_assembly):
        adapter = RfaAdapter()
        out1 = tmp_path_factory.mktemp("rfa_det_a")
        out2 = tmp_path_factory.mktemp("rfa_det_b")
        p1 = adapter.generate(_make_ctx(out1, cat, default_cfg, built_assembly))[0]
        p2 = adapter.generate(_make_ctx(out2, cat, default_cfg, built_assembly))[0]
        assert p1.read_bytes() == p2.read_bytes(), "RFA mock output is not byte-deterministic"


# ---------------------------------------------------------------------------
# (d) No env creds → MockApsClient + warning emitted
# ---------------------------------------------------------------------------

class TestRfaMockClientSelected:
    def test_no_creds_selects_mock(self, monkeypatch):
        """When APS env vars are absent, get_aps_client returns a MockApsClient."""
        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)
        client, is_mock = get_aps_client()
        assert is_mock is True
        assert isinstance(client, MockApsClient)

    def test_mock_warning_emitted(self, tmp_path_factory, cat, default_cfg, built_assembly, monkeypatch):
        """Adapter appends the mock warning to ctx.warnings when mock client is used."""
        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)
        out = tmp_path_factory.mktemp("rfa_warn")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        assert ctx.warnings == []
        RfaAdapter().generate(ctx)
        assert len(ctx.warnings) == 1
        assert "mock" in ctx.warnings[0].lower()
        assert "autodesk" in ctx.warnings[0].lower()


# ---------------------------------------------------------------------------
# (e) Both env vars set → RealApsClient selected (no .submit call)
# ---------------------------------------------------------------------------

class TestRfaRealClientSelected:
    def test_real_client_selected_when_creds_set(self, monkeypatch):
        """When APS_CLIENT_ID and APS_CLIENT_SECRET are set, get_aps_client returns RealApsClient."""
        monkeypatch.setenv("APS_CLIENT_ID", "fake-client-id")
        monkeypatch.setenv("APS_CLIENT_SECRET", "fake-client-secret")
        client, is_mock = get_aps_client()
        assert is_mock is False
        assert isinstance(client, RealApsClient)

    def test_real_client_not_mock(self, monkeypatch):
        """RealApsClient is NOT a MockApsClient."""
        monkeypatch.setenv("APS_CLIENT_ID", "fake-client-id")
        monkeypatch.setenv("APS_CLIENT_SECRET", "fake-client-secret")
        client, is_mock = get_aps_client()
        assert not isinstance(client, MockApsClient)


# ---------------------------------------------------------------------------
# Registry + API integration
# ---------------------------------------------------------------------------

class TestRfaRegistry:
    def test_rfa_in_registry(self):
        from app.adapters import REGISTRY
        assert "rfa" in REGISTRY

    def test_rfa_adapter_available(self):
        assert RfaAdapter().available() is True

    def test_health_reports_rfa(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["adapters"].get("rfa") is True

    def test_generate_rfa_returns_file_with_warning(self, monkeypatch):
        """POST /generate with formats=['rfa'] returns one .rfa file and mock warning."""
        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "integ-rfa-12345678",
                    "pole": "alum-pole-20",
                    "baseCover": "bc-fluted",
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["rfa"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["files"]) == 1
        assert body["files"][0]["format"] == "rfa"
        assert body["files"][0]["filename"].endswith(".rfa")
        # Mock warning should be surfaced
        assert any("mock" in w.lower() for w in body["warnings"])
