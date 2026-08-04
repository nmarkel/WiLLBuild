"""Part-number resolver parity — Phase 0.10, Workstream 0.

``app/partnumber.py`` mirrors ``src/lib/partNumber.ts``: same catalog data, same
rules, same strings.  The expected codes below are the SAME literals asserted in
``src/lib/partNumber.test.ts`` — if the two resolvers ever drift, one of the two
suites fails.

Also covers the surface that matters to the customer: the numbers land on the
spec sheet / concept card, and options change the cache key so a cached PDF can
never show someone else's part number.
"""

from __future__ import annotations

import pytest

from app.generation import _build_summary
from app.models import GenerateRequest, PoleConfig
from app.naming import config_hash
from app.partnumber import (
    part_number_text,
    resolve_assembly_part_numbers,
    resolve_part_number,
)

SS = "willstudio-side-shepherds-hook-pole-top-brackets"
AR = "willstudio-suspension-arm-pole-top-brackets"


def _cfg(**overrides) -> PoleConfig:
    base = dict(
        configId="pn-test-0001",
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm=SS,
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        armCount=1,
    )
    base.update(overrides)
    return PoleConfig(**base)


# ---------------------------------------------------------------------------
# Arms — [Family]-[Design]-[Fit]-[Finish]
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "count,code",
    [(1, "WP-SS1-40F-BK"), (2, "WP-SS2-40F-BK"), (3, "WP-SS3-40F-BK"), (4, "WP-SS4-40F-BK")],
)
def test_arm_count_drives_the_design_code(catalog, count, code):
    number = resolve_part_number(catalog, _cfg(armCount=count), SS)
    assert number.code == code
    assert number.complete is True


def test_suspension_family_uses_ar_codes(catalog):
    assert resolve_part_number(catalog, _cfg(arm=AR, armCount=2), AR).code == "WP-AR2-40F-BK"


@pytest.mark.parametrize(
    "finish,code",
    [
        ("matte-black", "BK"),
        ("statuary-bronze", "DB"),
        ("forest-green", "DG"),
        ("gloss-white", "WH"),
        ("silver", "NA"),
    ],
)
def test_finish_segment_follows_the_assembly_finish(catalog, finish, code):
    assert resolve_part_number(catalog, _cfg(finish=finish), SS).code == f"WP-SS1-40F-{code}"


def test_shepherds_hook_is_single_only(catalog):
    number = resolve_part_number(catalog, _cfg(arm="sh1-shepherds-hook"), "sh1-shepherds-hook")
    assert number.code == "WP-SH1-40F-BK"


def test_crossarm_is_a_fixed_pair(catalog):
    cfg = _cfg(fixture="drx-post-top", arm="willstudio-cr2-decorative-crossarm", armCount=2)
    assert resolve_part_number(catalog, cfg, cfg.arm).code == "WP-CR2-40F-BK"


def test_selected_options_append_to_the_number(catalog):
    cfg = _cfg(armCount=2, partOptions={SS: {"addOns": ["CF2", "CF1"]}})
    assert resolve_part_number(catalog, cfg, SS).code == "WP-SS2-40F-BK-CF1-CF2"


def test_ambiguous_design_stays_unresolved(catalog):
    """Upsweep BR12/BR13 are both single-arm — the customer must pick one."""
    cfg = _cfg(fixture="mvx-coach", arm="upsweep", armCount=1)
    number = resolve_part_number(catalog, cfg, "upsweep")
    assert number.code == "WP-?-40F-BK"
    assert number.complete is False
    assert number.unresolved == 1

    picked = _cfg(
        fixture="mvx-coach", arm="upsweep", armCount=2,
        partOptions={"upsweep": {"codes": {"design": "BR23"}}},
    )
    assert resolve_part_number(catalog, picked, "upsweep").code == "WP-BR23-40F-BK"


# ---------------------------------------------------------------------------
# Fixtures / poles — from the machine-parsed spec sheets
# ---------------------------------------------------------------------------

def test_fixture_number_matches_the_sheets_own_example(catalog):
    """The GVX sheet prints WD-GVX-80-30-MV-5W-BK-PM as its example order code."""
    cfg = _cfg(
        partOptions={
            "gvx-pendant": {
                "codes": {
                    "design": "GVX",
                    "lumen-output": "80",
                    "color-temp": "30",
                    "voltage": "MV",
                    "distribution": "5W",
                    "mounting": "PM",
                }
            }
        }
    )
    number = resolve_part_number(catalog, cfg, "gvx-pendant")
    assert number.code == "WD-GVX-80-30-MV-5W-BK-PM"
    assert number.complete is True


def test_unchosen_columns_render_as_question_marks(catalog):
    number = resolve_part_number(catalog, _cfg(), "gvx-pendant")
    assert number.code == "WD-?-?-?-?-?-BK-?"
    assert number.complete is False
    assert number.unresolved == 6


def test_pole_finish_type_is_not_the_finish_colour(catalog):
    """Exactly one finish segment, even though the pole sheet has a Finish Type column."""
    number = resolve_part_number(catalog, _cfg(), "alum-pole-20")
    assert len([s for s in number.segments if s.source == "finish"]) == 1
    assert number.code.split("-").count("BK") == 1


def test_base_cover_fit_comes_from_the_pole_shaft(catalog):
    cfg = _cfg(baseCover="aluminum-light-pole-base-covers")
    assert resolve_part_number(catalog, cfg, cfg.baseCover).code == "WP-CL2-40-BK"


def test_product_without_a_matrix_gets_no_fabricated_number(catalog):
    number = resolve_part_number(catalog, _cfg(), "bc-fluted")
    assert number.code == ""
    assert number.unavailable is not None


# ---------------------------------------------------------------------------
# Assembly-level output
# ---------------------------------------------------------------------------

def test_assembly_returns_one_number_per_component(catalog):
    numbers = resolve_assembly_part_numbers(catalog, _cfg())
    assert [n.slot_label for n in numbers] == ["Fixture", "Arm", "Pole", "Base Cover"]


def test_assembly_includes_the_banner_accessory(catalog):
    cfg = _cfg(banner={"armId": "willstudio-ba1-banner-arm", "count": 2, "heightFt": 8})
    assert "Banner Arm" in [n.slot_label for n in resolve_assembly_part_numbers(catalog, cfg)]


def test_printable_text_flags_incomplete_and_pending(catalog):
    lines = [part_number_text(n) for n in resolve_assembly_part_numbers(catalog, _cfg(armCount=2))]
    assert any(line == "Arm: WP-SS2-40F-BK" for line in lines)
    assert any("choices to complete" in line for line in lines)
    assert any("pending matrix" in line for line in lines)


# ---------------------------------------------------------------------------
# The deliverables: summary payload + cache key
# ---------------------------------------------------------------------------

def test_summary_carries_part_numbers_for_the_pdf(catalog):
    cfg = _cfg(armCount=3)
    req = GenerateRequest(config=cfg, formats=["pdf"])
    summary = _build_summary(catalog, req, None)
    arm_row = next(p for p in summary["parts"] if p["slot"] == "arm")
    assert arm_row["partNumber"] == "WP-SS3-40F-BK"
    assert arm_row["partNumberComplete"] is True
    base_row = next(p for p in summary["parts"] if p["slot"] == "baseCover")
    assert base_row["partNumber"] == ""  # no matrix → dash on the sheet, not a guess
    assert any("WP-SS3-40F-BK" in line for line in summary["part_numbers"])


def test_summary_labels_the_banner_bars(catalog):
    cfg = _cfg(banner={"armId": "willstudio-ba1-banner-arm", "count": 2, "heightFt": 8})
    summary = _build_summary(catalog, GenerateRequest(config=cfg, formats=["pdf"]), None)
    assert "banner height 49 in" in summary["banner"]
    assert "top bar" in summary["banner"] and "bottom bar" in summary["banner"]
    assert "opposite pair" in summary["banner"]


def test_arm_arrangement_label_is_90_degrees(catalog):
    summary = _build_summary(catalog, GenerateRequest(config=_cfg(armCount=3), formats=["pdf"]), None)
    assert summary["arm_arrangement"] == "Triple (3 @ 90 deg)"


def test_options_change_the_cache_key_but_not_legacy_hashes(catalog):
    plain = _cfg()
    with_options = _cfg(partOptions={SS: {"codes": {"design": "SS1"}}})
    assert config_hash(plain) != config_hash(with_options)
    # An empty selections map must hash exactly like a pre-0.10 config.
    assert config_hash(_cfg(partOptions={})) == config_hash(plain)
    assert config_hash(_cfg(partOptions={SS: {"codes": {}, "addOns": []}})) == config_hash(plain)
