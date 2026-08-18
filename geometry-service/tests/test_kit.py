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
    return _spec_top_extent_m(fixture["placeholder"])


def _spec_top_extent_m(spec: dict) -> float:
    """Vertical extent (meters) of any placeholder spec above its origin."""
    kind = spec["kind"]
    if kind == "lathe":
        return max(0.0, max(y for _r, y in spec["profile"]))
    if kind == "box":
        return spec["sizeM"][1] if spec.get("direction", "up") == "up" else 0.0
    if kind == "cone":
        return spec["heightM"] if spec.get("direction", "up") == "up" else 0.0
    if kind in ("prism", "pole", "baseCover"):
        return spec["heightM"]
    if kind == "tube":
        return max(0.0, max(pt[1] for pt in spec["points"]))
    if kind == "group":
        return max(
            child["position"][1] + _spec_top_extent_m(child["spec"])
            for child in spec["children"]
        )
    raise AssertionError(f"unexpected spec kind {kind!r}")


def _tube_apex_m(aph: dict) -> float:
    """Topmost Y a swept-tube arm reaches, centreline plus the tube's own bulge.

    The bulge is NOT a flat ``+radiusM``.  A cylinder of radius r about a unit
    axis ``d`` extends above its centreline by ``r * sqrt(1 - d_y**2)`` — the
    full radius where the tube runs horizontally, and NOTHING where it runs
    straight up, because there the end cap is a horizontal disc through the
    centreline point itself.

    Both cases are live in the catalog, which is why the distinction matters:
    SH1's hook ARCS over, so its highest point is the side of a near-horizontal
    tube and the full radius applies; the HSX upsweep's last segment rises
    VERTICALLY into its pendant socket, so the tube stops dead at that point.
    A flat ``+radiusM`` over-predicted HSX by exactly one radius (30 mm) — 0.5 mm
    past the 1% tolerance on an 8 ft pole, which is how it surfaced: as of the
    0.12_TO merge, Tyler's SD/HS socket repoint made gvx-pendant + HSX a valid
    combo for the first time, so this latent flaw had never been enumerated.
    """
    r = aph["radiusM"]
    pts = aph["points"]
    apex = max(pt[1] for pt in pts)  # centreline, before any bulge
    for a, b in zip(pts, pts[1:]):
        seg = [b[i] - a[i] for i in range(3)]
        length = sum(c * c for c in seg) ** 0.5
        if length == 0:
            continue
        dy = seg[1] / length
        bulge = r * max(0.0, 1.0 - dy * dy) ** 0.5
        apex = max(apex, a[1] + bulge, b[1] + bulge)
    return apex


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
    # pendant socket it terminates at).
    fixture_top = arm_socket_y + _fixture_top_extent_m(fixture)
    aph = arm["placeholder"]
    if aph["kind"] == "tube":
        arm_top = max(fixture_top, _tube_apex_m(aph))
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
    """Sanity: the kit enumerates the expected 760 valid combos.

    Was 800 until the 0.14 merge; 760 as of Phase 0.15.  Measured attribution
    (2026-08-18, pair-by-pair enumeration of Dev pre-merge vs post-merge):
    exactly one fixture-arm pair disappeared — gvx-pendant + pa1-pendant-arm
    (40 = 8 poles x 5 base covers) — and it is Tyler's 8/13 call, not a
    regression: commit 5189606c gave PA1's carry socket its own type
    (`pendant-pa1`) that no fixture mounts today, because "PA1 doesn't work
    with the GVX" and compatibility stays socket-matching only.  Nothing was
    gained, no other pair changed, and no fixture lost its last arm.

    Was 561 (17 fixture-arm pairs x 11 poles x 3 base covers) before Phase
    0.10.5 re-slotted bc-fluted/bc-round to 'standalone' and the catalog grew
    to include NAFCO/WiLLsport wizard parts and 2 additional official base
    covers (bc-cl2/bc-cl3/bc-sc2 replacing bc-fluted/bc-round — net 3 -> 5).
    Was 880 until the 0.12_TO merge; 800 as of Phase 0.13.  The guard did its
    job — the drop is Tyler's 8/12 socket repoint (commit 9407caa3), which moved
    the SD and HS arms off their placeholder-era post-top/arm-mount sockets onto
    `pendant`, because his list is explicit that those arms serve the GVX.
    Measured attribution, pre- vs post-merge enumeration (2026-08-13):

        lost 160:  mvx-coach + HSX upsweep                    (40)
                   drx/tex/dwx + supported-decorative-arms    (40 each)
        gained 80: gvx-pendant + HSX upsweep                  (40)
                   gvx-pendant + supported-decorative-arms    (40)
        net       -80

    Checked at the same time: no fixture lost its last arm.  mvx-coach keeps the
    classic `upsweep` (40 combos), matching Tyler's "MVX keeps only the classic
    upsweep".  The seven NAFCO/WiLLsport fixtures enumerate 0 here and did so
    BEFORE the merge too — they appear in neither the lost nor the gained set —
    so that is this helper's WiLLstudio-pole scope, not a regression.

    800 is the current count computed by the same socket-matching valid_combos()
    this test exercises; no independent formula holds across the now-multi-brand
    catalog (WiLLstudio + NAFCO + WiLLsport each have their own socket families),
    so this is a regression guard on that count, not a hand-derived product.
    """
    assert len(valid_combos(catalog)) == 760


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
