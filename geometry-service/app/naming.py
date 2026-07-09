"""Deterministic file naming for generated geometry artifacts."""

from __future__ import annotations

import hashlib
import json

from .models import PoleConfig

DISCLAIMER = "Concept starter model - not final engineered or manufacturing-released design"


def config_hash(cfg: PoleConfig) -> str:
    """Return the first 8 hex chars of the SHA-256 over the canonical JSON of
    {pole, baseCover, arm, fixture, finish} with sorted keys and no whitespace.

    configId and rev are intentionally excluded so the same geometry always
    produces the same hash regardless of config identity or revision number.
    """
    canonical: dict = {
        "arm": cfg.arm,
        "baseCover": cfg.baseCover,
        "finish": cfg.finish,
        "fixture": cfg.fixture,
        "pole": cfg.pole,
    }
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
