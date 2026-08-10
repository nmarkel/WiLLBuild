"""Derived poles: scale the real 12 ft axially to the other catalog heights."""

from __future__ import annotations

import json
from pathlib import Path

import ingest

CATALOG = json.loads((Path(__file__).parents[2] / "public" / "catalog.json").read_text())
ALUM_POLES = {
    p["id"]: p for p in CATALOG["parts"] if p["id"].startswith("alum-pole-")
}


def test_every_alum_pole_has_real_or_derived_geometry():
    ingested = {e["part"] for e in ingest.INGEST}
    derived = {e["part"] for e in ingest.DERIVED}
    covered = ingested | derived
    missing = sorted(set(ALUM_POLES) - covered)
    assert missing == [], f"alum poles with no real or derived geometry: {missing}"


def test_derived_poles_are_not_the_natively_ingested_one():
    derived = {e["part"] for e in ingest.DERIVED}
    assert "alum-pole-12" not in derived, "the 12 ft pole is a native export"


def test_scale_factor_matches_the_catalog_height_ratio():
    for entry in ingest.DERIVED:
        target_ft = ALUM_POLES[entry["part"]]["heightFt"]
        assert entry["source"] == "alum-pole-12"
        assert entry["kind"] == "derived"
        assert entry["scaleY"] == target_ft / 12.0


def test_derived_entries_record_their_provenance():
    for entry in ingest.DERIVED:
        assert entry.get("note"), f"{entry['part']} must record why it is derived"
