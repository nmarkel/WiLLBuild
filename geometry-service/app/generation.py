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
from .catalog import assembly_mode, is_standalone_config, load_catalog, validate_config
from .merchandising import check_formats_servable, check_not_held, check_spec_options
from .kit.assembly import build_assembly
from .models import GenerateRequest
from .naming import base_name, config_hash
from .shellgeom import shell_assembly, shell_dims
from .partnumber import build_part_number, finish_for, is_complete, part_number_text

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

    # --- Merchandising, fail-closed (Phase 0.20 B) ---
    # These run for BOTH entry points because they live here rather than in the
    # route: /generate and /jobs both call validate_request, so the gate cannot
    # be one route wide.  Formats first — it is the cheapest check and the one
    # a probing caller is most likely to trip.
    check_formats_servable(list(req.formats))
    check_not_held(catalog, req.config)
    check_spec_options(catalog, req.config)

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
        # Phase 0.21: a wall build has no pole and no base, so those two
        # dimensions do not exist. Dropping the keys is what makes the sheet
        # honest — `_draw_dimensions` skips a missing key, and printing
        # "Pole Height 0'-0"" would read as a measurement rather than as
        # "not applicable".
        for key in ("pole_height_mm", "base_diameter_mm", "mounting_height_mm"):
            if not summary["dims"][key]:
                del summary["dims"][key]
    # Phase 0.17 (Tyler 8/20, "use the casting information"): when the config
    # has full shell coverage, every printed dimension is MEASURED off the real
    # castings instead of the parametric placeholders — the placeholder base
    # read 1'-3" where the cast base is 8.63". Falls back per-key, so a value
    # the shells cannot supply keeps the kit's number rather than vanishing.
    shells = shell_assembly(catalog, req.config)
    if shells is not None:
        measured = shell_dims(shells)
        if measured:
            summary["dims"] = {**summary.get("dims", {}), **measured}
            summary["dims_source"] = "castings"
    finish_map = {f["id"]: f for f in catalog.get("finishes", [])}
    finish_obj = finish_map.get(req.config.finish, {})
    summary["finish"] = (
        finish_obj.get("name", req.config.finish) if finish_obj else req.config.finish
    )
    summary["finish_ral"] = finish_obj.get("ral", "") if finish_obj else ""

    # Phase 0.21: name the assembly mode when it is not the default, so the
    # sheet says WHY there is no pole rather than just not listing one.
    # Mirrors ASSEMBLY_MODE_LABEL in src/lib/compat.ts.
    mode = assembly_mode(catalog, req.config)
    if mode != "pole":
        summary["mounting"] = _MODE_LABEL[mode]

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
            # Phase 0.11 (Z1): each component's own WiLL part number, resolved
            # from the same catalog data the browser uses (app/partnumber.py
            # mirrors buildPartNumber), so the sheet prints the number the
            # customer saw.  '' when the product has no published ordering
            # sheet — the sheet shows a dash, never a fabricated code.
            number = build_part_number(catalog, req.config, slot_field)
            # Phase 0.11 (A): every component carries its OWN finish.
            slot_finish_id = finish_for(req.config, slot_field)
            slot_finish = finish_map.get(slot_finish_id, {})
            slot_finish_name = slot_finish.get("name", slot_finish_id)
            ral_hex = (req.config.finishRal or {}).get(slot_field, "")
            if slot_finish_id == "custom-ral" and ral_hex:
                slot_finish_name = f"{slot_finish_name} ({ral_hex.upper()})"
            parts_list.append(
                {
                    "slot": slot_name,
                    "id": part_id,
                    "name": part_obj.get("name", part_id),
                    "productUrl": part_obj.get("productUrl", ""),
                    "partNumber": number or "",
                    "partNumberComplete": is_complete(number),
                    "finish": slot_finish_name,
                    "finishId": slot_finish_id,
                }
            )
    summary["parts"] = parts_list
    summary["part_numbers"] = [
        part_number_text(catalog, req.config, p["slot"]) for p in parts_list
    ]
    # True when the assembly is not all one colour — lets an adapter decide
    # whether a single assembly-wide "Finish" line would be misleading.
    summary["per_slot_finish"] = len({p["finishId"] for p in parts_list}) > 1

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
    #
    # Uses an em dash (—), matching banner.ts's bannerSummaryLine exactly at the
    # source-code level. _latin1() in app/adapters/_spec_template.py transliterates
    # it to a plain hyphen before it ever reaches fpdf2 (_LATIN1_MAP maps
    # "—" -> "-"), so the rendered PDF bytes are unchanged either way — this is
    # about not having two "mirror" strings disagree at the source, not a
    # customer-visible fix.
    banner = getattr(req.config, "banner", None)
    if banner is not None:
        banner_part = part_map.get(banner.armId)
        banner_name = banner_part.get("name", banner.armId) if banner_part else banner.armId
        sides = "opposite pair" if banner.count == 2 else f"{banner.count}-side"
        size = _banner_panel_size(catalog, banner.size)
        geom = _banner_geometry(banner_part, banner.heightFt, size) if banner_part else None
        if geom is None:
            h = banner.heightFt
            h_txt = str(int(h)) if float(h).is_integer() else str(h)
            summary["banner"] = f"{banner_name} — {sides} @ {h_txt} ft"
        else:
            panel_mm, top_mm, bottom_mm = geom
            # Wording mirrors bannerSummaryLine in src/lib/banner.ts exactly,
            # including the ordered-panel clause and the bottom-edge reference.
            panel_txt = f"{size['widthIn']} × {size['heightIn']} in panel, " if size else ""
            bottom_edge_mm = banner.heightFt * 304.8
            summary["banner"] = (
                f"{banner_name} — {sides}, {panel_txt}"
                f"banner height {round(panel_mm / 25.4)} in "
                f"(bottom of banner {_ft_in(bottom_edge_mm)}; "
                f"top bar {_ft_in(top_mm)} / bottom bar {_ft_in(bottom_mm)} above grade)"
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


_IN_PER_M = 1 / 0.0254


def _banner_panel_size(catalog: dict, size_id: str | None) -> dict | None:
    """Resolve a BannerConfig.size id to its panel dims (mirrors bannerPanelSize)."""
    sizes = catalog.get("bannerPanelSizes") or []
    if not sizes:
        return None
    for s in sizes:
        if s.get("id") == size_id:
            return s
    for s in sizes:
        if s.get("default"):
            return s
    return sizes[0]


def _banner_geometry(
    banner_part: dict, height_ft: float, size: dict | None = None
) -> tuple[float, float, float] | None:
    """(panel height, top-bar height, bottom-bar height) in mm, above grade.

    Mirrors ``bannerGeometry`` in src/lib/banner.ts.

    Phase 0.11 (Workstream D): ``height_ft`` is the BOTTOM EDGE of the banner,
    not its vertical centre.  That was a real defect, not a labelling nicety —
    a 24x48 banner at the 8 ft minimum used to hang to ~6 ft while the app
    called it compliant.  The panel is now the ORDERED size when one is given;
    what stays derived from the placeholder is the bar OVERHANG (how far each
    mounting bar sits beyond the panel edge), because that is bracket hardware
    geometry and inventing it would put an unbacked number in the quote.
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

    model_panel_h = height_of(panel)
    model_panel_y = center_y(panel)
    model_top = model_panel_y + model_panel_h / 2
    model_bottom = model_panel_y - model_panel_h / 2
    bar_ys = [center_y(c) for c in bars]
    # One bar (or none) modelled -> zero overhang, bar labels fall back to the
    # panel's own edges. Honest, not invented.
    top_overhang = max(0.0, max(bar_ys) - model_top) if bar_ys else 0.0
    bottom_overhang = max(0.0, model_bottom - min(bar_ys)) if bar_ys else 0.0

    panel_h = (size["heightIn"] / _IN_PER_M) if size else model_panel_h
    bottom_m = height_ft * 0.3048
    top_bar_m = bottom_m + panel_h + top_overhang
    bottom_bar_m = bottom_m - bottom_overhang
    return panel_h * 1000.0, top_bar_m * 1000.0, bottom_bar_m * 1000.0


# Arm-arrangement labels — mirror src/lib/summary.ts armArrangementLabel.
# Phase 0.10.5: arms mount on a 90-degree drilled tenon, so a triple is 3@90.
# How a non-default assembly mode is described in generated documents.
# Mirrors ASSEMBLY_MODE_LABEL in src/lib/compat.ts — the quote a salesperson
# reads and the sheet a specifier files must characterise the build the same
# way, so the two strings are kept identical.
_MODE_LABEL: dict[str, str] = {
    "pole": "Pole-mounted",
    "ground": "Ground-mounted (complete product - no bracket, pole or base cover)",
    "wall": "Wall-mounted (no pole or base cover)",
}

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
            render_anchors=req.renderAnchors,
            share_url=req.shareUrl,
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
                # A bare assert or an argless raise str()s to "", which shipped
                # `"dxf: "` as the only trace of a completely failed adapter
                # (found 0.18) — always name the exception type.
                warnings.append(f"{fmt}: {exc or type(exc).__name__}")

        warnings.extend(ctx.warnings)

    _emit("done", 100)
    return config_hash(req.config), files, warnings
