"""Hero card (concept card) PDF adapter.

Produces a render-forward one-pager using ``render_spec(ctx, mode='concept-card')``.
The output file gets a ``-hero`` suffix so it can coexist with the spec-sheet PDF
in a bundle: ``<base_name>-hero.pdf``.

Always available (fpdf2 is a hard dependency).
"""

from __future__ import annotations

from pathlib import Path

from app.adapters._spec_template import render_spec
from app.catalog import config_status

from .base import Adapter, GenContext


class HeroCardAdapter:
    """Adapter that produces a branded WiLL hero (concept) card PDF."""

    format: str = "herocard"

    def available(self) -> bool:
        """fpdf2 is a hard dependency; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        """Render hero card PDF and write to ctx.out_dir/<base_name>-hero.pdf."""
        # Set config status so the template can draw the status chip.
        ctx.summary["status"] = config_status(ctx.catalog, ctx.cfg)

        pdf_bytes = render_spec(ctx, mode="concept-card")
        out_path = ctx.out_dir / f"{ctx.base_name}-hero.pdf"
        out_path.write_bytes(pdf_bytes)
        return [out_path]


# Satisfy the Adapter Protocol at import time (type checker aid)
_: Adapter = HeroCardAdapter()  # type: ignore[assignment]
