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
    """Dynamically enumerate valid PoleConfig combinations from catalog socket matching.

    For every fixture, arm that can host it, pole that can host that arm,
    and baseCover that the pole can host, yield a PoleConfig using the first
    available finish from the catalog.
    """
    def _can_host(host: dict, guest: dict) -> bool:
        """Return True when host exposes a socket whose type == guest's mount."""
        guest_mount = guest.get("mount")
        if guest_mount is None:
            return True
        for socket in host.get("sockets", {}).values():
            if socket.get("type") == guest_mount:
                return True
        return False

    def part_by_id(part_id: str) -> dict:
        """Return part by id."""
        for p in catalog["parts"]:
            if p["id"] == part_id:
                return p
        raise KeyError(f"Unknown part id: {part_id!r}")

    combos: list[PoleConfig] = []
    default_finish = "matte-black"  # Use first finish from catalog if not found
    if catalog.get("finishes"):
        default_finish = catalog["finishes"][0]["id"]

    fixtures = [p for p in catalog["parts"] if p["slot"] == "fixture"]
    arms = [p for p in catalog["parts"] if p["slot"] == "arm"]
    poles = [p for p in catalog["parts"] if p["slot"] == "pole"]
    base_covers = [p for p in catalog["parts"] if p["slot"] == "baseCover"]

    combo_id = 0
    for fixture in fixtures:
        for arm in arms:
            if not _can_host(arm, fixture):
                continue
            for pole in poles:
                if not _can_host(pole, arm):
                    continue
                for base_cover in base_covers:
                    if not _can_host(pole, base_cover):
                        continue
                    combo_id += 1
                    combos.append(
                        PoleConfig(
                            configId=f"test-combo-{combo_id:03d}",
                            pole=pole["id"],
                            baseCover=base_cover["id"],
                            arm=arm["id"],
                            fixture=fixture["id"],
                            finish=default_finish,
                            rev=1,
                        )
                    )

    return combos


@pytest.fixture(scope="session")
def all_valid_combos(catalog: dict) -> list[PoleConfig]:
    """Fixture version of valid_combos."""
    return valid_combos(catalog)


def first_base_cover_for(catalog: dict, pole_id: str) -> str:
    """The first catalog baseCover the given pole can host.

    Derived instead of hardcoded: Phase 0.10.5 moved bc-fluted/bc-round to the
    'standalone' slot, so any literal base-cover id in a fixture is a latent
    129-test failure.  Socket matching mirrors compat.ts canHost.
    """
    poles = [p for p in catalog["parts"] if p["id"] == pole_id]
    if not poles:
        raise KeyError(f"Unknown pole id: {pole_id!r}")
    pole = poles[0]
    socket_types = {s.get("type") for s in pole.get("sockets", {}).values()}
    for part in catalog["parts"]:
        if part["slot"] != "baseCover":
            continue
        mount = part.get("mount")
        if mount is None or mount in socket_types:
            return part["id"]
    raise LookupError(f"No baseCover in the catalog mounts on {pole_id!r}")


@pytest.fixture(scope="session")
def default_cfg(catalog: dict) -> PoleConfig:
    """The canonical single-arm WiLLstudio config used across the suite.

    Pole/arm/fixture stay at their historic ids (still correctly slotted, and
    several tests assert on their geometry); only the baseCover is derived,
    because that is the slot Phase 0.10.5 re-slotted.
    """
    return PoleConfig(
        configId="test-cfg-abc12345",
        pole="alum-pole-20",
        baseCover=first_base_cover_for(catalog, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )
