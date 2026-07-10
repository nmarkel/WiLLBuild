"""FastAPI geometry-service — config validation, adapter dispatch, file serving."""

from __future__ import annotations

import base64
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .adapters import REGISTRY, DWG_WARNING
from .adapters.base import GenContext
from .catalog import load_catalog, validate_config, is_standalone_config
from .kit.assembly import build_assembly
from .models import GenerateRequest, GenerateResponse
from .naming import base_name, config_hash

# ---------------------------------------------------------------------------
# Output directory — created at startup
# ---------------------------------------------------------------------------
OUT_DIR = Path(__file__).parent.parent / "out"
OUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Geometric formats — when any of these are requested, build assembly once
# ---------------------------------------------------------------------------
# "pdf" is included so that AssemblyDims are computed and available in
# ctx.summary for the dimensions block of the spec-sheet.
_GEOMETRIC_FORMATS = {"step", "ifc", "dxf", "dwg", "pdf", "bundle"}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="WiLL Geometry Service", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def _validation_shape(request, exc):
    """Convert RequestValidationError to 422 with string detail field."""
    msg = "; ".join(
        f"{'.'.join(str(l) for l in e['loc'])}: {e['msg']}"
        for e in exc.errors()
    )
    return JSONResponse(status_code=422, content={"detail": msg})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """Return service status and which format adapters are registered."""
    return {
        "status": "ok",
        "adapters": {fmt: True for fmt in REGISTRY},
    }


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    """Validate config, dispatch to format adapters, return file list."""
    catalog = load_catalog()

    # --- Validate config ---
    try:
        validate_config(catalog, req.config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # --- Standalone config: only 'pdf' format is permitted ---
    _is_standalone = is_standalone_config(req.config)
    if _is_standalone:
        non_pdf = [f for f in req.formats if f != "pdf"]
        if non_pdf:
            raise HTTPException(
                status_code=422,
                detail=(
                    "only spec sheets are available for standalone products; "
                    f"unsupported formats: {non_pdf}"
                ),
            )

    # --- Guard: all requested formats must have a registered adapter ---
    # Exception: "dwg" without ODA is demoted to a warning (not a 422 error)
    # so the caller still gets the DXF output.
    _dwg_skipped = False
    for fmt in req.formats:
        if fmt not in REGISTRY:
            if fmt == "dwg" and DWG_WARNING:
                _dwg_skipped = True
            else:
                raise HTTPException(
                    status_code=422,
                    detail=f"No adapter registered for format: {fmt!r}",
                )

    # --- Build assembly once if any geometric format is requested ---
    # Standalone configs have no assembly (no pole/arm/baseCover).
    needs_geometry = not _is_standalone and any(fmt in _GEOMETRIC_FORMATS for fmt in req.formats)
    assembly = build_assembly(catalog, req.config) if needs_geometry else None

    # --- Build summary (part names from catalog, finish, dims) ---
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
    summary["finish"] = finish_obj.get("name", req.config.finish) if finish_obj else req.config.finish
    summary["finish_ral"] = finish_obj.get("ral", "") if finish_obj else ""

    # --- Add parts with names, slot, and productUrl for downstream adapters ---
    # For standalone configs, only the fixture slot is populated; skip empty slots.
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
            continue  # standalone: arm/pole/baseCover are ''
        part_obj = part_map.get(part_id)
        if part_obj:
            parts_list.append({
                "slot": slot_name,
                "id": part_id,
                "name": part_obj.get("name", part_id),
                "productUrl": part_obj.get("productUrl", ""),
            })
    summary["parts"] = parts_list

    # --- Decode renderPng from base64 (handle data: URI prefix and errors) ---
    render_png_bytes: bytes | None = None
    render_png_warning: str | None = None
    if req.renderPng:
        try:
            # Strip data:image/png;base64, prefix if present
            png_data = req.renderPng
            if "," in png_data:
                png_data = png_data.split(",", 1)[1]
            render_png_bytes = base64.b64decode(png_data)
        except Exception as exc:
            render_png_warning = f"renderPng ignored: invalid base64 ({exc})"

    # --- Build shared context ---
    ctx = GenContext(
        catalog=catalog,
        cfg=req.config,
        out_dir=OUT_DIR,
        base_name=base_name(catalog, req.config),
        assembly=assembly,
        render_png=render_png_bytes,
        summary=summary,
    )

    # --- Dispatch ---
    files = []
    warnings: list[str] = []
    if render_png_warning:
        warnings.append(render_png_warning)
    if _dwg_skipped and DWG_WARNING:
        warnings.append(DWG_WARNING)

    for fmt in req.formats:
        if fmt not in REGISTRY:
            # Already handled above (e.g. dwg without ODA → warning, skip)
            continue
        adapter = REGISTRY[fmt]
        try:
            out_paths = adapter.generate(ctx)
            # Track which files were produced in THIS request so bundle_adapter
            # can tell them apart from stale on-disk artifacts.
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

    return GenerateResponse(
        configHash=config_hash(req.config),
        files=files,
        warnings=warnings,
    )


@app.get("/files/{filename}")
def serve_file(filename: str) -> FileResponse:
    """Serve a generated file from the out/ directory.

    Rejects path traversal attempts (any filename containing / or ..).
    """
    # Reject path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = OUT_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)
