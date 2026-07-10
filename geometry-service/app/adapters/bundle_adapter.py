"""Bundle format adapter.

Produces ``<base_name>_bundle.zip`` containing:

  <base_name>.step   — STEP solid via REGISTRY["step"]
  <base_name>.pdf    — PDF spec-sheet via REGISTRY["pdf"]
  render.png         — render image (only when ctx.render_png is present)
  config.json        — exact PoleConfig as sent, canonical JSON (sorted keys)
  summary.txt        — human-readable: parts, finish + RAL, dims mm + ft-in
  README.txt         — DISCLAIMER + configId + rev + quote URL

Determinism
-----------
Every ZipInfo has ``date_time=(1980, 1, 1, 0, 0, 0)`` (the earliest date ZIP
supports) and entries are written in a fixed canonical order so two runs with
identical inputs produce byte-identical archives.

The STEP format embeds a wall-clock timestamp in its ``FILE_NAME`` header
line.  To achieve byte-level determinism in the bundle, the bundled copy of
the STEP bytes has that line replaced with a fixed stub
(``FILE_NAME('','2000-01-01T00:00:00','','','','','');``).  The on-disk
``.step`` file is left unchanged so it remains a valid standalone artefact
with a real timestamp.

STEP / PDF reuse
----------------
The adapter first checks whether the output file already exists in
``ctx.out_dir`` (placed there by an earlier adapter in the same /generate
request).  If it does not exist, it calls ``REGISTRY["step"]`` /
``REGISTRY["pdf"]`` to produce it.  This mirrors how DwgAdapter reuses the
DXF output.
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

from app.naming import DISCLAIMER

# Fixed FILE_NAME stub used in bundled STEP bytes for determinism.
# The real on-disk .step file keeps its authentic timestamp.
_STEP_FILE_NAME_STUB = b"FILE_NAME('','2000-01-01T00:00:00','','','','','');"

# Pattern to match the FILE_NAME line in a STEP file (single ASCII line).
_STEP_FILE_NAME_RE = re.compile(
    rb"^FILE_NAME\(.*?\);",
    re.MULTILINE | re.DOTALL,
)

from .base import Adapter, GenContext

# Quote URL (matches the PDF spec-sheet footer)
_QUOTE_URL = "https://willbrands.com/pages/request-a-quote"

# Fixed epoch for deterministic ZipInfo date_time
_ZIP_DATE_TIME = (1980, 1, 1, 0, 0, 0)


def _mm_to_ft_in(mm: float) -> str:
    """Convert millimetres to a ft-in string like \"20'-0\"\" or \"6'-2\"\"."""
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = round(total_inches % 12)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


def _build_summary_txt(ctx: GenContext) -> str:
    """Build human-readable summary text from ctx.summary."""
    lines: list[str] = []
    lines.append("WiLL Lighting Systems — Configuration Summary")
    lines.append("=" * 48)
    lines.append("")

    # Parts table
    lines.append("Components")
    lines.append("-" * 30)
    for part in ctx.summary.get("parts", []):
        slot = part.get("slot", "")
        name = part.get("name", part.get("id", ""))
        url = part.get("productUrl", "")
        slot_label = {
            "fixture": "Fixture   ",
            "arm": "Arm       ",
            "pole": "Pole      ",
            "baseCover": "Base Cover",
        }.get(slot, slot.ljust(10))
        line = f"  {slot_label}  {name}"
        if url:
            line += f"  ({url})"
        lines.append(line)
    lines.append("")

    # Finish
    finish_name = ctx.summary.get("finish", "")
    finish_ral = ctx.summary.get("finish_ral", "")
    finish_str = finish_name
    if finish_ral:
        finish_str += f"  ({finish_ral})"
    lines.append(f"Finish: {finish_str}")
    lines.append("")

    # Dimensions
    dims = ctx.summary.get("dims", {})
    if dims:
        lines.append("Dimensions")
        lines.append("-" * 30)
        dim_labels = [
            ("Overall Height", "overall_height_mm"),
            ("Pole Height", "pole_height_mm"),
            ("Mounting Height", "mounting_height_mm"),
            ("Arm Reach", "arm_reach_mm"),
            ("Base Diameter", "base_diameter_mm"),
        ]
        for label, key in dim_labels:
            val_mm = dims.get(key)
            if val_mm is None:
                continue
            val_mm_i = int(round(val_mm))
            val_ftin = _mm_to_ft_in(val_mm)
            lines.append(f"  {label:<20}  {val_mm_i:>6} mm  {val_ftin:>8}")
        lines.append("")

    lines.append(f"Config ID: {ctx.cfg.configId}  |  Rev: {ctx.cfg.rev}")
    return "\n".join(lines)


def _build_readme_txt(ctx: GenContext) -> str:
    """Build README.txt text with DISCLAIMER, config metadata, and quote URL."""
    lines: list[str] = []
    lines.append("WiLL Lighting Systems — Geometry Bundle")
    lines.append("=" * 48)
    lines.append("")
    lines.append("DISCLAIMER")
    lines.append("-" * 30)
    lines.append(DISCLAIMER)
    lines.append("")
    lines.append("Configuration")
    lines.append("-" * 30)
    lines.append(f"Config ID : {ctx.cfg.configId}")
    lines.append(f"Revision  : {ctx.cfg.rev}")
    lines.append("")
    lines.append("Files in this bundle")
    lines.append("-" * 30)
    lines.append("  <name>.step    STEP solid (concept geometry)")
    lines.append("  <name>.pdf     Specification sheet (PDF)")
    lines.append("  render.png     3D render image (if provided)")
    lines.append("  config.json    Machine-readable PoleConfig")
    lines.append("  summary.txt    Human-readable summary")
    lines.append("  README.txt     This file")
    lines.append("")
    lines.append("Request a Quote")
    lines.append("-" * 30)
    lines.append(_QUOTE_URL)
    lines.append("")
    lines.append("(c) WiLL Lighting Systems. All rights reserved.")
    return "\n".join(lines)


def _normalize_step_bytes(data: bytes) -> bytes:
    """Replace the FILE_NAME line in STEP bytes with a fixed stub.

    This makes the bundled STEP bytes byte-deterministic across runs.
    The on-disk .step file is left unmodified.
    """
    return _STEP_FILE_NAME_RE.sub(_STEP_FILE_NAME_STUB, data, count=1)


def _add_entry(zf: zipfile.ZipFile, arcname: str, data: bytes) -> None:
    """Write ``data`` into the zip as ``arcname`` with fixed date_time."""
    info = zipfile.ZipInfo(arcname)
    info.date_time = _ZIP_DATE_TIME
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, data)


class BundleAdapter:
    """Adapter that produces a deterministic zip containing all delivery files."""

    format: str = "bundle"

    def available(self) -> bool:
        """Always True — only stdlib and already-registered adapters are needed."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        """Build the bundle zip and return [zip_path]."""
        from app.adapters import REGISTRY  # deferred to avoid circular import at module level

        zip_path = ctx.out_dir / f"{ctx.base_name}_bundle.zip"

        # --- Ensure STEP exists (produced this request, or generate now) ---
        step_path = ctx.out_dir / f"{ctx.base_name}.step"
        step_produced_this_request = any(
            p == step_path for p in ctx.produced.get("step", [])
        )
        if not step_produced_this_request:
            step_adapter = REGISTRY.get("step")
            if step_adapter is None:
                raise RuntimeError("No step adapter registered; cannot produce bundle")
            new_paths = step_adapter.generate(ctx)
            ctx.produced["step"] = list(new_paths)
        if not step_path.exists():
            raise RuntimeError(f"STEP not found after generation: {step_path}")

        # --- Ensure PDF exists (produced this request, or generate now) ---
        pdf_path = ctx.out_dir / f"{ctx.base_name}.pdf"
        pdf_produced_this_request = any(
            p == pdf_path for p in ctx.produced.get("pdf", [])
        )
        if not pdf_produced_this_request:
            pdf_adapter = REGISTRY.get("pdf")
            if pdf_adapter is None:
                raise RuntimeError("No pdf adapter registered; cannot produce bundle")
            new_paths = pdf_adapter.generate(ctx)
            ctx.produced["pdf"] = list(new_paths)
        if not pdf_path.exists():
            raise RuntimeError(f"PDF not found after generation: {pdf_path}")

        # --- Build canonical config JSON ---
        config_json = json.dumps(
            ctx.cfg.model_dump(),
            sort_keys=True,
            indent=2,
            ensure_ascii=True,
        ).encode("utf-8")

        # --- Build text files ---
        summary_txt = _build_summary_txt(ctx).encode("utf-8")
        readme_txt = _build_readme_txt(ctx).encode("utf-8")

        # --- Normalise STEP bytes for determinism (strip FILE_NAME timestamp) ---
        step_bytes = _normalize_step_bytes(step_path.read_bytes())

        # --- Write zip in fixed canonical order ---
        # Order: step, pdf, [render.png], config.json, summary.txt, README.txt
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            _add_entry(zf, f"{ctx.base_name}.step", step_bytes)
            _add_entry(zf, f"{ctx.base_name}.pdf", pdf_path.read_bytes())
            if ctx.render_png is not None:
                _add_entry(zf, "render.png", ctx.render_png)
            _add_entry(zf, "config.json", config_json)
            _add_entry(zf, "summary.txt", summary_txt)
            _add_entry(zf, "README.txt", readme_txt)

        return [zip_path]
