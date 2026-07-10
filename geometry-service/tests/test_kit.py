"""Tests for the parametric build123d solid kit (Workstream A).

Every valid catalog combo must build a fused solid that:
  * has positive volume,
  * sits on Z=0 (bbox zmin >= -1 mm),
  * has an overall Z-height within +/-1% of a catalog-derived expectation.

The height expectation is computed generically from catalog data (never
per-part constants): pole top-socket height + arm fixture-socket height (if the
arm has a downstream socket) + the fixture's vertical extent above its own
origin.
"""

from __future__ import annotations

import pytest

from app.catalog import part
from app.kit.assembly import build_assembly
from tests.conftest import valid_combos

M = 1000.0  # catalog meters -> mm


# ---------------------------------------------------------------------------
# Catalog-derived expected-height helpers (generic, data-driven)
# ---------------------------------------------------------------------------

def _fixture_top_extent_m(fixture: dict) -> float:
    """Vertical extent (meters, +Y up) of a fixture above its own origin.

    Returns 0 for pendants that hang entirely below their origin.
    """
    ph = fixture["placeholder"]
    kind = ph["kind"]
    if kind == "lathe":
        return max(0.0, max(y for _r, y in ph["profile"]))
    if kind == "group":
        top = 0.0
        for child in ph["children"]:
            pos_y = child["position"][1]
            spec = child["spec"]
            ck = spec["kind"]
            if ck == "cone":
                ch = spec["heightM"]
            else:  # baseCover / prism / pole
                ch = spec["heightM"]
            top = max(top, pos_y + ch)
        return top
    raise AssertionError(f"unexpected fixture kind {kind!r}")


def _expected_height_m(catalog: dict, cfg) -> float:
    """Overall assembly height (meters) derived from socket + placeholder data."""
    pole = part(catalog, cfg.pole)
    arm = part(catalog, cfg.arm)
    fixture = part(catalog, cfg.fixture)

    pole_top_y = pole["sockets"]["top"]["position"][1]

    # Arm fixture-socket height above the arm origin (0 if the arm has no
    # downstream fixture socket, e.g. direct-mount routes through its 'top').
    arm_socket_y = 0.0
    for sock in arm.get("sockets", {}).values():
        arm_socket_y = max(arm_socket_y, sock["position"][1])

    # The top of the assembly is the higher of: the fixture stacked on the arm
    # socket, OR the arm's own apex (a shepherd's-hook tube arcs above the
    # pendant socket it terminates at).  Account for both, plus the swept tube
    # radius which bulges the apex by ~radiusM.
    fixture_top = arm_socket_y + _fixture_top_extent_m(fixture)
    aph = arm["placeholder"]
    if aph["kind"] == "tube":
        apex = max(pt[1] for pt in aph["points"]) + aph["radiusM"]
        arm_top = max(fixture_top, apex)
    else:
        arm_top = fixture_top

    return pole_top_y + arm_top


# ---------------------------------------------------------------------------
# Parametrized over every valid combo
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def _built(catalog):
    """Build every valid combo once; return {configId: (cfg, BuiltAssembly)}."""
    out = {}
    for cfg in valid_combos(catalog):
        out[cfg.configId] = (cfg, build_assembly(catalog, cfg))
    return out


def test_combo_count(catalog):
    """Sanity: the kit enumerates the expected 561 valid combos.

    Grew from 48 after Workstream G promoted the P1 pole-system parts
    (7 arms, 7 poles, 1 base cover) into the wizard: 17 fixture-arm pairs
    x 11 poles x 3 base covers = 561.
    """
    assert len(valid_combos(catalog)) == 561


def test_every_combo_has_positive_volume(catalog, _built):
    for cfg, built in _built.values():
        assert built.solid.volume > 0, f"{cfg.configId} empty solid"


def test_every_combo_sits_on_ground(catalog, _built):
    for cfg, built in _built.values():
        zmin = built.solid.bounding_box().min.Z
        assert zmin >= -1.0, f"{cfg.configId} floats/sinks: zmin={zmin}"


def test_every_combo_height_within_tolerance(catalog, _built):
    for cfg, built in _built.values():
        expected = _expected_height_m(catalog, cfg) * M
        actual = built.solid.bounding_box().max.Z
        tol = max(expected * 0.01, 5.0)  # +/-1% (min 5mm for tiny extents)
        assert abs(actual - expected) <= tol, (
            f"{cfg.configId}: height {actual:.1f}mm vs expected "
            f"{expected:.1f}mm (tol {tol:.1f})"
        )


def test_20ft_pole_reaches_pole_top(catalog, _built):
    """Any 20 ft pole assembly must reach at least ~6100mm (pole top)."""
    found = False
    for cfg, built in _built.values():
        if cfg.pole == "alum-pole-20":
            found = True
            assert built.dims.pole_height == pytest.approx(6100.0, abs=1.0)
            assert built.solid.bounding_box().max.Z >= 6100.0 - 1.0
    assert found, "no 20 ft pole combo enumerated"


def test_dims_populated(catalog, _built):
    for cfg, built in _built.values():
        d = built.dims
        assert d.overall_height > 0
        assert d.pole_height > 0
        assert d.base_diameter > 0
        assert d.arm_reach >= 0
        assert d.mounting_height > 0
