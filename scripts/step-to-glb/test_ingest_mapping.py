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
