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

from app.generation import _ARM_ARRANGEMENT_LABELS, _banner_geometry, _build_summary, _ft_in
from app.models import BannerConfig, GenerateRequest, PoleConfig

from .conftest import first_base_cover_for

BANNER_ID = "willstudio-ba1-banner-arm"


# ---------------------------------------------------------------------------
# _banner_geometry — mirrors bannerGeometry in src/lib/banner.ts
# ---------------------------------------------------------------------------


def test_banner_geometry_matches_known_ba1_catalog_geometry(catalog):
    """BA1: a 1.25 m panel between bars centred at +/-0.64 m of the mount
    point (public/catalog.json willstudio-ba1-banner-arm placeholder), at an
    8 ft mount height. Same numbers src/lib/banner.test.ts asserts in TS."""
    part_map = {p["id"]: p for p in catalog["parts"]}
    banner_part = part_map[BANNER_ID]

    geom = _banner_geometry(banner_part, 8)
    assert geom is not None
    panel_mm, top_mm, bottom_mm = geom

    mount_mm = 8 * 304.8
    assert panel_mm == pytest.approx(1250.0, abs=0.5)
    assert top_mm == pytest.approx(mount_mm + 640.0, abs=0.5)
    assert bottom_mm == pytest.approx(mount_mm - 640.0, abs=0.5)
    assert top_mm - bottom_mm == pytest.approx(1280.0, abs=0.5)


def test_banner_geometry_bars_straddle_the_configured_shaft_height(catalog):
    part_map = {p["id"]: p for p in catalog["parts"]}
    banner_part = part_map[BANNER_ID]

    _, top_mm, bottom_mm = _banner_geometry(banner_part, 10)
    mount_mm = 10 * 304.8
    assert bottom_mm < mount_mm < top_mm


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
    assert "banner height 49 in" in banner_line
    assert "top bar" in banner_line and "bottom bar" in banner_line
