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
