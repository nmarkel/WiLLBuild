"""Base types for geometry format adapters.

GenContext carries everything an adapter needs — built once per request,
shared across all adapters so geometry is only computed once.

Adapter is a Protocol: any class with format + available() + generate() qualifies.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.kit.assembly import BuiltAssembly
from app.models import PoleConfig


@dataclass
class GenContext:
    """All inputs an adapter needs for one /generate request."""

    catalog: dict
    cfg: PoleConfig
    out_dir: Path
    base_name: str
    assembly: BuiltAssembly | None  # None when no geometric format is requested
    render_png: bytes | None
    summary: dict = field(default_factory=dict)
    produced: dict[str, list[Path]] = field(default_factory=dict)
    """Tracks files generated during THIS request, keyed by format string.

    Adapters append their output paths here after generation so that the
    bundle adapter can distinguish files produced in this request from
    stale on-disk artifacts left by previous requests.
    """
    warnings: list[str] = field(default_factory=list)
    """Warnings accumulated by adapters during this request.

    Adapters append human-readable warnings here (e.g. the mock-APS notice).
    main.py extends the response warnings list with ctx.warnings after
    the dispatch loop.
    """


@runtime_checkable
class Adapter(Protocol):
    """Protocol that every geometry adapter must satisfy."""

    format: str

    def available(self) -> bool:
        """Return True if the adapter's toolchain is available in this environment."""
        ...

    def generate(self, ctx: GenContext) -> list[Path]:
        """Produce output file(s); return their paths (inside ctx.out_dir)."""
        ...
