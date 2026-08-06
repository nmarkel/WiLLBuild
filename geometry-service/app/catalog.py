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


def is_standalone_config(cfg: PoleConfig) -> bool:
    """Return True when the config represents a standalone single-product request.

    A standalone config has pole, arm, and baseCover all set to '' and a non-empty
    fixture id.  Finish may be '' (no finish selected) or a valid finish id.
    """
    return cfg.pole == "" and cfg.arm == "" and cfg.baseCover == "" and cfg.fixture != ""


def config_status(catalog: dict, cfg: PoleConfig) -> str:
    """Return 'Standard' if cfg matches a referenceAssemblies entry, else 'Configurable'.

    Mirrors src/lib/compat.ts configStatus — both compare pole/baseCover/arm/fixture.
    referenceAssemblies is currently empty, so this always returns 'Configurable'.
    """
    for ref in catalog.get("referenceAssemblies", []):
        if (
            ref.get("pole") == cfg.pole
            and ref.get("baseCover") == cfg.baseCover
            and ref.get("arm") == cfg.arm
            and ref.get("fixture") == cfg.fixture
        ):
            return "Standard"
    return "Configurable"


def validate_config(catalog: dict, cfg: PoleConfig) -> None:
    """Validate a PoleConfig against the catalog.

    Raises ValueError with a descriptive message listing all problems found.

    For full assembly configs, checks:
      1. All part ids exist in catalog
      2. Finish id exists in catalog
      3. Socket-compat: arm hosts fixture, pole hosts arm, pole hosts baseCover

    For standalone configs (pole == arm == baseCover == ''):
      1. fixture id exists in catalog (any slot, including 'standalone')
      2. finish is either '' or a valid finish id
      No socket-compat checks (no assembly).
    """
    problems: list[str] = []

    # --- Standalone path: single product, no assembly ---
    if is_standalone_config(cfg):
        try:
            part(catalog, cfg.fixture)
        except KeyError:
            problems.append(f"Unknown fixture id: {cfg.fixture!r}")
        if cfg.finish != "":
            finish_ids = {f["id"] for f in catalog.get("finishes", [])}
            if cfg.finish not in finish_ids:
                problems.append(f"Unknown finish id: {cfg.finish!r}")
        if problems:
            raise ValueError("; ".join(problems))
        return

    # --- armCount must be 1-4 (radial arm arrangement, Phase 0.8) ---
    if cfg.armCount not in (1, 2, 3, 4):
        problems.append(f"armCount must be 1-4, got {cfg.armCount!r}")

    # --- banner accessory (optional, Phase 0.8 C): armId must be a real banner
    # part and count must be one of that part's supported arrangements. ---
    if cfg.banner is not None:
        try:
            banner_part = part(catalog, cfg.banner.armId)
            if banner_part.get("slot") != "banner":
                problems.append(
                    f"banner armId {cfg.banner.armId!r} is a "
                    f"{banner_part.get('slot')!r}, not a banner"
                )
            else:
                arrangements = banner_part.get("arrangements", [])
                if cfg.banner.count not in arrangements:
                    problems.append(
                        f"banner count {cfg.banner.count} not in supported "
                        f"arrangements {arrangements}"
                    )
        except KeyError:
            problems.append(f"Unknown banner armId: {cfg.banner.armId!r}")

    # --- Full assembly path ---
    # All radial arms carry the SAME arm + fixture part, so the single-arm
    # socket-compat checks below (arm hosts fixture, pole hosts arm) cover every
    # arm in the arrangement — no per-arm re-validation needed.
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
        # Base cover is optional: brand builders without base covers (NAFCO,
        # WiLLsport) send ''. The socket checks below guard on None already.
        if field == "baseCover" and part_id == "":
            continue
        try:
            p = part(catalog, part_id)
            # Assert the resolved part's slot matches its config field.
            # e.g. a pole id in the fixture field must be rejected.
            part_slot = p.get("slot", "")
            if part_slot != field:
                problems.append(
                    f"part {part_id!r} is a {part_slot}, not a {field}"
                )
            else:
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

    # --- armCount must be a layout this family can actually be ordered in.
    # Mirrors allowedArmCounts in src/lib/compat.ts: the intersection of the
    # pole's and the arm's `arrangements` (absent → single only). Tyler's
    # catalog carries `arrangements` on 55 parts. ---
    if pole_part is not None and arm_part is not None and cfg.armCount in (1, 2, 3, 4):
        pole_set = pole_part.get("arrangements") or [1]
        arm_set = arm_part.get("arrangements") or [1]
        allowed = sorted({n for n in pole_set if n in arm_set and 1 <= n <= 4}) or [1]
        if cfg.armCount not in allowed:
            problems.append(
                f"armCount {cfg.armCount} not orderable for arm {cfg.arm!r} "
                f"on pole {cfg.pole!r} (allowed: {allowed})"
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
