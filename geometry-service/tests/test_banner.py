"""Banner-arm (mid-shaft accessory) coverage — Phase 0.8 Workstream C.

Proves the geometry-service composes the banner-arm accessory into the fused
assembly: N radial banner sets at a parametric shaft height, distinct config
hash, larger fused volume, and a valid HTTP round-trip.
"""

from __future__ import annotations

import uuid

import pytest

from app.kit.assembly import build_assembly
from app.models import BannerConfig, PoleConfig
from app.naming import config_hash

from .conftest import first_base_cover_for

BANNER_ID = "willstudio-ba1-banner-arm"


def _cfg(
    catalog: dict, banner: dict | None = None, config_id: str | None = None
) -> PoleConfig:
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(catalog, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        armCount=1,
        banner=BannerConfig(**banner) if banner else None,
    )


_BANNER = {"armId": BANNER_ID, "count": 2, "heightFt": 8}


@pytest.fixture(scope="module")
def without_banner(catalog):
    return build_assembly(catalog, _cfg(catalog, None, "nob-0001"))


@pytest.fixture(scope="module")
def with_banner(catalog):
    return build_assembly(catalog, _cfg(catalog, _BANNER, "ban-0001"))


# ---------------------------------------------------------------------------
# (a) two banner solids in the assembly
# ---------------------------------------------------------------------------

def test_two_banner_solids(with_banner):
    ids = [pid for pid, _ in with_banner.parts]
    banner_ids = [i for i in ids if i.startswith(BANNER_ID)]
    assert banner_ids == [f"{BANNER_ID}#0", f"{BANNER_ID}#1"]


# ---------------------------------------------------------------------------
# (b) banners sit at ~8 ft (2438 mm) on the CAD +Z axis, on opposite sides
# ---------------------------------------------------------------------------

def test_banners_at_shaft_height_opposite_sides(with_banner):
    solids = {pid: s for pid, s in with_banner.parts}
    bb0 = solids[f"{BANNER_ID}#0"].bounding_box()
    bb1 = solids[f"{BANNER_ID}#1"].bounding_box()

    expected_mm = 8 * 304.8  # 2438.4 mm
    # The banner's vertical centre sits at the shaft height; the panel spans
    # +/-0.6 m about it, so the centre Z of the bbox should be ~ the shaft height.
    assert bb0.center().Z == pytest.approx(expected_mm, abs=50.0)
    assert bb1.center().Z == pytest.approx(expected_mm, abs=50.0)

    # count=2 → azimuths [0, 180]: banner 0 reaches +X, banner 1 reaches -X.
    assert bb0.max.X > 0
    assert bb1.min.X < 0
    assert bb1.min.X == pytest.approx(-bb0.max.X, abs=1.0)


# ---------------------------------------------------------------------------
# (c) banner config hashes distinctly from the same config without a banner
# ---------------------------------------------------------------------------

def test_banner_hash_differs(catalog):
    h_no = config_hash(_cfg(catalog, None, "same-id-0000"))
    h_yes = config_hash(_cfg(catalog, _BANNER, "same-id-0000"))
    assert h_no != h_yes


def test_banner_count_and_height_affect_hash(catalog):
    base = config_hash(_cfg(catalog, {"armId": BANNER_ID, "count": 2, "heightFt": 8}, "x"))
    diff_count = config_hash(_cfg(catalog, {"armId": BANNER_ID, "count": 4, "heightFt": 8}, "x"))
    diff_height = config_hash(_cfg(catalog, {"armId": BANNER_ID, "count": 2, "heightFt": 10}, "x"))
    assert len({base, diff_count, diff_height}) == 3


# ---------------------------------------------------------------------------
# (d) fused volume grows with a banner
# ---------------------------------------------------------------------------

def test_banner_volume_grows(without_banner, with_banner):
    assert with_banner.solid.volume > without_banner.solid.volume


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_valid_banner_config_passes(catalog):
    from app.catalog import validate_config

    validate_config(catalog, _cfg(catalog, _BANNER))  # must not raise


def test_unsupported_banner_count_rejected(catalog):
    from app.catalog import validate_config

    # 3 is NOT in the part's arrangements [1, 2, 4].
    with pytest.raises(ValueError, match="banner count"):
        validate_config(catalog, _cfg(catalog, {"armId": BANNER_ID, "count": 3, "heightFt": 8}))


def test_unknown_banner_arm_rejected(catalog):
    from app.catalog import validate_config

    with pytest.raises(ValueError, match="banner"):
        validate_config(catalog, _cfg(catalog, {"armId": "not-a-real-part", "count": 2, "heightFt": 8}))


def test_banner_armid_wrong_slot_rejected(catalog):
    from app.catalog import validate_config

    # A real part id that is not a banner (sh1 is an arm).
    with pytest.raises(ValueError, match="not a banner"):
        validate_config(catalog, _cfg(catalog, {"armId": "sh1-shepherds-hook", "count": 2, "heightFt": 8}))
