"""Phase 0.10.5 (Task 3 review, Finding 2) — regression coverage for the
banner-dimension derivation and the corrected arm-arrangement labels in
``app/generation.py``.  Neither had a test before this file: the corrected
``_ARM_ARRANGEMENT_LABELS`` and the ``_banner_geometry``/``_ft_in`` helpers
must mirror ``src/lib/summary.ts``/``src/lib/banner.ts`` exactly, and that
cross-language agreement needs a guard, not just a one-off REPL check.
"""

from __future__ import annotations

import uuid

import pytest

from app.generation import (
    _ARM_ARRANGEMENT_LABELS,
    _banner_geometry,
    _banner_panel_size,
    _build_summary,
    _ft_in,
)
from app.models import BannerConfig, GenerateRequest, PoleConfig

from .conftest import first_base_cover_for

BANNER_ID = "willstudio-ba1-banner-arm"


# ---------------------------------------------------------------------------
# _banner_geometry — mirrors bannerGeometry in src/lib/banner.ts
# ---------------------------------------------------------------------------


def test_banner_geometry_measures_to_the_bottom_of_the_banner(catalog):
    """Phase 0.11 (Workstream D): the configured height is the banner's BOTTOM
    EDGE, not its vertical centre.

    This test previously asserted the centre model (bars straddling the mount
    height at +/-640 mm). That was the bug: a 24x48 banner at the 8 ft minimum
    hung down to ~6 ft while the app reported it compliant. Mirrors
    src/lib/banner.test.ts.
    """
    part_map = {p["id"]: p for p in catalog["parts"]}
    banner_part = part_map[BANNER_ID]

    # No ordered size -> the placeholder solid's own 1.25 m panel.
    geom = _banner_geometry(banner_part, 8)
    assert geom is not None
    panel_mm, top_mm, bottom_mm = geom

    bottom_edge_mm = 8 * 304.8
    assert panel_mm == pytest.approx(1250.0, abs=0.5)
    # Both bars now sit at or above the configured bottom edge, not around it.
    assert bottom_mm == pytest.approx(bottom_edge_mm - 15.0, abs=1.0)
    assert top_mm == pytest.approx(bottom_edge_mm + 1250.0 + 15.0, abs=1.0)
    assert top_mm > bottom_edge_mm


def test_banner_geometry_uses_the_ordered_panel_size(catalog):
    """The panel is the ORDERED size (24x48 default), not the placeholder solid."""
    part_map = {p["id"]: p for p in catalog["parts"]}
    banner_part = part_map[BANNER_ID]
    size = _banner_panel_size(catalog, None)
    assert size["id"] == "24x48"

    panel_mm, top_mm, bottom_mm = _banner_geometry(banner_part, 8, size)
    assert panel_mm == pytest.approx(48 * 25.4, abs=0.5)
    # Top bar tracks the ordered panel height off the configured bottom edge.
    assert top_mm - bottom_mm == pytest.approx(48 * 25.4 + 30.0, abs=1.5)


def test_banner_geometry_rises_with_the_configured_height(catalog):
    part_map = {p["id"]: p for p in catalog["parts"]}
    banner_part = part_map[BANNER_ID]

    _, top_8, bottom_8 = _banner_geometry(banner_part, 8)
    _, top_10, bottom_10 = _banner_geometry(banner_part, 10)
    assert bottom_10 - bottom_8 == pytest.approx(2 * 304.8, abs=0.5)
    assert top_10 - top_8 == pytest.approx(2 * 304.8, abs=0.5)


def test_banner_geometry_returns_none_for_a_non_group_placeholder(catalog):
    """drx-post-top's placeholder is a lathe profile, not a box-child group —
    same null case src/lib/banner.test.ts asserts in TS."""
    part_map = {p["id"]: p for p in catalog["parts"]}
    fixture_part = part_map["drx-post-top"]
    assert _banner_geometry(fixture_part, 8) is None


# ---------------------------------------------------------------------------
# _ft_in — mirrors formatFtIn in src/lib/banner.ts, must round identically
# ---------------------------------------------------------------------------


def test_ft_in_formats_like_the_cad_deliverables():
    assert _ft_in(0) == "0'-0\""
    assert _ft_in(304.8) == "1'-0\""


def test_ft_in_rolls_twelve_inches_into_the_next_foot():
    # 2126 mm = 83.70 in = 6'-11.7" -> must read 7'-0", never 6'-12".
    assert _ft_in(2126) == "7'-0\""


def test_ft_in_rounds_half_away_from_zero_like_js_math_round():
    # 12.7 mm = 0.5 in exactly. Python's builtin round() is round-half-to-even
    # and would bank 0.5 down to 0 ("0'-0\""); JS Math.round (and formatFtIn)
    # rounds half away from zero, up to 1. _ft_in must agree with the TS side.
    assert _ft_in(12.7) == "0'-1\""


# ---------------------------------------------------------------------------
# _ARM_ARRANGEMENT_LABELS — mirrors armArrangementLabel in src/lib/summary.ts
# ---------------------------------------------------------------------------


def test_arm_arrangement_labels_use_the_actual_90_degree_drilled_tenon():
    # Arms mount on a 90-degree drilled tenon: a triple is 3@90, NOT 3@120.
    # This must never silently regress back to the old wrong angle.
    assert _ARM_ARRANGEMENT_LABELS[1] == "Single"
    assert _ARM_ARRANGEMENT_LABELS[2] == "Twin (2 @ 180 deg)"
    assert _ARM_ARRANGEMENT_LABELS[3] == "Triple (3 @ 90 deg)"
    assert _ARM_ARRANGEMENT_LABELS[4] == "Quad (4 @ 90 deg)"


# ---------------------------------------------------------------------------
# End-to-end through _build_summary — the actual text a spec sheet prints.
# ---------------------------------------------------------------------------


def _cfg(catalog: dict, *, arm_count: int = 1, banner: dict | None = None) -> PoleConfig:
    return PoleConfig(
        configId=str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(catalog, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        armCount=arm_count,
        banner=BannerConfig(**banner) if banner else None,
    )


def test_build_summary_reports_the_corrected_triple_label(catalog):
    req = GenerateRequest(config=_cfg(catalog, arm_count=3), formats=["pdf"])
    summary = _build_summary(catalog, req, None)
    assert summary["arm_arrangement"] == "Triple (3 @ 90 deg)"


def test_build_summary_banner_line_carries_the_derived_dimensions(catalog):
    req = GenerateRequest(
        config=_cfg(catalog, banner={"armId": BANNER_ID, "count": 2, "heightFt": 8}),
        formats=["pdf"],
    )
    summary = _build_summary(catalog, req, None)
    banner_line = summary["banner"]
    assert "opposite pair" in banner_line
    # Phase 0.11 (D): the line names the ORDERED panel (24x48 default), not the
    # placeholder solid's 49 in, and states the bottom-edge reference. Must
    # stay word-for-word identical to bannerSummaryLine in src/lib/banner.ts.
    assert "24 \u00d7 48 in panel" in banner_line
    assert "banner height 48 in" in banner_line
    assert "bottom of banner 8'-0\"" in banner_line
    assert "top bar" in banner_line and "bottom bar" in banner_line
