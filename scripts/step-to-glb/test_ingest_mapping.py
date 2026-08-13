"""Every ingest mapping must name a real catalog part in the right slot.

Phase 0.10.5 (D8): the source STEP decides which part it backs. 0.10 guessed
CL1→bc-round / CL2→aluminum / CL3→bc-fluted before the 8/4 pole spec sheet
existed; the sheet says CL1/CL2/CL3 are Small/Medium/Large Clamshell.
"""

from __future__ import annotations

import json
from pathlib import Path

import ingest

CATALOG = json.loads((Path(__file__).parents[2] / "public" / "catalog.json").read_text())
BY_ID = {p["id"]: p for p in CATALOG["parts"]}

EXPECTED_SLOT = {
    "bc-cl1-small-clamshell": "baseCover",
    "bc-cl2-medium-clamshell": "baseCover",
    "bc-cl3-large-clamshell": "baseCover",
    "bc-sc1-spun-collar": "baseCover",
    "bc-sc2-spun-collar-split": "baseCover",
}


def test_every_ingest_target_exists_in_the_catalog():
    missing = [e["part"] for e in ingest.INGEST if e["part"] not in BY_ID]
    assert missing == [], f"ingest targets not in catalog: {missing}"


def test_clamshells_and_collars_map_to_their_official_parts():
    by_file = {e["file"]: e["part"] for e in ingest.INGEST}
    assert by_file["CL1-4R.STEP"] == "bc-cl1-small-clamshell"
    assert by_file["CL2-4R.STEP"] == "bc-cl2-medium-clamshell"
    assert by_file["CL3-4R.STEP"] == "bc-cl3-large-clamshell"
    assert by_file["SC1-4R.STEP"] == "bc-sc1-spun-collar"
    assert by_file["SC2-4R.STEP"] == "bc-sc2-spun-collar-split"


def test_ingest_targets_are_in_the_slot_we_expect():
    for part_id, slot in EXPECTED_SLOT.items():
        assert BY_ID[part_id]["slot"] == slot


def test_sc_files_are_no_longer_unmapped():
    unmapped_files = {e["file"] for e in ingest.UNMAPPED}
    assert "SC1-4R.STEP" not in unmapped_files
    assert "SC2-4R.STEP" not in unmapped_files


def test_flag_and_plant_holders_stay_unmapped_as_accessories():
    """FH/PH are Accessory adders, not slot parts — they get no render layer."""
    unmapped_files = {e["file"] for e in ingest.UNMAPPED}
    assert "FH-4R.STEP" in unmapped_files
    assert "PH-4R.STEP" in unmapped_files


def test_cole_0_13_exports_are_classified_below_the_render_line():
    """Phase 0.13: none of Cole's six 8/11-8/12 files is a render source.

    This is the assertion that keeps real-CAD coverage honest.  Anything landing
    in INGEST gets a GLB, a layer, and `realCad: true` — which drives Coming
    Soon — so a file promoted into INGEST without its own catalog part would
    present placeholder-mismatched art as configurable.  All six belong below
    that line:

      * TEX-AREA / GVX-HSS  -> CLUSTERS: real CAD for a configured code on a part
        that already renders from its own master (a second mounting, and an
        accessory-installed variant).  The compositor keys layers by part id, so
        neither has anywhere to render to.
      * HSS-GVX / HH-4R/5R/6R -> UNMAPPED: order-code adders with no slot part.
    """
    ingest_files = {e["file"] for e in ingest.INGEST}
    clusters = {e["file"] for e in ingest.CLUSTERS}
    unmapped = {e["file"] for e in ingest.UNMAPPED}

    new_files = {
        "TEX-AREA.STEP", "GVX-HSS.STEP", "HSS-GVX.STEP",
        "HH-4R.STEP", "HH-5R.STEP", "HH-6R.STEP",
    }
    assert new_files.isdisjoint(ingest_files), (
        "a 0.13 export was promoted to a render source; it has no catalog part"
    )
    assert {"TEX-AREA.STEP", "GVX-HSS.STEP"} <= clusters
    assert {"HSS-GVX.STEP", "HH-4R.STEP", "HH-5R.STEP", "HH-6R.STEP"} <= unmapped

    # The variant files carry the part they vary; the adders carry no part at all.
    by_file = {e["file"]: e for e in ingest.CLUSTERS}
    assert by_file["TEX-AREA.STEP"]["part"] == "tex-post-top"
    assert by_file["GVX-HSS.STEP"]["part"] == "gvx-pendant"
    for e in ingest.UNMAPPED:
        if e["file"] in {"HSS-GVX.STEP", "HH-4R.STEP", "HH-5R.STEP", "HH-6R.STEP"}:
            assert e["part"] is None, f"{e['file']} must not claim a catalog part"


def test_hand_hole_files_are_adders_not_the_poles_render_source():
    """HH-*R must never become the pole's geometry.

    They are 6in sections of round pole carrying the hand-hole opening plus its
    frame (measured 2026-08-13), one per OD: 4R/5R/6R.  The poles render from
    RSAA-4040-12 with a placeholder cover grafted by the rig
    (`placeholderGraftChildren`), and swapping in this real geometry is an open
    decision, not an accident waiting to happen — the graft doubles as the rig's
    visible 0-degree homing reference and these openings are RECESSED.
    """
    pole_sources = {e["file"] for e in ingest.INGEST if e["part"].startswith("alum-pole")}
    assert pole_sources == {"RSAA-4040-12.STEP"}
    for f in ("HH-4R.STEP", "HH-5R.STEP", "HH-6R.STEP"):
        assert f not in pole_sources
