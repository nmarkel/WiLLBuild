"""Adapter registry — the ONLY place engines meet the app.

Import each adapter here so that ``from app.adapters import REGISTRY`` gives
a fully populated dict.  main.py must import this module; it must not import
individual adapters directly.
"""

from __future__ import annotations

from .base import Adapter, GenContext
from .step_adapter import StepAdapter

__all__ = ["REGISTRY", "Adapter", "GenContext"]

# Build the registry from all registered adapters.
_step = StepAdapter()

REGISTRY: dict[str, Adapter] = {}

for _adapter in (_step,):
    if _adapter.available():
        REGISTRY[_adapter.format] = _adapter  # type: ignore[assignment]
