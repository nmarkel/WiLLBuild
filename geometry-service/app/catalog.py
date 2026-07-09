"""Catalog loader and config validation for the geometry-service.

Socket-compat rule (mirrors src/lib/compat.ts canHost):
  A host can carry a part when the host exposes at least one socket
  whose `type` equals the part's `mount`.

Assembly chain:
  arm   hosts fixture  (arm's sockets include a socket whose type == fixture.mount)
  pole  hosts arm      (pole's sockets include a socket whose type == arm.mount)
  pole  hosts baseCover (pole's sockets include a socket whose type == baseCover.mount)
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from .models import PoleConfig

# Default path: one level up from geometry-service/ is the repo root.
_DEFAULT_CATALOG = Path(__file__).parent.parent.parent / "public" / "catalog.json"


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    """Load and cache catalog.json. CATALOG_PATH env var overrides the default."""
    catalog_path = Path(os.environ.get("CATALOG_PATH", _DEFAULT_CATALOG))
    with open(catalog_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _reload_catalog() -> dict:
    """Force-reload catalog (used in tests that set CATALOG_PATH)."""
    load_catalog.cache_clear()
    return load_catalog()


def part(catalog: dict, part_id: str) -> dict:
    """Return the catalog part with the given id.  Raises KeyError if not found."""
    for p in catalog["parts"]:
        if p["id"] == part_id:
            return p
    raise KeyError(f"Unknown part id: {part_id!r}")


def _can_host(host: dict, guest: dict) -> bool:
    """Return True when host exposes a socket whose type == guest's mount."""
    guest_mount = guest.get("mount")
    if guest_mount is None:
        return True  # parts with no mount (e.g. poles) are always accepted
    for socket in host.get("sockets", {}).values():
        if socket.get("type") == guest_mount:
            return True
    return False


def validate_config(catalog: dict, cfg: PoleConfig) -> None:
    """Validate a PoleConfig against the catalog.

    Raises ValueError with a descriptive message listing all problems found.
    Checks:
      1. All part ids exist in catalog
      2. Finish id exists in catalog
      3. Socket-compat: arm hosts fixture, pole hosts arm, pole hosts baseCover
    """
    problems: list[str] = []

    # --- Resolve parts (collect failures but continue to check compat) ---
    fixture_part: dict | None = None
    arm_part: dict | None = None
    pole_part: dict | None = None
    base_cover_part: dict | None = None

    for field, part_id in [
        ("fixture", cfg.fixture),
        ("arm", cfg.arm),
        ("pole", cfg.pole),
        ("baseCover", cfg.baseCover),
    ]:
        try:
            p = part(catalog, part_id)
            if field == "fixture":
                fixture_part = p
            elif field == "arm":
                arm_part = p
            elif field == "pole":
                pole_part = p
            elif field == "baseCover":
                base_cover_part = p
        except KeyError:
            problems.append(f"Unknown {field} id: {part_id!r}")

    # --- Check finish id ---
    finish_ids = {f["id"] for f in catalog.get("finishes", [])}
    if cfg.finish not in finish_ids:
        problems.append(f"Unknown finish id: {cfg.finish!r}")

    # --- Socket-compat checks (only when both parts resolved) ---
    if arm_part is not None and fixture_part is not None:
        if not _can_host(arm_part, fixture_part):
            problems.append(
                f"Socket mismatch: arm {cfg.arm!r} cannot host fixture {cfg.fixture!r} "
                f"(fixture mount={fixture_part.get('mount')!r}, "
                f"arm sockets={list(arm_part.get('sockets', {}).keys())})"
            )

    if pole_part is not None and arm_part is not None:
        if not _can_host(pole_part, arm_part):
            problems.append(
                f"Socket mismatch: pole {cfg.pole!r} cannot host arm {cfg.arm!r} "
                f"(arm mount={arm_part.get('mount')!r}, "
                f"pole sockets={list(pole_part.get('sockets', {}).keys())})"
            )

    if pole_part is not None and base_cover_part is not None:
        if not _can_host(pole_part, base_cover_part):
            problems.append(
                f"Socket mismatch: pole {cfg.pole!r} cannot host baseCover {cfg.baseCover!r} "
                f"(baseCover mount={base_cover_part.get('mount')!r}, "
                f"pole sockets={list(pole_part.get('sockets', {}).keys())})"
            )

    if problems:
        raise ValueError("; ".join(problems))
