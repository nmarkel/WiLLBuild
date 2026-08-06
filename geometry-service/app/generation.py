"""Shared generation core — used by both the synchronous ``/generate`` route
and the asynchronous ``/jobs`` layer.

This module owns NO engine imports; it only calls ``build_assembly`` (kit) and
the format adapters via ``REGISTRY``.  The adapter boundary therefore stays
intact (engines live in ``app/adapters/`` + ``app/kit/`` only).

Two entry points
----------------
``validate_request(req)`` — raises ``ValueError`` with a human-readable message
    when the request is invalid.  Callers convert this to a 422 with the string
    as ``detail`` (identical to the historical ``/generate`` behaviour).

``generate_files(req, progress_cb=None)`` — assumes validation has passed,
    builds the assembly once, dispatches every requested format, and returns
    ``(configHash, files, warnings)``.  ``progress_cb(stage: str, pct: int)`` is
    invoked before/after each format so the async job layer can report progress.
"""

from __future__ import annotations

import base64
import math
import threading
from pathlib import Path
from typing import Callable

from .adapters import REGISTRY, DWG_WARNING
from .adapters.base import GenContext
from .catalog import is_standalone_config, load_catalog, validate_config
from .kit.assembly import build_assembly
from .models import GenerateRequest
from .naming import base_name, config_hash

# ---------------------------------------------------------------------------
# Geometric formats — when any of these are requested, build assembly once.
# "pdf" is included so AssemblyDims are computed for the spec-sheet dims block.
# ---------------------------------------------------------------------------
_GEOMETRIC_FORMATS = {"step", "ifc", "dxf", "dwg", "pdf", "bundle", "herocard", "rfa"}

# ---------------------------------------------------------------------------
# Format → on-disk output suffix.  Used by the cache index (app/jobs.py) to
# discover already-generated artifacts.  Keep in sync with the adapters'
# out_dir / f"{base_name}{suffix}" naming.
# ---------------------------------------------------------------------------
FORMAT_SUFFIX: dict[str, str] = {
    "step": ".step",
    "ifc": ".ifc",
    "dxf": ".dxf",
    "dwg": ".dwg",
    "pdf": ".pdf",
    "bundle": "_bundle.zip",
    "herocard": "-hero.pdf",
    "rfa": ".rfa",
}

ProgressCb = Callable[[str, int], None]

# ---------------------------------------------------------------------------
# Global generation lock.  build123d/OCCT is NOT thread-safe: two assemblies
# built concurrently corrupt the OCCT kernel.  Both the synchronous /generate
# route and the async job worker acquire this lock so geometry generation is
# strictly serialised across the whole process (uvicorn worker + job thread).
# ---------------------------------------------------------------------------
_GEN_LOCK = threading.Lock()


def _dwg_demoted(fmt: str) -> bool:
    """Return True when a missing 'dwg' adapter should be demoted to a warning
    (ODA absent) rather than a hard error."""
    return fmt == "dwg" and bool(DWG_WARNING)


def validate_request(req: GenerateRequest) -> None:
    """Validate a GenerateRequest exactly as the synchronous route did.

    Raises ValueError (message = 422 detail) on: invalid config, non-pdf
    formats for a standalone config, or an unregistered format that is not a
    demotable 'dwg'.
    """
    catalog = load_catalog()

    # --- Config validity ---
    validate_config(catalog, req.config)  # raises ValueError

    # --- Standalone config: only 'pdf' is permitted ---
    if is_standalone_config(req.config):
        non_pdf = [f for f in req.formats if f != "pdf"]
        if non_pdf:
            raise ValueError(
                "only spec sheets are available for standalone products; "
                f"unsupported formats: {non_pdf}"
            )

    # --- Every requested format must have a registered adapter (dwg demotes) ---
    for fmt in req.formats:
        if fmt not in REGISTRY and not _dwg_demoted(fmt):
            raise ValueError(f"No adapter registered for format: {fmt!r}")


def _build_summary(catalog: dict, req: GenerateRequest, assembly) -> dict:
    """Build the summary dict (dims, finish, parts) shared by adapters."""
    summary: dict = {}
    if assembly is not None:
        summary["dims"] = {
            "overall_height_mm": assembly.dims.overall_height,
            "pole_height_mm": assembly.dims.pole_height,
            "mounting_height_mm": assembly.dims.mounting_height,
            "arm_reach_mm": assembly.dims.arm_reach,
            "base_diameter_mm": assembly.dims.base_diameter,
        }
    finish_map = {f["id"]: f for f in catalog.get("finishes", [])}
    finish_obj = finish_map.get(req.config.finish, {})
    summary["finish"] = (
        finish_obj.get("name", req.config.finish) if finish_obj else req.config.finish
    )
    summary["finish_ral"] = finish_obj.get("ral", "") if finish_obj else ""

    parts_list = []
    part_map = {p["id"]: p for p in catalog.get("parts", [])}
    for slot_field, slot_name in [
        ("fixture", "fixture"),
        ("arm", "arm"),
        ("pole", "pole"),
        ("baseCover", "baseCover"),
    ]:
        part_id = getattr(req.config, slot_field)
        if not part_id:
            continue
        part_obj = part_map.get(part_id)
        if part_obj:
            parts_list.append(
                {
                    "slot": slot_name,
                    "id": part_id,
                    "name": part_obj.get("name", part_id),
                    "productUrl": part_obj.get("productUrl", ""),
                }
            )
    summary["parts"] = parts_list

    # Arm arrangement (Phase 0.8) — only surfaced when >1 arm so single-arm
    # spec sheets / hero cards are byte-identical to pre-0.8 output. Label text
    # mirrors the frontend src/lib/summary.ts armArrangementLabel.
    arm_count = getattr(req.config, "armCount", 1) or 1
    if arm_count > 1:
        summary["arm_count"] = arm_count
        summary["arm_arrangement"] = _ARM_ARRANGEMENT_LABELS.get(
            arm_count, f"{arm_count} arms"
        )

    # Banner arm (Phase 0.8 C / 0.10 C) — one summary line mirroring
    # bannerSummaryLine in src/lib/banner.ts: the banner is defined by its two
    # mounting bars, so the line LABELS the banner height and both bar heights
    # above grade.  Only emitted when a banner is present, so no-banner spec
    # sheets / hero cards are byte-identical to earlier output.
    banner = getattr(req.config, "banner", None)
    if banner is not None:
        banner_part = part_map.get(banner.armId)
        banner_name = banner_part.get("name", banner.armId) if banner_part else banner.armId
        sides = "opposite pair" if banner.count == 2 else f"{banner.count}-side"
        geom = _banner_geometry(banner_part, banner.heightFt) if banner_part else None
        if geom is None:
            h = banner.heightFt
            h_txt = str(int(h)) if float(h).is_integer() else str(h)
            summary["banner"] = f"{banner_name} - {sides} @ {h_txt} ft"
        else:
            panel_mm, top_mm, bottom_mm = geom
            summary["banner"] = (
                f"{banner_name} - {sides}, banner height {round(panel_mm / 25.4)} in "
                f"(top bar {_ft_in(top_mm)} / bottom bar {_ft_in(bottom_mm)} above grade)"
            )
    return summary


def _ft_in(mm: float) -> str:
    """Millimetres -> ``9'-2"`` (mirrors formatFtIn in src/lib/banner.ts).

    Uses ``floor(x + 0.5)`` rather than Python's builtin ``round()`` (which is
    round-half-to-even) so this matches JS ``Math.round`` (round-half-away-
    from-zero) exactly on a .5 inch remainder — the two "mirror" functions
    must agree on every input, not just the ones the current catalog happens
    to produce.
    """
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = math.floor(total_inches % 12 + 0.5)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


def _banner_geometry(banner_part: dict, height_ft: float) -> tuple[float, float, float] | None:
    """(panel height, top-bar height, bottom-bar height) in mm, above grade.

    Derived from the banner arm's placeholder geometry exactly like
    ``bannerGeometry`` in src/lib/banner.ts: the tallest box child is the panel,
    the others are the two mounting bars.
    """
    placeholder = banner_part.get("placeholder") or {}
    if placeholder.get("kind") != "group":
        return None
    boxes = [c for c in placeholder.get("children", []) if c.get("spec", {}).get("kind") == "box"]
    if not boxes:
        return None

    def height_of(child: dict) -> float:
        return child["spec"]["sizeM"][1]

    def center_y(child: dict) -> float:
        return child["position"][1] + height_of(child) / 2

    panel = max(boxes, key=height_of)
    bars = [c for c in boxes if c is not panel]
    mount_mm = height_ft * 304.8  # ft -> mm
    bar_ys = [center_y(c) for c in bars]
    panel_y = center_y(panel)
    panel_h = height_of(panel)
    top_m = max(bar_ys) if bar_ys else panel_y + panel_h / 2
    bottom_m = min(bar_ys) if bar_ys else panel_y - panel_h / 2
    return panel_h * 1000.0, mount_mm + top_m * 1000.0, mount_mm + bottom_m * 1000.0


# Arm-arrangement labels — mirror src/lib/summary.ts armArrangementLabel.
# Phase 0.10.5: arms mount on a 90-degree drilled tenon, so a triple is 3@90.
_ARM_ARRANGEMENT_LABELS: dict[int, str] = {
    1: "Single",
    2: "Twin (2 @ 180 deg)",
    3: "Triple (3 @ 90 deg)",
    4: "Quad (4 @ 90 deg)",
}


def _decode_render_png(req: GenerateRequest) -> tuple[bytes | None, str | None]:
    """Decode renderPng from base64; return (bytes, warning)."""
    if not req.renderPng:
        return None, None
    try:
        png_data = req.renderPng
        if "," in png_data:
            png_data = png_data.split(",", 1)[1]
        return base64.b64decode(png_data), None
    except Exception as exc:  # noqa: BLE001
        return None, f"renderPng ignored: invalid base64 ({exc})"


def generate_files(
    req: GenerateRequest,
    out_dir: Path,
    progress_cb: ProgressCb | None = None,
) -> tuple[str, list[dict], list[str]]:
    """Build the assembly and dispatch every requested format.

    Assumes ``validate_request(req)`` already passed.  Returns
    ``(configHash, files, warnings)`` where ``files`` is a list of dicts with
    keys ``format, filename, url, sizeBytes``.
    """
    catalog = load_catalog()
    is_standalone = is_standalone_config(req.config)

    def _emit(stage: str, pct: int) -> None:
        if progress_cb is not None:
            progress_cb(stage, pct)

    _emit("validating", 2)

    # --- Which formats will actually run (dwg demotes to a warning) ---
    dwg_skipped = any(_dwg_demoted(f) for f in req.formats)
    runnable = [f for f in req.formats if f in REGISTRY]

    needs_geometry = not is_standalone and any(
        f in _GEOMETRIC_FORMATS for f in req.formats
    )

    files: list[dict] = []
    warnings: list[str] = []

    # Serialise all geometry generation (OCCT is not thread-safe).  Held across
    # both the build and the adapter dispatch that reads the built solid.
    with _GEN_LOCK:
        # --- Build assembly once if needed ---
        _emit("building geometry", 8)
        assembly = build_assembly(catalog, req.config) if needs_geometry else None

        summary = _build_summary(catalog, req, assembly)
        render_png_bytes, render_png_warning = _decode_render_png(req)

        ctx = GenContext(
            catalog=catalog,
            cfg=req.config,
            out_dir=out_dir,
            base_name=base_name(catalog, req.config),
            assembly=assembly,
            render_png=render_png_bytes,
            summary=summary,
        )

        if render_png_warning:
            warnings.append(render_png_warning)
        if dwg_skipped and DWG_WARNING:
            warnings.append(DWG_WARNING)

        total = max(len(runnable), 1)
        for i, fmt in enumerate(runnable):
            _emit(f"generating {fmt}", 10 + int(85 * i / total))
            adapter = REGISTRY[fmt]
            try:
                out_paths = adapter.generate(ctx)
                ctx.produced[fmt] = list(out_paths)
                for out_path in out_paths:
                    files.append(
                        {
                            "format": fmt,
                            "filename": out_path.name,
                            "url": f"/files/{out_path.name}",
                            "sizeBytes": out_path.stat().st_size,
                        }
                    )
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{fmt}: {exc}")

        warnings.extend(ctx.warnings)

    _emit("done", 100)
    return config_hash(req.config), files, warnings
