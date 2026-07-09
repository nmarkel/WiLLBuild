"""Shared pytest fixtures for geometry-service tests."""

from __future__ import annotations

import pytest

from app.catalog import load_catalog
from app.models import PoleConfig


@pytest.fixture(scope="session")
def catalog() -> dict:
    """Return the loaded catalog dict (cached for the session)."""
    load_catalog.cache_clear()
    return load_catalog()


def valid_combos(catalog: dict) -> list[PoleConfig]:
    """Return a list of valid PoleConfig combinations for parametric testing.

    Covers the main socket-compat paths:
      - pendant fixture (gvx-pendant) + pendant arm (sh1-shepherds-hook / pa1 / pm1)
      - post-top fixture (drx-post-top) + direct-mount adapter arm
      - coach fixture (mvx-coach) + upsweep arm
    Each combo uses alum-pole-20 and bc-fluted with matte-black finish.
    """
    finish = "matte-black"
    pole = "alum-pole-20"
    base = "bc-fluted"

    combos = [
        # GVX Pendant + SH1 Shepherds Hook
        PoleConfig(
            configId="test-combo-001",
            pole=pole,
            baseCover=base,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish=finish,
            rev=1,
        ),
        # GVX Pendant + PA1 Pendant Arm
        PoleConfig(
            configId="test-combo-002",
            pole=pole,
            baseCover=base,
            arm="pa1-pendant-arm",
            fixture="gvx-pendant",
            finish=finish,
            rev=1,
        ),
        # GVX Pendant + PM1 Pendant Arm
        PoleConfig(
            configId="test-combo-003",
            pole=pole,
            baseCover=base,
            arm="pm1-pendant-arm",
            fixture="gvx-pendant",
            finish=finish,
            rev=1,
        ),
        # DRX Post Top + Direct Mount
        PoleConfig(
            configId="test-combo-004",
            pole=pole,
            baseCover=base,
            arm="direct-mount",
            fixture="drx-post-top",
            finish=finish,
            rev=1,
        ),
        # MVX Coach + Upsweep
        PoleConfig(
            configId="test-combo-005",
            pole=pole,
            baseCover=base,
            arm="upsweep",
            fixture="mvx-coach",
            finish=finish,
            rev=1,
        ),
    ]
    return combos


@pytest.fixture(scope="session")
def all_valid_combos(catalog: dict) -> list[PoleConfig]:
    """Fixture version of valid_combos."""
    return valid_combos(catalog)
