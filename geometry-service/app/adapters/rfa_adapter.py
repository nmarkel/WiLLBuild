"""Revit .rfa adapter — APS Design Automation (mock + real scaffold).

Produces a .rfa file for the configured pole assembly by submitting a
workitem to Autodesk Platform Services (APS) Design Automation.

When no APS credentials are present in the environment, a deterministic
MockApsClient is used instead (see aps_client.py).  The file it produces is
a documented placeholder container, NOT a Revit-loadable .rfa — a true .rfa
can only be authored by Revit/APS.  IFC remains the immediately
Revit-importable BIM file.

The mock path appends a warning to ctx.warnings so main.py can surface it
in the GenerateResponse.
"""

from __future__ import annotations

from pathlib import Path

from app.naming import config_hash

from .aps_client import get_aps_client
from .base import Adapter, GenContext

_MOCK_WARNING = (
    "rfa: mock APS output - real .rfa pending Autodesk developer account"
)


class RfaAdapter:
    """Adapter that produces a .rfa file via APS Design Automation (or mock)."""

    format: str = "rfa"

    def available(self) -> bool:
        """Always available — mock client runs without any toolchain dependency."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        if ctx.assembly is None:
            raise RuntimeError(
                "RfaAdapter requires a built assembly (ctx.assembly is None)"
            )

        # Build params from assembly dims and config
        params = {
            "overall_height_mm": ctx.assembly.dims.overall_height,
            "category": "Lighting Fixtures",
            "family_name": f"WiLL Pole Assembly {ctx.cfg.configId}",
            "finish": ctx.cfg.finish,
            "arm_count": ctx.cfg.armCount,
            "banner_count": ctx.cfg.banner.count if ctx.cfg.banner else 0,
            "banner_arm": ctx.cfg.banner.armId if ctx.cfg.banner else "",
            "revision": ctx.cfg.rev,
        }

        cfg_hash = config_hash(ctx.cfg)
        client, is_mock = get_aps_client()
        rfa_bytes = client.submit(cfg_hash, params)

        out_path = ctx.out_dir / f"{ctx.base_name}.rfa"
        out_path.write_bytes(rfa_bytes)

        if is_mock:
            ctx.warnings.append(_MOCK_WARNING)

        return [out_path]


# Satisfy the Adapter Protocol at import time (type checker aid)
_: Adapter = RfaAdapter()  # type: ignore[assignment]
