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

    Phase 0.11 (Workstream Z2) adds two more, and they are why Z1 and Z2 had to
    ship together.  Neither changes the *geometry*, but both change what is
    PRINTED on the generated spec sheet / concept card / bundle now that the
    part-number resolver is restored:

    * ``specOptions`` — the ordering-column and options/accessories selections
      that resolve each component's part number.  Before this, two configs
      differing only in (say) cord length hashed identically and the second one
      was served the first one's cached PDF, showing the wrong part number.
    * ``finishes`` — the per-slot finish overrides (Workstream A).  Each slot's
      finish drives its own finish segment in that component's part number.

    Both are included ONLY when non-empty, so every config that predates them
    keeps its historical hash byte-for-byte and existing caches stay valid.

    Deliberately still excluded: ``armOrientation`` and ``accessoryPlacements``.
    They round-trip through the model but reach no generated artifact yet, so
    hashing them would only fragment the cache.  Add them here in the same
    commit that makes an adapter read them.
    """
    canonical: dict = {
        "arm": cfg.arm,
        "armCount": cfg.armCount,
        # exclude_none matters: Phase 0.11 added an optional `size` to
        # BannerConfig, and a plain model_dump() would inject "size": null into
        # every pre-0.11 config's payload and change its historical hash.
        "banner": cfg.banner.model_dump(exclude_none=True) if cfg.banner is not None else None,
        "baseCover": cfg.baseCover,
        "finish": cfg.finish,
        "fixture": cfg.fixture,
        "pole": cfg.pole,
    }

    # A map of empty selections is not a selection: prune empties entirely so
    # the hash stays identical to the same config without the field.
    finishes = {slot: fid for slot, fid in sorted((cfg.finishes or {}).items()) if fid}
    if finishes:
        canonical["finishes"] = finishes

    spec_options = {
        slot: {key: value for key, value in sorted(columns.items()) if value}
        for slot, columns in sorted((cfg.specOptions or {}).items())
        if columns
    }
    # Multi-select code order is NOT normalised: the part number appends codes
    # in stored order, so two configs with the same codes in a different order
    # genuinely print different numbers and must hash apart.
    spec_options = {slot: cols for slot, cols in spec_options.items() if cols}
    if spec_options:
        canonical["specOptions"] = spec_options

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
