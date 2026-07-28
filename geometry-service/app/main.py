"""FastAPI geometry-service — config validation, adapter dispatch, file serving."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .adapters import REGISTRY
from .generation import generate_files, validate_request
from .jobs import get_job, submit_job
from .models import (
    GenerateRequest,
    GenerateResponse,
    JobStatusResponse,
    JobSubmitResponse,
)

# ---------------------------------------------------------------------------
# Output directory — created at startup
# ---------------------------------------------------------------------------
OUT_DIR = Path(__file__).parent.parent / "out"
OUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# CORS helpers
# ---------------------------------------------------------------------------
_LOCALHOST_DEFAULTS = ["http://localhost:5173", "http://localhost:5174"]


def _allowed_origins(env_value: str | None) -> list[str]:
    """Return the CORS allowed-origins list.

    Merges ALLOWED_ORIGINS (comma-separated env var) with the localhost
    development defaults.  Always de-duplicated; empty entries stripped.
    When env_value is None or blank the localhost defaults are returned as-is.
    """
    seen: dict[str, None] = {o: None for o in _LOCALHOST_DEFAULTS}
    if env_value:
        for raw in env_value.split(","):
            origin = raw.strip()
            if origin:
                seen[origin] = None
    return list(seen.keys())


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="WiLL Geometry Service", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(os.environ.get("ALLOWED_ORIGINS")),
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
    """Validate config, dispatch to format adapters, return file list.

    Synchronous path (unchanged contract).  Validation and generation are
    delegated to app.generation so the async /jobs layer runs identical logic.
    """
    try:
        validate_request(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    config_hash_val, files, warnings = generate_files(req, OUT_DIR)
    return GenerateResponse(
        configHash=config_hash_val,
        files=files,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Async job layer (additive — /generate above is unchanged)
# ---------------------------------------------------------------------------


@app.post("/jobs", response_model=JobSubmitResponse)
def create_job(req: GenerateRequest) -> JobSubmitResponse:
    """Submit an async generation job.

    Validates the config exactly like /generate (422 with string detail on
    invalid).  If every requested format is already cached on disk for this
    config, returns immediately with status='done', cached=true.  Otherwise
    schedules background generation and returns status='pending'.
    """
    try:
        validate_request(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    rec = submit_job(req, OUT_DIR)
    return JobSubmitResponse(
        jobId=rec.jobId,
        configHash=rec.configHash,
        status="done" if rec.status == "done" else "pending",
        cached=rec.cached,
    )


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    """Return the status/progress/files for a submitted job (404 if unknown)."""
    rec = get_job(job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Unknown jobId")
    return JobStatusResponse(**rec.public())


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
