"""Adapter registry — the ONLY place engines meet the app.

Import each adapter here so that ``from app.adapters import REGISTRY`` gives
a fully populated dict.  main.py must import this module; it must not import
individual adapters directly.

DXF route selection
-------------------
The environment variable ``DXF_ROUTE`` chooses which DXF adapter registers
under the ``"dxf"`` key:

  DXF_ROUTE=direct      (default) — Route 1: catalog placeholder silhouettes
  DXF_ROUTE=projection            — Route 2: build123d solid projection

The swap touches ZERO files outside ``app/adapters/`` (+ shared titleblock.py).

DWG adapter
-----------
``DwgAdapter`` registers under ``"dwg"`` only when ODA File Converter is
present (``available()`` → True).  When absent, main.py adds the warning
"DWG skipped: ODA File Converter not installed".
"""

from __future__ import annotations

import os

from .base import Adapter, GenContext
from .ifc_adapter import IfcAdapter
from .pdf_adapter import PdfAdapter
from .step_adapter import StepAdapter

__all__ = ["REGISTRY", "Adapter", "GenContext"]

# ---------------------------------------------------------------------------
# Build the registry from all registered adapters.
# ---------------------------------------------------------------------------

_step = StepAdapter()
_ifc = IfcAdapter()
_pdf = PdfAdapter()

REGISTRY: dict[str, Adapter] = {}

for _adapter in (_step, _ifc, _pdf):
    if _adapter.available():
        REGISTRY[_adapter.format] = _adapter  # type: ignore[assignment]

# --- DXF: route selection via DXF_ROUTE env var ---
_dxf_route = os.environ.get("DXF_ROUTE", "direct").lower()

if _dxf_route == "projection":
    from .dxf_projection_adapter import DxfProjectionAdapter
    _dxf_adapter: Adapter = DxfProjectionAdapter()
else:
    # Default: "direct"
    from .dxf_adapter import DxfAdapter
    _dxf_adapter = DxfAdapter()

if _dxf_adapter.available():
    REGISTRY["dxf"] = _dxf_adapter

# --- DWG: only when ODA File Converter is installed ---
from .dwg_adapter import DwgAdapter, _ODA_WARNING  # noqa: E402

_dwg = DwgAdapter()
if _dwg.available():
    REGISTRY["dwg"] = _dwg
else:
    # Store the warning string so main.py can surface it per-request.
    # main.py reads REGISTRY_WARNINGS to emit skipped-adapter warnings.
    pass

# Expose the DWG-absent warning so main.py can emit it.
DWG_WARNING: str | None = None if _dwg.available() else _ODA_WARNING
