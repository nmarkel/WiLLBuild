"""Tests for the STEP adapter — Task 3 (Phase 0.3).

TDD order: tests written before implementation. Watch each fail first.

Covered behaviours
------------------
1. Generating a default config produces a file named WiLL_<hash>_<id8>.step
2. The file starts with ISO-10303-21 (valid STEP)
3. FILE_DESCRIPTION contains the config ID and DISCLAIMER
4. Determinism: generate twice into different dirs; strip FILE_NAME line;
   remaining bytes must be identical
5. Re-import volume matches source solid within 0.1%
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name, config_hash


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg(config_id: str | None = None) -> PoleConfig:
    """Return a minimal valid PoleConfig for tests."""
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


def _strip_file_name(content: bytes) -> bytes:
    """Strip FILE_NAME lines (contains a timestamp) for determinism comparison."""
    lines = content.split(b"\n")
    stripped = [ln for ln in lines if not ln.startswith(b"FILE_NAME")]
    return b"\n".join(stripped)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="module")
def default_cfg() -> PoleConfig:
    return _default_cfg("test-cfg-abc12345")


@pytest.fixture(scope="module")
def built_assembly(cat, default_cfg):
    return build_assembly(cat, default_cfg)


# ---------------------------------------------------------------------------
# Import the adapter under test — will fail until implementation exists
# ---------------------------------------------------------------------------

from app.adapters.step_adapter import StepAdapter  # noqa: E402


# ---------------------------------------------------------------------------
# Test: correct output filename
# ---------------------------------------------------------------------------

class TestStepFilename:
    def test_output_file_has_step_extension(self, tmp_path, cat, default_cfg, built_assembly):
        """generate() must produce a .step file."""
        from app.adapters.base import GenContext
        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        adapter = StepAdapter()
        paths = adapter.generate(ctx)
        assert len(paths) == 1
        assert paths[0].suffix == ".step"

    def test_output_filename_matches_naming_convention(self, tmp_path, cat, default_cfg, built_assembly):
        """Filename must be WiLL_<config_hash>_<first-8-chars-of-configId>.step"""
        from app.adapters.base import GenContext
        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        adapter = StepAdapter()
        paths = adapter.generate(ctx)
        expected_name = f"{base_name(cat, default_cfg)}.step"
        assert paths[0].name == expected_name

    def test_output_file_exists(self, tmp_path, cat, default_cfg, built_assembly):
        """The generated file must exist on disk."""
        from app.adapters.base import GenContext
        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        adapter = StepAdapter()
        paths = adapter.generate(ctx)
        assert paths[0].exists()


# ---------------------------------------------------------------------------
# Test: valid STEP content
# ---------------------------------------------------------------------------

class TestStepContent:
    @pytest.fixture(scope="class")
    def step_content(self, tmp_path_factory, cat, default_cfg, built_assembly):
        from app.adapters.base import GenContext
        out = tmp_path_factory.mktemp("step_content")
        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=out,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        adapter = StepAdapter()
        paths = adapter.generate(ctx)
        return paths[0].read_bytes()

    def test_step_starts_with_iso_header(self, step_content):
        """STEP files must begin with ISO-10303-21."""
        assert step_content.startswith(b"ISO-10303-21")

    def test_file_description_contains_config_id(self, step_content, default_cfg):
        """FILE_DESCRIPTION must carry the config ID."""
        text = step_content.decode("ascii")
        assert default_cfg.configId in text

    def test_file_description_contains_disclaimer(self, step_content):
        """FILE_DESCRIPTION must carry the DISCLAIMER text."""
        text = step_content.decode("ascii")
        assert DISCLAIMER in text

    def test_file_description_mentions_will_concept_model(self, step_content, default_cfg):
        """FILE_DESCRIPTION first string must say 'WiLL concept model config <id> rev <rev>'."""
        text = step_content.decode("ascii")
        expected = f"WiLL concept model config {default_cfg.configId} rev {default_cfg.rev}"
        assert expected in text


# ---------------------------------------------------------------------------
# Test: determinism
# ---------------------------------------------------------------------------

class TestStepDeterminism:
    def test_two_exports_are_identical_after_stripping_file_name(
        self, tmp_path_factory, cat, default_cfg, built_assembly
    ):
        """Export twice; strip FILE_NAME lines; remaining bytes must match."""
        from app.adapters.base import GenContext

        adapter = StepAdapter()

        out1 = tmp_path_factory.mktemp("det_a")
        ctx1 = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=out1,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        paths1 = adapter.generate(ctx1)

        out2 = tmp_path_factory.mktemp("det_b")
        ctx2 = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=out2,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        paths2 = adapter.generate(ctx2)

        stripped1 = _strip_file_name(paths1[0].read_bytes())
        stripped2 = _strip_file_name(paths2[0].read_bytes())
        assert stripped1 == stripped2, "STEP output is not deterministic (after stripping FILE_NAME)"


# ---------------------------------------------------------------------------
# Test: re-import volume fidelity
# ---------------------------------------------------------------------------

class TestStepReimport:
    def test_reimported_volume_within_tolerance(self, tmp_path, cat, default_cfg, built_assembly):
        """Re-import the STEP file; volume must be within 0.1% of source solid."""
        from build123d import import_step

        from app.adapters.base import GenContext

        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        adapter = StepAdapter()
        paths = adapter.generate(ctx)

        reimported = import_step(paths[0])
        source_vol = built_assembly.solid.volume
        reimported_vol = reimported.volume

        tol = 0.001  # 0.1%
        assert abs(reimported_vol - source_vol) / source_vol < tol, (
            f"Volume mismatch: source={source_vol:.1f}, reimported={reimported_vol:.1f}"
        )


# ---------------------------------------------------------------------------
# Test: adapter registry
# ---------------------------------------------------------------------------

class TestAdapterRegistry:
    def test_step_in_registry(self):
        """REGISTRY must contain a 'step' key after importing adapters."""
        from app.adapters import REGISTRY
        assert "step" in REGISTRY

    def test_step_adapter_is_available(self):
        """StepAdapter.available() must return True in this environment."""
        assert StepAdapter().available() is True


# ---------------------------------------------------------------------------
# Test: /health endpoint shows step adapter registered
# ---------------------------------------------------------------------------

class TestHealthShowsStepAdapter:
    def test_health_reports_step_adapter(self):
        """GET /health must include 'step': true in adapters when STEP registered."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["adapters"].get("step") is True


# ---------------------------------------------------------------------------
# Test: POST /generate produces a STEP file (integration)
# ---------------------------------------------------------------------------

class TestGenerateStepIntegration:
    def test_generate_step_returns_200_with_file_entry(self):
        """POST /generate with format=step returns 200 and a file entry."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "integ-test-12345678",
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
        assert len(body["files"]) == 1
        assert body["files"][0]["format"] == "step"
        assert body["files"][0]["filename"].endswith(".step")
