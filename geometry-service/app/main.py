"""FastAPI geometry-service — skeleton with config validation and file serving."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .catalog import load_catalog, validate_config
from .models import GenerateRequest, GenerateResponse
from .naming import config_hash

# ---------------------------------------------------------------------------
# Output directory — created at startup
# ---------------------------------------------------------------------------
OUT_DIR = Path(__file__).parent.parent / "out"
OUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Adapter registry (empty for this skeleton — tasks 2+ will populate it)
# ---------------------------------------------------------------------------
# Maps format string → callable(catalog, cfg, out_dir) -> Path
_ADAPTERS: dict[str, object] = {}


def register_adapter(fmt: str, fn: object) -> None:
    """Register a geometry adapter for a given format string."""
    _ADAPTERS[fmt] = fn


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
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """Return service status and which format adapters are registered."""
    return {
        "status": "ok",
        "adapters": {fmt: True for fmt in _ADAPTERS},
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

    # --- Dispatch to adapters ---
    files = []
    warnings: list[str] = []

    for fmt in req.formats:
        adapter = _ADAPTERS.get(fmt)
        if adapter is None:
            raise HTTPException(
                status_code=422,
                detail=f"No adapter registered for format: {fmt!r}",
            )
        # Adapter callable: fn(catalog, cfg, out_dir, render_png) -> Path
        try:
            out_path: Path = adapter(  # type: ignore[operator]
                catalog, req.config, OUT_DIR, req.renderPng
            )
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
