"""Shell-mesh assembly (Phase 0.17): the accurate-IFC geometry source.

Pins the socket walk against physics: every piece must land where the
composited viewer puts it (same catalog math), heights in meters +Y up.
Skips wholesale when the committed shells are absent (a checkout without
geometry-service/assets/shells still tests everything else).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.models import PoleConfig
from app.shellgeom import FT_TO_M, has_shell, shell_assembly

_CATALOG = json.loads(
    (Path(__file__).resolve().parents[2] / "public" / "catalog.json").read_text()
)

pytestmark = pytest.mark.skipif(
    not has_shell("gvx-pendant"), reason="service shells not exported on this machine"
)


def _cfg(**over) -> PoleConfig:
    base = dict(
        configId="shelltest",
        brand="WiLLstudio",
        fixture="gvx-pendant",
        arm="sh1-shepherds-hook",
        pole="alum-pole-12",
        baseCover="bc-cl2-medium-clamshell",
        finish="matte-black",
        rev=1,
    )
    base.update(over)
    return PoleConfig(**base)


def _piece(asm, name: str):
    match = [p for p in asm.pieces if p.name == name]
    assert match, f"missing piece {name!r}; have {[p.name for p in asm.pieces]}"
    return match[0]


class TestCoreAssembly:
    def test_full_config_assembles_all_core_pieces(self):
        asm = shell_assembly(_CATALOG, _cfg())
        assert asm is not None
        names = [p.name for p in asm.pieces]
        for expected in ("Pole", "Pole Base", "Hand Hole", "Base Cover", "Arm", "Fixture"):
            assert expected in names
        # Phase 0.17 (Tyler 8/20): the pole is GENERATED from catalog
        # dimensions, so an unspecified wall thickness is disclosed rather
        # than silently modeled — the only warning a full config raises.
        assert [w for w in asm.warnings if "wall" not in w] == []

    def test_pole_is_generated_smooth_and_exact(self):
        """The engineering export is a 256-tri tube the shell pipeline cut to
        121 — a coarse prism. Generating it gives exact radii at any length,
        with no per-length source file (Tyler 8/20)."""
        asm = shell_assembly(_CATALOG, _cfg())
        pole = _piece(asm, "Pole")
        # Smooth: 96 segments × 4 bands × 2 triangles.
        assert len(pole.tris) == 96 * 4 * 2
        # Exact 4.00 in OD — measured, not approximated.
        r = np.sqrt(pole.verts[:, 0] ** 2 + pole.verts[:, 2] ** 2).max()
        assert r == pytest.approx(4.0 * 0.0254 / 2, abs=1e-9)
        # Hollow: an inner bore exists at the C-wall (0.125 in) by default.
        r_in = np.sqrt(pole.verts[:, 0] ** 2 + pole.verts[:, 2] ** 2).min()
        assert r_in == pytest.approx(r - 0.125 * 0.0254, abs=1e-9)

    def test_chosen_wall_thickness_drives_the_bore(self):
        asm = shell_assembly(
            _CATALOG, _cfg(specOptions={"pole": {"wall-thickness": "E"}})
        )
        pole = _piece(asm, "Pole")
        rad = np.sqrt(pole.verts[:, 0] ** 2 + pole.verts[:, 2] ** 2)
        assert rad.max() - rad.min() == pytest.approx(0.250 * 0.0254, abs=1e-9)
        assert not any("wall" in w for w in asm.warnings)

    def test_any_length_needs_no_new_source_file(self):
        """Every catalog height — and the crop line never moves."""
        for pole_id, ft in (
            ("alum-pole-8", 8),
            ("alum-pole-15", 15),
            ("alum-pole-20", 20),
        ):
            asm = shell_assembly(_CATALOG, _cfg(pole=pole_id))
            pole = _piece(asm, "Pole")
            assert pole.verts[:, 1].max() == pytest.approx(ft * FT_TO_M, abs=1e-6)
            assert pole.verts[:, 1].min() == pytest.approx(0.08, abs=1e-9)

    def test_pole_is_cropped_at_its_base_and_tops_at_its_height(self):
        asm = shell_assembly(_CATALOG, _cfg())
        pole = _piece(asm, "Pole")
        assert pole.verts[:, 1].min() == pytest.approx(0.08, abs=1e-3)
        assert pole.verts[:, 1].max() == pytest.approx(12 * FT_TO_M, abs=1e-3)

    def test_derived_pole_scales_above_the_fixed_crop_line(self):
        asm = shell_assembly(_CATALOG, _cfg(pole="alum-pole-20"))
        pole = _piece(asm, "Pole")
        # The crop line must NOT stretch with pole height (the graft rule).
        assert pole.verts[:, 1].min() == pytest.approx(0.08, abs=1e-3)
        assert pole.verts[:, 1].max() == pytest.approx(20 * FT_TO_M, abs=1e-3)

    def test_fixture_hangs_at_the_arm_socket(self):
        asm = shell_assembly(_CATALOG, _cfg())
        fixture = _piece(asm, "Fixture")
        pole_top = 12 * FT_TO_M
        # GVX hangs from the SH1 hook: entirely above the pole top region.
        assert fixture.verts[:, 1].min() > pole_top - 0.1
        assert fixture.verts[:, 1].max() < pole_top + 1.2

    def test_twin_arms_double_the_arm_and_fixture_pieces(self):
        asm = shell_assembly(_CATALOG, _cfg(armCount=2))
        arms = [p for p in asm.pieces if p.name.startswith("Arm")]
        fixtures = [p for p in asm.pieces if p.name.startswith("Fixture")]
        assert len(arms) == 2 and len(fixtures) == 2
        # The two arms reach OPPOSITE ways (180°): x extents mirror.
        x1 = arms[0].verts[:, 0]
        x2 = arms[1].verts[:, 0]
        assert x1.max() == pytest.approx(-x2.min(), abs=1e-6)

    def test_missing_core_shell_returns_none_never_a_hybrid(self):
        # tex-post-top is real CAD with a shell; fake a config naming a part
        # that has no shell by using the festoon accessory part as "fixture".
        cfg = _cfg(fixture="willstudio-acc-festoon")
        assert shell_assembly(_CATALOG, cfg) is None


class TestStackingAndPlacements:
    def test_cle_lifts_the_cover_by_its_stack_height(self):
        base = shell_assembly(_CATALOG, _cfg())
        lifted = shell_assembly(
            _CATALOG, _cfg(specOptions={"baseCover": {"accessories": ["CLE"]}})
        )
        d = (
            _piece(lifted, "Base Cover").verts[:, 1].min()
            - _piece(base, "Base Cover").verts[:, 1].min()
        )
        assert d == pytest.approx(0.195, abs=1e-6)
        assert any(p.name == "Clamshell Base Extender" for p in lifted.pieces)

    def test_placed_hand_hole_centres_at_its_height(self):
        asm = shell_assembly(
            _CATALOG,
            _cfg(
                specOptions={"pole": {"options": ["HHUR"]}},
                accessoryPlacements={"HHUR": [{"heightFt": 5, "orientation": 90}]},
            ),
        )
        hh = _piece(asm, "Additional Hand Hole")
        centre = (hh.verts[:, 1].min() + hh.verts[:, 1].max()) / 2
        assert centre == pytest.approx(5 * FT_TO_M, abs=1e-3)
        # The section is a full tube, so its bbox is rotation-invariant — the
        # orientation shows in the CENTROID: the hole frame bulges +X at 0°,
        # and rotateY(90) maps that bulge onto −Z (x'=z, z'=−x).
        assert hh.verts[:, 2].mean() < -0.003
        assert abs(hh.verts[:, 0].mean()) < 0.003
        at_zero = shell_assembly(
            _CATALOG,
            _cfg(
                specOptions={"pole": {"options": ["HHUR"]}},
                accessoryPlacements={"HHUR": [{"heightFt": 5, "orientation": 0}]},
            ),
        )
        hh0 = _piece(at_zero, "Additional Hand Hole")
        assert hh0.verts[:, 0].mean() > 0.003

    def test_festoon_degrades_with_a_warning_not_a_fallback(self):
        asm = shell_assembly(
            _CATALOG,
            _cfg(
                specOptions={"pole": {"options": ["FSTR"]}},
                accessoryPlacements={"FSTR": [{"heightFt": 4, "orientation": 0}]},
            ),
        )
        assert asm is not None  # core still shell-accurate
        assert any("willstudio-acc-festoon" in w for w in asm.warnings)
        assert not any("Festoon" in p.name for p in asm.pieces)
