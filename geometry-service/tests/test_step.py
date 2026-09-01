"""Tests for the STEP adapter — Task 3 (Phase 0.3).

TDD order: tests written before implementation. Watch each fail first.

Covered behaviours
------------------
1. Generating a default config produces a file named
   WiLL_v<outputVersion>_<hash>_<id8>.step
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

from .conftest import first_base_cover_for


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg(cat: dict, config_id: str | None = None) -> PoleConfig:
    """Return a minimal valid PoleConfig for tests."""
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
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
def default_cfg(cat) -> PoleConfig:
    return _default_cfg(cat, "test-cfg-abc12345")


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
        """Filename must be WiLL_v<outputVersion>_<config_hash>_<id8>.step.

        Derived from base_name() rather than spelled out, so the Phase 0.20 (C)
        version segment did not require touching this assertion.
        """
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
    @classmethod
    def step_content(cls, tmp_path_factory, cat, default_cfg, built_assembly):
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
    """Phase 0.17 (Tyler 8/19): what "fidelity" means changed with the format.

    The STEP is now AP242 TESSELLATED, assembled from the real products'
    gated exterior shells — a surface mesh, so it has no solid volume to
    compare, and its geometry is deliberately NOT the parametric kit solid's.
    The meaningful check became the envelope: a re-import must land on the
    same bounding box the shell assembly measures (mm, +Z up). The old
    volume-fidelity assertion still guards the concept-kit fallback path,
    which does export a solid.
    """

    def test_reimported_envelope_matches_the_shell_assembly(
        self, tmp_path, cat, default_cfg, built_assembly
    ):
        import numpy as np
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
        from OCP.Interface import Interface_Static
        from OCP.STEPControl import STEPControl_Reader

        from app.adapters.base import GenContext
        from app.shellgeom import shell_assembly

        shells = shell_assembly(cat, default_cfg)
        if shells is None:
            pytest.skip("no gated shells on this machine — kit fallback path")

        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        paths = StepAdapter().generate(ctx)

        reader = STEPControl_Reader()
        Interface_Static.SetCVal_s("read.step.tessellated", "On")
        reader.ReadFile(str(paths[0]))
        reader.TransferRoots()
        box = Bnd_Box()
        BRepBndLib.Add_s(reader.OneShape(), box)
        xmin, ymin, zmin, xmax, ymax, zmax = box.Get()

        # Expected envelope straight from the shell pieces (meters, +Y up →
        # millimetres, +Z up: x, −z, y).
        verts = np.vstack([p.verts for p in shells.pieces])
        exp_z = (verts[:, 1].min() * 1000.0, verts[:, 1].max() * 1000.0)
        exp_x = (verts[:, 0].min() * 1000.0, verts[:, 0].max() * 1000.0)
        assert zmin == pytest.approx(exp_z[0], abs=1.0), "re-imported base height drifted"
        assert zmax == pytest.approx(exp_z[1], abs=1.0), "re-imported overall height drifted"
        assert xmin == pytest.approx(exp_x[0], abs=1.0)
        assert xmax == pytest.approx(exp_x[1], abs=1.0)

    def test_pole_ships_as_a_real_cylinder_not_a_tessellated_prism(
        self, tmp_path, cat, default_cfg, built_assembly
    ):
        """Phase 0.17.5: the decimated pole shell is a 32-segment prism that
        flat-shades into visible facets on import. The shaft must export as a
        real B-rep cylinder (its ShellPiece carries the analytic spec), while
        every other piece stays a tessellated face."""
        from app.adapters.base import GenContext
        from app.shellgeom import shell_assembly

        shells = shell_assembly(cat, default_cfg)
        if shells is None:
            pytest.skip("no gated shells on this machine — kit fallback path")

        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        paths = StepAdapter().generate(ctx)
        text = paths[0].read_text(encoding="ascii")

        radii = re.findall(
            r"CYLINDRICAL_SURFACE\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*([0-9.Ee+-]+)\s*\)", text
        )
        assert any(float(r) == pytest.approx(50.8) for r in radii), (
            "no B-rep cylinder of the pole's 50.8 mm radius in the STEP"
        )
        # one tessellated entity per piece EXCEPT the pole shaft. OCC encodes
        # mesh-only faces as TRIANGULATED_FACE in an all-mesh compound but as
        # TRIANGULATED_SURFACE_SET once a B-rep solid shares the compound —
        # both are AP242 tessellated items (the reimport-envelope test above
        # proves the mixed file reads back whole).
        tessellated = text.count("TRIANGULATED_FACE") + text.count("TRIANGULATED_SURFACE_SET")
        assert tessellated == len(shells.pieces) - 1

    def test_kit_fallback_still_exports_a_solid_with_matching_volume(
        self, tmp_path, cat, default_cfg, built_assembly, monkeypatch
    ):
        """The concept-kit path (no shell for a configured part) must still
        produce a real solid whose volume round-trips within 0.1%."""
        from build123d import import_step

        import app.adapters.step_adapter as step_mod
        from app.adapters.base import GenContext

        monkeypatch.setattr(step_mod, "shell_assembly", lambda *_a, **_k: None)

        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, default_cfg),
            assembly=built_assembly,
            render_png=None,
            summary={},
        )
        paths = StepAdapter().generate(ctx)

        reimported = import_step(paths[0])
        source_vol = built_assembly.solid.volume
        assert abs(reimported.volume - source_vol) / source_vol < 0.001


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
    def test_step_is_registered_but_not_advertised(self):
        """The STEP adapter is registered; /health no longer advertises it.

        Phase 0.20 (B): /health reports what is SERVABLE, not what is built.
        STEP has no download card of its own — the STEP a customer receives
        rides inside the bundle — so advertising it would promise a format
        /generate refuses. The adapter itself is untouched and every other test
        in this file still exercises it.
        """
        from fastapi.testclient import TestClient
        from app.adapters import REGISTRY
        from app.main import app
        assert "step" in REGISTRY
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert "step" not in resp.json()["adapters"]


# ---------------------------------------------------------------------------
# Test: POST /generate produces a STEP file (integration)
# ---------------------------------------------------------------------------

class TestGenerateStepIntegration:
    def test_generate_step_is_refused_and_the_bundle_carries_it_instead(self, cat):
        """Direct `step` is refused; the merchandised route to a STEP is `bundle`.

        Phase 0.20 (B). Asserting BOTH halves in one place is deliberate: the
        refusal alone would be satisfied by a service that had simply lost the
        ability to make a STEP, which is the regression this pairing catches.
        """
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "integ-test-12345678",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["step"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 422, resp.text

        import zipfile, io
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "integ-test-12345678",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["bundle"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, resp.text
        dl = client.get(resp.json()["files"][0]["url"])
        assert dl.status_code == 200
        names = zipfile.ZipFile(io.BytesIO(dl.content)).namelist()
        assert any(n.endswith(".step") for n in names), names
