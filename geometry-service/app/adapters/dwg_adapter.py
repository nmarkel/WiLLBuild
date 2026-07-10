"""DWG format adapter — ODA File Converter wrapper.

Converts the DXF output produced by the registered dxf adapter to DWG
(ACAD2018 format) using the ODA File Converter command-line tool.

Availability
------------
``available()`` returns True only when ODA File Converter is found at one
of two well-known locations:

  1. On PATH: ``shutil.which('ODAFileConverter')``
  2. macOS bundle: ``/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter``

When ODA is absent the adapter is not registered and main.py emits:

    "DWG skipped: ODA File Converter not installed"

DXF dependency
--------------
``generate()`` first checks whether a ``.dxf`` file with the same base name
already exists in ``ctx.out_dir`` (placed there by the dxf adapter earlier in
the same /generate request).  If it does not exist it calls the registered dxf
adapter to produce it before converting.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .base import Adapter, GenContext

# Known macOS bundle path for ODA File Converter
_ODA_MACOS_PATH = Path(
    "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter"
)

_ODA_WARNING = "DWG skipped: ODA File Converter not installed"


def _find_oda() -> Path | None:
    """Return the ODA File Converter executable Path, or None if not found."""
    on_path = shutil.which("ODAFileConverter")
    if on_path:
        return Path(on_path)
    if _ODA_MACOS_PATH.exists():
        return _ODA_MACOS_PATH
    return None


class DwgAdapter:
    """Adapter that converts DXF → DWG via ODA File Converter."""

    format: str = "dwg"

    def available(self) -> bool:
        """Return True only when ODA File Converter is installed."""
        return _find_oda() is not None

    def generate(self, ctx: GenContext) -> list[Path]:
        """Convert the DXF for this config to DWG; return [dxf_path, dwg_path]."""
        oda = _find_oda()
        if oda is None:
            raise RuntimeError(_ODA_WARNING)

        # --- Ensure DXF exists ---
        dxf_path = ctx.out_dir / f"{ctx.base_name}.dxf"
        if not dxf_path.exists():
            # Generate DXF first via the registered dxf adapter
            from app.adapters import REGISTRY
            dxf_adapter = REGISTRY.get("dxf")
            if dxf_adapter is None:
                raise RuntimeError("No dxf adapter registered; cannot produce DWG")
            dxf_adapter.generate(ctx)

        if not dxf_path.exists():
            raise RuntimeError(f"DXF not found after generation: {dxf_path}")

        # --- Convert DXF → DWG using ODA File Converter ---
        # ODA CLI: ODAFileConverter <input_dir> <output_dir> <output_version>
        #          <output_type> <recurse> <audit> [filter]
        # output_version: ACAD2018, output_type: DWG
        dwg_path = ctx.out_dir / f"{ctx.base_name}.dwg"

        cmd = [
            str(oda),
            str(ctx.out_dir),          # input directory
            str(ctx.out_dir),          # output directory
            "ACAD2018",                # DWG version
            "DWG",                     # output type
            "0",                       # recurse = no
            "1",                       # audit = yes
            f"{ctx.base_name}.dxf",    # input file filter
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"ODA File Converter failed (rc={result.returncode}): "
                f"{result.stderr or result.stdout}"
            )

        if not dwg_path.exists():
            raise RuntimeError(
                f"ODA File Converter ran but DWG not found: {dwg_path}"
            )

        return [dxf_path, dwg_path]
