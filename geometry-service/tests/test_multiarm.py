"""Multi-arm (radial armCount) coverage — Phase 0.8 Workstream A3, 0.10 A/D.

The single-arm code path is exercised elsewhere (test_kit, test_step, …).  These
tests prove that ``armCount>1`` composes N radially-placed arms + fixtures, that
the arrangement is geometrically symmetric, that the fused volume grows, and
that a twin config hashes to a distinct filename from the single-arm config.

Phase 0.10 re-points the representative arm: the ordering matrix says SH1 is
single-only, so clustering belongs to the **Side Shepherds Hook (SS)** family.
The 0.8 "twin SH1" demo was an unorderable product.  This file also pins the 90°
drilled-tenon azimuths (a triple is 3@90, NOT 3@120).
"""

from __future__ import annotations

import uuid

import pytest

from app.adapters.base import GenContext
from app.adapters.step_adapter import StepAdapter
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import base_name, config_hash

from .conftest import first_base_cover_for

M = 1000.0

# Phase 0.10: the valid multi-arm representative (SS1..SS4 on the ordering matrix).
_ARM = "willstudio-side-shepherds-hook-pole-top-brackets"


def _cfg(catalog: dict, arm_count: int = 1, config_id: str | None = None) -> PoleConfig:
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(catalog, "alum-pole-20"),
        arm=_ARM,
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        armCount=arm_count,
    )


@pytest.fixture(scope="module")
def single(catalog):
    return build_assembly(catalog, _cfg(catalog, 1, "single-cfg-0001"))


@pytest.fixture(scope="module")
def twin(catalog):
    return build_assembly(catalog, _cfg(catalog, 2, "twin-cfg-0001"))


# ---------------------------------------------------------------------------
# (a) part composition — 2 arm solids + 2 fixture solids
# ---------------------------------------------------------------------------

def test_twin_has_two_arms_and_two_fixtures(twin):
    ids = [pid for pid, _ in twin.parts]
    arm_ids = [i for i in ids if i.startswith(_ARM)]
    fx_ids = [i for i in ids if i.startswith("gvx-pendant")]
    assert arm_ids == [f"{_ARM}#0", f"{_ARM}#1"]
    assert fx_ids == ["gvx-pendant#0", "gvx-pendant#1"]
    # pole + baseCover + 2 arms + 2 fixtures
    assert len(twin.parts) == 6


def test_single_keeps_plain_part_ids(single):
    ids = [pid for pid, _ in single.parts]
    assert _ARM in ids
    assert "gvx-pendant" in ids
    assert not any("#" in i for i in ids)


# ---------------------------------------------------------------------------
# (b) the two arms are ~180 deg apart (symmetric reach about the pole axis)
# ---------------------------------------------------------------------------

def test_twin_arms_are_opposite(twin):
    solids = {pid: s for pid, s in twin.parts}
    bb0 = solids[f"{_ARM}#0"].bounding_box()
    bb1 = solids[f"{_ARM}#1"].bounding_box()
    # Arm 0 reaches +X, arm 1 reaches -X (rotated 180 deg about the pole axis).
    assert bb0.max.X > 0
    assert bb1.min.X < 0
    # Symmetric: arm 1's -X reach mirrors arm 0's +X reach.
    assert bb1.min.X == pytest.approx(-bb0.max.X, abs=1.0)
    assert bb1.max.X == pytest.approx(-bb0.min.X, abs=1.0)
    # Same vertical extent (rotation about the vertical axis preserves Z).
    assert bb1.max.Z == pytest.approx(bb0.max.Z, abs=1.0)


def test_twin_fixtures_are_opposite(twin):
    solids = {pid: s for pid, s in twin.parts}
    c0 = solids["gvx-pendant#0"].bounding_box().center()
    c1 = solids["gvx-pendant#1"].bounding_box().center()
    # Fixture centres mirror across the pole axis (X flips, Z equal).
    assert c1.X == pytest.approx(-c0.X, abs=1.0)
    assert c1.Z == pytest.approx(c0.Z, abs=1.0)


# ---------------------------------------------------------------------------
# (c) fused volume: twin ~= pole/base + 2 x (arm + fixture); twin > single
# ---------------------------------------------------------------------------

def test_twin_volume_grows(single, twin):
    assert twin.solid.volume > single.solid.volume


def test_twin_volume_matches_two_arm_sets(catalog, twin):
    solids = {pid: s for pid, s in twin.parts}
    arm_vol = solids[f"{_ARM}#0"].volume
    fx_vol = solids["gvx-pendant#0"].volume
    pole_vol = solids["alum-pole-20"].volume
    bc_vol = solids[first_base_cover_for(catalog, "alum-pole-20")].volume

    # Sum of individual (unfused) part volumes: pole + base + 2 arms + 2 fixtures.
    naive_sum = pole_vol + bc_vol + 2 * arm_vol + 2 * fx_vol
    # The fused solid is a little smaller than the naive sum (parts overlap at
    # the pole-top mount and where fixtures meet arms — ~6% here), but must be
    # close and never larger.
    assert twin.solid.volume <= naive_sum + 1.0
    assert twin.solid.volume == pytest.approx(naive_sum, rel=0.10)


def test_twin_reach_is_positive(twin):
    assert twin.dims.arm_reach > 0


# ---------------------------------------------------------------------------
# (d) twin config hashes differently from single
# ---------------------------------------------------------------------------

def test_twin_hash_differs_from_single(catalog):
    h1 = config_hash(_cfg(catalog, 1, "same-id-9999"))
    h2 = config_hash(_cfg(catalog, 2, "same-id-9999"))
    assert h1 != h2, "armCount must affect the config hash (cache-key correctness)"


def test_triple_and_quad_hash_distinctly(catalog):
    hashes = {config_hash(_cfg(catalog, n, "same-id-0000")) for n in (1, 2, 3, 4)}
    assert len(hashes) == 4


# ---------------------------------------------------------------------------
# Determinism: twin STEP exported twice is byte-identical (strip FILE_NAME)
# ---------------------------------------------------------------------------

def _strip_file_name(content: bytes) -> bytes:
    lines = content.split(b"\n")
    return b"\n".join(ln for ln in lines if not ln.startswith(b"FILE_NAME"))


def test_twin_step_export_is_deterministic(tmp_path_factory, catalog, twin):
    adapter = StepAdapter()
    cfg = _cfg(catalog, 2, "twin-det-0001")

    out1 = tmp_path_factory.mktemp("twin_a")
    ctx1 = GenContext(
        catalog=catalog, cfg=cfg, out_dir=out1,
        base_name=base_name(catalog, cfg), assembly=twin,
        render_png=None, summary={},
    )
    out2 = tmp_path_factory.mktemp("twin_b")
    ctx2 = GenContext(
        catalog=catalog, cfg=cfg, out_dir=out2,
        base_name=base_name(catalog, cfg), assembly=twin,
        render_png=None, summary={},
    )
    b1 = adapter.generate(ctx1)[0].read_bytes()
    b2 = adapter.generate(ctx2)[0].read_bytes()
    assert _strip_file_name(b1) == _strip_file_name(b2)


# ---------------------------------------------------------------------------
# Phase 0.10 (Workstream A): the 90-degree drilled tenon
# ---------------------------------------------------------------------------

def test_arm_azimuths_follow_the_drilled_tenon():
    """A triple is 3@90 with one leg empty — not the 0.8 assumption of 3@120."""
    from app.kit.assembly import _arm_azimuths

    assert _arm_azimuths(1) == [0.0]
    assert _arm_azimuths(2) == [0.0, 180.0]
    assert _arm_azimuths(3) == [0.0, 90.0, 180.0]
    assert _arm_azimuths(4) == [0.0, 90.0, 180.0, 270.0]
    for count in (1, 2, 3, 4):
        for deg in _arm_azimuths(count):
            assert deg % 90 == 0


def test_triple_places_the_third_arm_on_a_90_degree_leg(catalog):
    """Geometry proof: the triple's arms lie on +X, +Y/-Y and -X, never at 120."""
    triple = build_assembly(catalog, _cfg(catalog, 3, "triple-cfg-0001"))
    solids = {pid: s for pid, s in triple.parts}
    reaches = []
    for i in range(3):
        bb = solids[f"{_ARM}#{i}"].bounding_box()
        # The dominant horizontal reach direction of this arm.
        reaches.append((bb.max.X, bb.min.X, bb.max.Y, bb.min.Y))
    # Arm 0 reaches +X; arm 2 (180 deg) mirrors it in -X.
    assert reaches[0][0] > 0
    assert reaches[2][1] == pytest.approx(-reaches[0][0], abs=1.0)
    # Arm 1 (90 deg) reaches along Y, and barely along X — a 120 deg arm would
    # keep a large X component (cos(120) = -0.5 of the reach).
    arm1_x = max(abs(reaches[1][0]), abs(reaches[1][1]))
    arm1_y = max(abs(reaches[1][2]), abs(reaches[1][3]))
    assert arm1_y > arm1_x


def test_single_only_arm_is_rejected_for_a_multi_arm_request(catalog):
    """SH1 is single-only on the ordering matrix, so a 3-arm SH1 has no code."""
    from app.catalog import validate_config

    cfg = _cfg(catalog, 3, "sh1-triple-0001")
    cfg.arm = "sh1-shepherds-hook"
    with pytest.raises(ValueError, match="not orderable"):
        validate_config(catalog, cfg)
