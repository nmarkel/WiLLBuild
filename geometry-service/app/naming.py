"""Deterministic file naming for generated geometry artifacts."""

from __future__ import annotations

import hashlib
import json

from .models import PoleConfig

DISCLAIMER = "Concept starter model - not final engineered or manufacturing-released design"


def config_hash(cfg: PoleConfig) -> str:
    """Return the first 8 hex chars of the SHA-256 over the canonical JSON of
    {pole, baseCover, arm, fixture, finish, armCount} with sorted keys and no
    whitespace.

    configId and rev are intentionally excluded so the same geometry always
    produces the same hash regardless of config identity or revision number.

    ``armCount`` MUST be in the canonical dict: two different radial-arm
    arrangements (e.g. single vs twin) produce different geometry, so they must
    hash to different filenames — otherwise the on-disk cache serves the wrong
    file.  ``armCount=1`` (or an absent field defaulting to 1) is included as
    the integer 1, which is stable across old single-arm requests.

    ``banner`` (mid-shaft banner-arm accessory) is likewise part of the
    geometry, so it joins the whitelist as its serialised dict (``armId``,
    ``count``, ``heightFt``) when present, else ``None`` — a config with a
    banner hashes distinctly from the same config without one.

    ``partOptions`` (Phase 0.10) changes the printed part numbers rather than the
    geometry, and is included only when non-empty so historical hashes are
    unchanged.
    """
    canonical: dict = {
        "arm": cfg.arm,
        "armCount": cfg.armCount,
        "banner": cfg.banner.model_dump() if cfg.banner is not None else None,
        "baseCover": cfg.baseCover,
        "finish": cfg.finish,
        "fixture": cfg.fixture,
        "pole": cfg.pole,
    }
    # Phase 0.10 (Workstream 0): ordering selections do not change the geometry,
    # but they DO change the part numbers printed on the spec sheet / concept
    # card — so two configs that differ only in options must not share a cached
    # artifact.  The key is added ONLY when selections exist, so every pre-0.10
    # config keeps its historical hash byte-for-byte.
    if cfg.partOptions:
        selections = {
            part_id: {
                "addOns": sorted(sel.addOns),
                "codes": dict(sorted(sel.codes.items())),
            }
            for part_id, sel in sorted(cfg.partOptions.items())
            if sel.codes or sel.addOns
        }
        # A map of empty selections is not a selection: keep the key out entirely
        # so the hash stays identical to the same config without partOptions.
        if selections:
            canonical["partOptions"] = selections
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return digest[:8]


def base_name(catalog: dict, cfg: PoleConfig) -> str:  # noqa: ARG001
    """Return the canonical base filename for a generated artifact.

    Format: WiLL_{config_hash}_{first-8-chars-of-configId}
    """
    h = config_hash(cfg)
    short_id = cfg.configId[:8]
    return f"WiLL_{h}_{short_id}"
