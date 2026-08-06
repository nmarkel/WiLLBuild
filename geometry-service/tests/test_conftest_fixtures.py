"""Guards the shared test config against catalog re-slotting (Phase 0.10.5).

Phase 0.10.5 re-slotted bc-fluted/bc-round to 'standalone', which broke 129
tests that named bc-fluted literally.  These tests fail if a fixture ever again
names a part whose slot has moved.
"""

from __future__ import annotations


def test_default_cfg_parts_are_in_their_expected_slots(catalog, default_cfg):
    by_id = {p["id"]: p for p in catalog["parts"]}
    for field, expected_slot in [
        ("fixture", "fixture"),
        ("arm", "arm"),
        ("pole", "pole"),
        ("baseCover", "baseCover"),
    ]:
        part_id = getattr(default_cfg, field)
        assert part_id in by_id, f"{field}={part_id!r} is not in the catalog"
        actual = by_id[part_id]["slot"]
        assert actual == expected_slot, (
            f"{field}={part_id!r} has slot {actual!r}, expected {expected_slot!r}"
        )


def test_no_test_file_hardcodes_a_restolled_base_cover():
    """bc-fluted/bc-round are standalone products now — not base covers."""
    from pathlib import Path

    offenders = []
    for path in sorted(Path(__file__).parent.glob("test_*.py")):
        if path.name == Path(__file__).name:
            continue  # this file's own source is the pattern list, not a fixture
        text = path.read_text()
        for bad in ('baseCover="bc-fluted"', 'baseCover="bc-round"'):
            if bad in text:
                offenders.append(f"{path.name}: {bad}")
    assert offenders == [], f"hardcoded re-slotted base covers: {offenders}"
