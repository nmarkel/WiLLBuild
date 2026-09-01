"""FastAPI geometry-service — config validation, adapter dispatch, file serving."""

from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .adapters import REGISTRY
from . import ratelimit
from .artifacts import (
    is_current_schema,
    purge_stale_artifacts,
    sweep_expired_artifacts,
)
from . import leadstore
from .leads import CONTACT_FALLBACK, LeadInvalid, build_payload, log_capture
from .merchandising import SERVABLE_FORMATS
from .generation import generate_files, validate_request
from .jobs import get_job, submit_job
from .models import (
    GenerateRequest,
    GenerateResponse,
    JobStatusResponse,
    JobSubmitResponse,
    LeadRequest,
    LeadResponse,
)

# ---------------------------------------------------------------------------
# Output directory — created at startup
# ---------------------------------------------------------------------------
OUT_DIR = Path(__file__).parent.parent / "out"
OUT_DIR.mkdir(exist_ok=True)

logger = logging.getLogger(__name__)

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
@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Sweep artifacts produced by a previous output schema (Phase 0.20 C).

    App Runner's filesystem is ephemeral, so on the deployed instance this is
    usually a no-op — the point is the case where it is NOT: a dev box, a
    container reused across a redeploy, or any future move to a persistent
    volume or S3 artifact store. Running it at startup means the invariant
    "everything in out/ is current" holds from the first request, rather than
    depending on somebody remembering to clean up after a version bump.

    Never fatal: a service that refuses to boot because one file was locked is
    a worse outcome than one that starts alongside stale bytes it will refuse
    to serve anyway.
    """
    try:
        removed = purge_stale_artifacts(OUT_DIR)
        if removed:
            logger.info("purged %d artifact(s) from a previous output schema", removed)
        expired = sweep_expired_artifacts(OUT_DIR)
        if expired:
            logger.info("swept %d artifact(s) past the age limit", expired)
    except Exception as exc:  # noqa: BLE001
        logger.warning("artifact purge skipped: %s", exc)
    yield


app = FastAPI(title="WiLL Geometry Service", version="0.3.0", lifespan=_lifespan)

# Phase 0.20 (D-2): cap request bodies before anything buffers or parses them.
# `renderPng` accepts base64, which is the open door — the one field with no
# natural size and fully caller-controlled.
MAX_REQUEST_BYTES = int(os.environ.get("MAX_REQUEST_BYTES", str(8 * 1024 * 1024)))


@app.middleware("http")
async def _limit_and_meter(request: Request, call_next):
    """Payload cap + per-IP rate limit, in that order.

    Both run before routing so a refusal costs nothing but a header read.

    NOTE: CORS is NOT access control. `ALLOWED_ORIGINS` asks a browser to
    withhold a response it already fetched; it does nothing to curl. This
    middleware and app.merchandising are the actual gates.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": f"Request body exceeds {MAX_REQUEST_BYTES} bytes"},
        )

    client_ip = request.client.host if request.client else "unknown"
    retry_after = ratelimit.check(client_ip, request.url.path)
    if retry_after is not None:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests; please slow down."},
            headers={"Retry-After": str(int(retry_after))},
        )
    return await call_next(request)


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
    """Return service status and which formats are actually servable.

    Phase 0.20 (B): this reports the intersection of "an adapter is registered"
    and "the product offers it", not the raw registry.  /health is the contract
    a direct caller reads, so advertising a format that /generate refuses would
    only move the dishonesty from the artifact to the handshake — and `rfa` in
    particular used to announce itself here as a Revit family that will not
    open in Revit.
    """
    return {
        "status": "ok",
        "adapters": {fmt: True for fmt in REGISTRY if fmt in SERVABLE_FORMATS},
        # Phase 0.20 (A): so an operator learns the lead store is off from a
        # health check rather than from a lead that failed to land.
        "leadCapture": "ready" if leadstore.is_configured() else "unconfigured",
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


@app.post("/leads", response_model=LeadResponse)
def capture_lead(req: LeadRequest) -> LeadResponse:
    """Capture a download-gate submission durably (Phase 0.20, Workstream A).

    Before this endpoint the gate wrote to the visitor's own localStorage while
    the wording implied a submission — nobody at WiLL could retrieve a lead.
    The contract here is therefore blunt: **a 200 means the lead is durable.**

    * 503 — no store configured (the bucket is an authenticated Nick/Tyler
      step). The visitor is told to email quotes@ instead.
    * 502 — a store is configured and the write did not land.

    Neither is dressed up as success. Notification is best-effort and reported
    separately, because the lead is already safe by the time it is attempted.
    """
    try:
        payload = build_payload(
            name=req.name,
            email=req.email,
            company=req.company,
            config_id=req.configId,
            part_numbers=req.partNumbers,
            share_url=req.shareUrl,
            deliverable=req.deliverable,
            consent=req.consent,
        )
    except LeadInvalid as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        _key, deduped = leadstore.store_lead(payload)
    except leadstore.LeadStoreUnconfigured:
        log_capture("refused-unconfigured", config_id=req.configId, email=req.email)
        raise HTTPException(
            status_code=503,
            detail=(
                "Lead capture is not configured on this deployment, so this form "
                f"cannot record your details. Please email {CONTACT_FALLBACK} with "
                "your configuration and we will follow up."
            ),
        ) from None
    except leadstore.LeadStoreFailed as exc:
        # The reason is operator-facing and carries no PII; the visitor gets a
        # route to a human rather than a stack trace.
        log_capture("failed", config_id=req.configId, email=req.email, extra=f"reason={exc}")
        raise HTTPException(
            status_code=502,
            detail=(
                "We could not record your details just now. Please email "
                f"{CONTACT_FALLBACK} with your configuration and we will follow up."
            ),
        ) from exc

    notified = leadstore.notify(payload) if not deduped else False
    log_capture(
        "stored", config_id=req.configId, email=req.email,
        extra=f"deduped={deduped} notified={notified}",
    )
    return LeadResponse(stored=True, deduped=deduped, notified=notified)


@app.get("/files/{filename}")
def serve_file(filename: str) -> FileResponse:
    """Serve a generated file from the out/ directory.

    Rejects path traversal attempts (any filename containing / or ..).
    """
    # Reject path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Phase 0.20 (C): refuse any artifact a PREVIOUS output schema produced,
    # whether or not it is still sitting in out/.  Filenames are the only
    # credential this route has ever asked for, and everything generated before
    # 0.20 predates the merchandising gate — held-part downloads and mock rfa
    # files among them.  410 rather than 404: the file may well be there, it is
    # simply no longer something this service will serve.
    if not is_current_schema(filename):
        raise HTTPException(
            status_code=410,
            detail="This artifact was produced by an older output schema; "
                   "regenerate it from the current configuration.",
        )

    file_path = OUT_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)
