"""Phase 0.21 — wall-mount assembly mode, service side.

A wall build (WM1/WM2 + a fixture) is the first configuration with no pole at
all that is still an ASSEMBLY: two parts joined at a real socket.  It went
through neither of the two paths the service had — the standalone path (one
part, PDF only) nor the full-assembly path (which required a pole) — so it has
its own validation branch and the kit's pole became optional.

The drift pins at the bottom matter as much as the behaviour: the frontend
decides what a customer may select and this service decides what it will build,
so a disagreement is either a config the UI offers and the service refuses, or
the reverse.  They are pinned against the TypeScript source directly, the same
way test_merchandising.py pins its format allowlist against the TSX.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.catalog import (
    _MODE_PART_SLOT,
    _MODE_SLOTS,
    assembly_mode,
    load_catalog,
    slot_applies_in_mode,
    validate_config,
)
from app.generation import _MODE_LABEL, _build_summary
from app.kit.assembly import build_assembly
from app.models import GenerateRequest, PoleConfig
from app.partnumber import build_part_number

REPO = Path(__file__).resolve().parents[2]

WM1 = "willstudio-wm1-single-wall-mount-pendant"
WM2 = "willstudio-wm2-single-wall-tenon-mount-w-finial"
BOLLARD = "willstudio-rxb-sxb-bollard"


def _wall_cfg(**over) -> PoleConfig:
    base = dict(
        configId="wall-mode-test",
        pole="",
        baseCover="",
        arm=WM1,
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )
    base.update(over)
    return PoleConfig(**base)


def _pole_cfg(**over) -> PoleConfig:
    base = dict(
        configId="pole-mode-test",
        pole="alum-pole-20",
        baseCover="bc-cl1-small-clamshell",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )
    base.update(over)
    return PoleConfig(**base)


# ---------------------------------------------------------------------------
# Mode resolution
# ---------------------------------------------------------------------------


def test_wall_mode_comes_from_the_bracket(catalog):
    assert assembly_mode(catalog, _wall_cfg()) == "wall"


def test_pole_and_ground_modes_are_unchanged(catalog):
    """The 0.14 ground mechanic must behave exactly as it did."""
    assert assembly_mode(catalog, _pole_cfg()) == "pole"
    ground = _wall_cfg(arm="", fixture=BOLLARD)
    assert assembly_mode(catalog, ground) == "ground"


def test_the_flag_is_read_only_from_the_slot_its_mode_is_offered_in(catalog):
    """A wall bracket id in the FIXTURE field must not reconfigure the build.

    Config fields come off a share URL, so a wrong-slot id is reachable input,
    not a hypothetical.
    """
    assert assembly_mode(catalog, _wall_cfg(arm="", fixture=WM1)) == "pole"


def test_mode_slot_sets(catalog):
    assert slot_applies_in_mode("wall", "fixture") is True
    assert slot_applies_in_mode("wall", "arm") is True
    assert slot_applies_in_mode("wall", "pole") is False
    assert slot_applies_in_mode("wall", "baseCover") is False
    assert slot_applies_in_mode("ground", "arm") is False
    for slot in ("fixture", "arm", "pole", "baseCover"):
        assert slot_applies_in_mode("pole", slot) is True


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_a_wall_config_validates(catalog):
    validate_config(catalog, _wall_cfg())


def test_a_wall_config_with_a_pole_is_refused(catalog):
    with pytest.raises(ValueError, match="must be empty for a wall-mounted build"):
        validate_config(catalog, _wall_cfg(pole="alum-pole-20"))


def test_a_wall_config_with_a_base_cover_is_refused(catalog):
    with pytest.raises(ValueError, match="must be empty for a wall-mounted build"):
        validate_config(catalog, _wall_cfg(baseCover="bc-cl1-small-clamshell"))


def test_a_wall_build_is_single_only(catalog):
    """The radial arrangement repeats arms AROUND a shaft; a wall has one face."""
    with pytest.raises(ValueError, match="armCount must be 1 for a wall-mounted build"):
        validate_config(catalog, _wall_cfg(armCount=2))


def test_the_wall_bracket_must_be_able_to_host_the_fixture(catalog):
    """WM1's bore is a pendant socket, so a post top cannot mount on it.

    The mirror of the frontend's own socket filter — the service must refuse
    what the builder would never offer.
    """
    with pytest.raises(ValueError, match="cannot host fixture"):
        validate_config(catalog, _wall_cfg(fixture="tex-post-top"))


def test_wm2_is_a_tenon_mount_and_carries_post_tops_not_the_gvx(catalog):
    """The measured finding of 0.21, asserted through the service's own gate.

    WM2.STEP carries a 3.000" OD UPWARD tenon and no 2-3/8" bore, so the
    "GVX + WM1/WM2" launch cut is really GVX + WM1: a pendant cannot hang from
    a tenon.  WM2's mates are the post tops, every one of which is held.
    """
    validate_config(catalog, _wall_cfg(arm=WM2, fixture="tex-post-top"))
    with pytest.raises(ValueError, match="cannot host fixture"):
        validate_config(catalog, _wall_cfg(arm=WM2, fixture="gvx-pendant"))


# ---------------------------------------------------------------------------
# Geometry + generated output
# ---------------------------------------------------------------------------


def test_the_kit_builds_a_pole_less_assembly(catalog):
    built = build_assembly(catalog, _wall_cfg())
    assert [pid for pid, _ in built.parts] == [WM1, "gvx-pendant"]


def test_a_wall_build_reports_only_the_dimensions_it_has(catalog):
    """No pole, no base, and no ground to measure a mounting height from.

    Printing 0'-0" for those would read as a measurement; dropping the keys is
    what makes the sheet honest (`_draw_dimensions` skips a missing key).
    """
    built = build_assembly(catalog, _wall_cfg())
    summary = _build_summary(catalog, GenerateRequest(config=_wall_cfg(), formats=["pdf"]), built)
    assert set(summary["dims"]) == {"overall_height_mm", "arm_reach_mm"}
    # Overall height is the SPAN of the unit: the luminaire hangs BELOW the
    # mounting plate, so measuring to Z=0 would stop at the plate.
    assert summary["dims"]["overall_height_mm"] > 0
    assert summary["dims"]["arm_reach_mm"] > 0


def test_a_pole_build_still_reports_all_five_dimensions(catalog):
    """Negative control for the key-dropping above."""
    cfg = _pole_cfg()
    built = build_assembly(catalog, cfg)
    summary = _build_summary(catalog, GenerateRequest(config=cfg, formats=["pdf"]), built)
    for key in (
        "overall_height_mm",
        "pole_height_mm",
        "mounting_height_mm",
        "arm_reach_mm",
        "base_diameter_mm",
    ):
        assert key in summary["dims"], key


def test_the_sheet_names_the_mounting_mode_only_when_it_is_not_a_pole(catalog):
    wall = _build_summary(
        catalog, GenerateRequest(config=_wall_cfg(), formats=["pdf"]), build_assembly(catalog, _wall_cfg())
    )
    assert wall["mounting"] == "Wall-mounted (no pole or base cover)"
    cfg = _pole_cfg()
    pole = _build_summary(
        catalog, GenerateRequest(config=cfg, formats=["pdf"]), build_assembly(catalog, cfg)
    )
    assert "mounting" not in pole


def test_the_fixture_takes_the_wall_brackets_cord_and_the_bracket_prints_nothing(catalog):
    """CR-OPT-06: WM1/WM2 carry WHP3NP, not the WHP7NP standard.

    And WM1 itself resolves to NO number while it is Coming Soon — the
    enablement step is Cole's CAD-mapping confirm, not an edit here.
    """
    cfg = _wall_cfg()
    assert build_part_number(catalog, cfg, "fixture") == "WD-GVX-_-_-_-_-BK-WHP3NP"
    assert build_part_number(catalog, cfg, "arm") is None


def test_the_wall_fit_code_is_the_arms_sheets_plate_code(catalog):
    """`WP-WM1-WM-BK`, the number that appears the day WM1 is un-held.

    Pinned NOW so the un-hold has a target: every pole bracket prints `_` in
    the fit position (CR-PN-09 — the configurator has no pole-top fitter axis),
    but a wall mount's fit is fixed by the arms sheet (`fitCodes.plate`: WM =
    "Wall-mount flat plate", WM1/WM2 only), so a blank there would hide a code
    that exists.  Exercised on a COPY of the catalog with the hold cleared —
    the shipped catalog keeps WM1 held.
    """
    unheld = {
        **catalog,
        "parts": [
            {**p, "realCad": True} if p["id"] in (WM1, WM2) else p
            for p in catalog["parts"]
        ],
    }
    assert build_part_number(unheld, _wall_cfg(), "arm") == "WP-WM1-WM-BK"
    assert build_part_number(unheld, _wall_cfg(arm=WM2, fixture="tex-post-top"), "arm") == (
        "WP-WM2-WM-BK"
    )
    # Negative control: a pole bracket's fit segment is untouched.
    assert build_part_number(unheld, _pole_cfg(), "arm") == "WP-SH1-_-BK"


# ---------------------------------------------------------------------------
# Cross-language drift pins
# ---------------------------------------------------------------------------


def _compat_ts() -> str:
    return (REPO / "src" / "lib" / "compat.ts").read_text()


def test_mode_part_slot_matches_the_frontend(catalog):
    ts = _compat_ts()
    # The declared type is `Record<Exclude<AssemblyMode, 'pole'>, Slot>` — it
    # contains its own '>', so match up to the assignment instead.
    block = re.search(r"const MODE_PART_SLOT:.*?= \{(.*?)\n\}", ts, re.S)
    assert block, "MODE_PART_SLOT not found in src/lib/compat.ts"
    found = dict(re.findall(r"(\w+):\s*'([\w]+)'", block.group(1)))
    assert found == _MODE_PART_SLOT


def test_mode_slots_match_the_frontend(catalog):
    ts = _compat_ts()
    block = re.search(r"const MODE_SLOTS:.*?= \{(.*?)\n\}", ts, re.S)
    assert block, "MODE_SLOTS not found in src/lib/compat.ts"
    found = {
        mode: tuple(re.findall(r"'(\w+)'", slots))
        for mode, slots in re.findall(r"(\w+): \[([^\]]*)\]", block.group(1))
    }
    assert found == _MODE_SLOTS


def test_mode_labels_match_the_frontend(catalog):
    """The quote text and the generated sheet must say the same thing.

    Python is latin-1 through fpdf2 and uses a plain hyphen where the TS uses
    an em dash; `_latin1()` performs exactly that substitution, so the two are
    compared with the dash normalised rather than pretending they are equal.
    """
    ts = _compat_ts()
    block = re.search(
        r"export const ASSEMBLY_MODE_LABEL:.*?= \{(.*?)\n\}", ts, re.S
    )
    assert block, "ASSEMBLY_MODE_LABEL not found in src/lib/compat.ts"
    found = {
        mode: text.replace("—", "-")
        for mode, text in re.findall(r"(\w+): '([^']*)'", block.group(1))
    }
    assert found == _MODE_LABEL
