"""PDF spec-sheet adapter.

Wraps ``app.spec_template.render_spec`` and writes ``<base_name>.pdf``
to ctx.out_dir.

The adapter always reports ``available() → True``; fpdf2 is a hard
dependency of the service.

One template, two modes
-----------------------
``render_spec(ctx, mode='spec'|'concept-card')`` handles both document
types.  This adapter always calls with ``mode='spec'``; callers that want
a concept card should call ``render_spec`` directly or add a second adapter
variant later.
"""

from __future__ import annotations

from pathlib import Path

from app.spec_template import render_spec

from .base import Adapter, GenContext


class PdfAdapter:
    """Adapter that produces a branded WiLL PDF spec-sheet."""

    format: str = "pdf"

    def available(self) -> bool:
        """fpdf2 is a hard dependency; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        """Render spec-sheet PDF and write to ctx.out_dir/<base_name>.pdf."""
        # Enrich summary with finish_ral from catalog if not already present
        _enrich_summary_ral(ctx)

        pdf_bytes = render_spec(ctx, mode="spec")
        out_path = ctx.out_dir / f"{ctx.base_name}.pdf"
        out_path.write_bytes(pdf_bytes)
        return [out_path]


def _enrich_summary_ral(ctx: GenContext) -> None:
    """Add finish_ral to ctx.summary from the catalog finish definition.

    main.py builds summary before PDF is registered; this ensures RAL is
    available regardless of build order.
    """
    if "finish_ral" in ctx.summary:
        return  # already populated (e.g. by tests)

    finish_id = ctx.cfg.finish
    for finish_def in ctx.catalog.get("finishes", []):
        if finish_def["id"] == finish_id:
            ctx.summary["finish_ral"] = finish_def.get("ral", "")
            return
    ctx.summary["finish_ral"] = ""
