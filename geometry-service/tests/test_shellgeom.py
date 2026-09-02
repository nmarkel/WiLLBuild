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


class TestAnalyticPole:
    """The pole shaft is a plain cylinder in the real CAD — the shell mesh is a
    decimated 32-segment prism (radius wobbling 47.5–50.9 mm) that flat-shades
    badly in IFC viewers. The piece must carry its exact analytic description
    (radius from the catalog placeholder, the same source the kit builds from)
    so solid-capable consumers can emit real geometry instead of the mesh."""

    def test_pole_piece_carries_its_analytic_cylinder(self):
        asm = shell_assembly(_CATALOG, _cfg())
        cyl = _piece(asm, "Pole").cylinder
        assert cyl is not None
        assert cyl.radius_m == pytest.approx(0.0508)
        assert cyl.y0_m == pytest.approx(0.08)
        assert cyl.y1_m == pytest.approx(12 * FT_TO_M)

    def test_derived_pole_cylinder_tops_at_its_own_height(self):
        asm = shell_assembly(_CATALOG, _cfg(pole="alum-pole-20"))
        cyl = _piece(asm, "Pole").cylinder
        assert cyl is not None
        assert cyl.y0_m == pytest.approx(0.08)
        assert cyl.y1_m == pytest.approx(20 * FT_TO_M)

    def test_mesh_pieces_carry_no_cylinder(self):
        asm = shell_assembly(_CATALOG, _cfg())
        for name in ("Pole Base", "Hand Hole", "Base Cover", "Arm", "Fixture"):
            assert _piece(asm, name).cylinder is None


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


class TestPseudoArmShell:
    """Phase 0.19: direct-mount generates its schematic tenon adapter.

    A pseudo-part needs no CAD ever (0.12), so 'no shell file' is its
    permanent, correct state — but the no-hybrid rule used to read it as a
    missing core, dropping every tenon-fixture config to the parametric kit
    the moment TEX became configurable.  Like the pole, its truth is its
    catalog placeholder, generated on the fly.
    """

    def test_tex_on_direct_mount_is_shell_covered(self):
        asm = shell_assembly(
            _CATALOG,
            _cfg(fixture="tex-post-top", arm="direct-mount", baseCover="bc-cl3-large-clamshell"),
        )
        assert asm is not None
        names = [p.name for p in asm.pieces]
        assert "Arm" in names and "Fixture" in names
        # The adapter is the catalog's schematic frustum: 0.08 m tall, on axis.
        arm = _piece(asm, "Arm")
        assert arm.verts[:, 1].min() == pytest.approx(0.0, abs=1e-6) or arm.verts[:, 1].min() > 0
        assert (arm.verts[:, 1].max() - arm.verts[:, 1].min()) == pytest.approx(0.08, abs=1e-6)
        assert float(np.abs(arm.verts[:, [0, 2]]).max()) <= 0.04 + 1e-6
        # The fixture SEATS AT THE TENON'S BASE (the pole top): its fitter bore
        # is 139.7 mm deep (measured, TEX-Post-Top.STEP) and swallows the 80 mm
        # tenon whole — the FR2 sleeve-over-tenon rule (0.12, Nick 8/11),
        # applied to direct-mount in 0.19 once TEX's real CAD provided the
        # ground truth 0.12 lacked.  Its sleeve bottom rests exactly on the
        # pole top, never floating above it on an exposed stub.
        pole_top = _piece(asm, "Pole").verts[:, 1].max()
        assert _piece(asm, "Fixture").verts[:, 1].min() == pytest.approx(pole_top, abs=1e-6)

    def test_generated_frustum_is_a_closed_solid_wound_like_the_pole(self):
        from app.shellgeom import _frustum_mesh, _pole_tube_mesh

        v, t = _frustum_mesh(0.04, 0.03, 0.0, 0.08)
        # The frustum must be watertight, its magnitude the analytic volume,
        # and its winding THE SAME as the shipped pole tube's — the convention
        # the IFC/STEP consumers were verified against in 0.17.5.  (By the
        # right-hand signed-volume convention both come out negative; the
        # consumers' orientation handling is the authority, not that sign.)
        signed = float(np.einsum("ij,ij->i", v[t[:, 0]], np.cross(v[t[:, 1]], v[t[:, 2]])).sum()) / 6.0
        expected = np.pi * 0.08 * (0.04**2 + 0.04 * 0.03 + 0.03**2) / 3.0
        assert abs(signed) == pytest.approx(expected, rel=1e-3)
        pv, pt = _pole_tube_mesh(0.0508, 0.003175, 0.0, 1.0)
        pole_signed = float(
            np.einsum("ij,ij->i", pv[pt[:, 0]], np.cross(pv[pt[:, 1]], pv[pt[:, 2]])).sum()
        )
        assert np.sign(signed) == np.sign(pole_signed)
        # …and every edge is shared by exactly two triangles = watertight.
        edges: dict[tuple[int, int], int] = {}
        for a, b, c in t:
            for e in ((a, b), (b, c), (c, a)):
                edges[tuple(sorted(e))] = edges.get(tuple(sorted(e)), 0) + 1
        assert set(edges.values()) == {2}

    def test_only_pseudo_parts_take_the_generated_path(self):
        # Negative control: a REAL arm with no shell must still drop the
        # assembly to the parametric kit — the generated path is gated on
        # pseudoPart, never a loophole around the no-hybrid rule.
        from app.shellgeom import _pseudo_arm_shell

        real_arm = next(p for p in _CATALOG["parts"] if p["id"] == "sh1-shepherds-hook")
        assert _pseudo_arm_shell(real_arm) is None
        fake = dict(real_arm)
        fake.pop("pseudoPart", None)
        fake["placeholder"] = {"kind": "pole", "heightM": 0.08, "radiusBottomM": 0.04, "radiusTopM": 0.03}
        assert _pseudo_arm_shell(fake) is None


def test_pseudo_parts_are_arm_only():
    """The pseudo-shell escape hatch is scoped to the arm slot, so the catalog
    must not grow a pseudo part in another core slot without the code moving
    with it (Phase 0.19 review).

    `shell_assembly`'s no-hybrid guard lets a `pseudoPart` through on the
    strength of `_pseudo_arm_shell`, but only the ARM branch pairs `has_shell`
    with that helper — base cover and fixture call `load_shell` unconditionally.
    A pseudo base cover or fixture would therefore clear the guard and then
    raise FileNotFoundError instead of degrading to the parametric kit. If this
    fails, add the `has_shell(...) else _pseudo_arm_shell(...)` branch at that
    slot's `load_shell` call before adding the part.
    """
    offenders = [
        (p["id"], p.get("slot"))
        for p in _CATALOG["parts"]
        if p.get("pseudoPart") and p.get("slot") != "arm"
    ]
    assert not offenders, f"pseudo parts outside the arm slot: {offenders}"
