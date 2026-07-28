"""In-memory async job layer + on-disk cache for the geometry-service.

Design
------
* Single-worker uvicorn → a process-local ``ThreadPoolExecutor(max_workers=1)``
  serialises generation (build123d/OCCT is not concurrency-friendly) while
  keeping the event loop free.
* ``JOBS`` is a process-local registry keyed by a unique jobId.
* Cache: generated artifacts land in ``out/`` named deterministically by
  ``base_name`` (which encodes the geometry config hash + configId prefix).
  Because the pipeline is deterministic, a repeat request for the same config
  finds its files already on disk and is served without re-running any adapter.

Nothing here imports a geometry engine — generation is delegated to
``app.generation`` which calls the adapters.  jobId is an in-memory identifier
only (never written into an artifact), so a monotonic counter is fine and does
not violate the "no wall clock in generated artifacts" rule.
"""

from __future__ import annotations

import hashlib
import itertools
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .adapters import REGISTRY, DWG_WARNING
from .generation import FORMAT_SUFFIX, generate_files
from .models import GenerateRequest
from .naming import base_name, config_hash

# ---------------------------------------------------------------------------
# Registry + worker pool (process-local)
# ---------------------------------------------------------------------------
_LOCK = threading.Lock()
_COUNTER = itertools.count(1)
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="geom-job")

JOBS: dict[str, "JobRecord"] = {}


@dataclass
class JobRecord:
    jobId: str
    configHash: str
    formats: list[str]
    req: GenerateRequest
    out_dir: Path
    status: str = "pending"  # pending | running | done | error
    progress: int = 0
    stage: str = "queued"
    files: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None
    cached: bool = False

    def public(self) -> dict:
        """Return the GET /jobs/{id} response shape."""
        return {
            "jobId": self.jobId,
            "status": self.status,
            "progress": self.progress,
            "stage": self.stage,
            "files": self.files if self.status == "done" else [],
            "warnings": self.warnings,
            "error": self.error,
        }


def _job_id(cfg_hash: str, formats: list[str]) -> str:
    """Deterministic-friendly, unique job id: hash of config+formats + counter."""
    token = hashlib.sha256(
        (cfg_hash + "|" + ",".join(sorted(formats))).encode()
    ).hexdigest()[:6]
    return f"{cfg_hash}-{token}-{next(_COUNTER)}"


def _runnable_formats(formats: list[str]) -> list[str]:
    """Formats that have a registered adapter (dwg without ODA is dropped)."""
    return [f for f in formats if f in REGISTRY]


def _cache_lookup(req: GenerateRequest, out_dir: Path) -> list[dict] | None:
    """Return cached file entries if EVERY runnable requested format already
    exists on disk for this config, else None.

    Cache identity is the deterministic ``base_name`` (geometry config hash +
    configId prefix): identical config → identical filenames → cache hit,
    served without invoking any adapter.
    """
    runnable = _runnable_formats(req.formats)
    if not runnable:
        return None
    bn = base_name({}, req.config)
    entries: list[dict] = []
    for fmt in runnable:
        suffix = FORMAT_SUFFIX.get(fmt)
        if suffix is None:
            return None
        path = out_dir / f"{bn}{suffix}"
        if not path.exists():
            return None
        entries.append(
            {
                "format": fmt,
                "filename": path.name,
                "url": f"/files/{path.name}",
                "sizeBytes": path.stat().st_size,
            }
        )
    return entries


def _cache_warnings(req: GenerateRequest) -> list[str]:
    """Deterministic warnings that must survive a cache hit (dwg demotion)."""
    warns: list[str] = []
    if DWG_WARNING and any(f == "dwg" and f not in REGISTRY for f in req.formats):
        warns.append(DWG_WARNING)
    return warns


def _run_job(job_id: str) -> None:
    """Worker body — runs on the executor thread."""
    with _LOCK:
        rec = JOBS.get(job_id)
        if rec is None:
            return
        rec.status = "running"
        rec.stage = "starting"
        req, out_dir = rec.req, rec.out_dir

    def _progress(stage: str, pct: int) -> None:
        with _LOCK:
            r = JOBS.get(job_id)
            if r is not None:
                r.stage = stage
                r.progress = pct

    try:
        _cfg_hash, files, warnings = generate_files(req, out_dir, _progress)
        with _LOCK:
            r = JOBS.get(job_id)
            if r is not None:
                r.files = files
                r.warnings = warnings
                r.status = "done"
                r.progress = 100
                r.stage = "done"
    except Exception as exc:  # noqa: BLE001
        with _LOCK:
            r = JOBS.get(job_id)
            if r is not None:
                r.status = "error"
                r.error = str(exc)
                r.stage = "error"


def submit_job(req: GenerateRequest, out_dir: Path) -> JobRecord:
    """Create a job for this request.

    Assumes ``validate_request(req)`` has already passed.  If every runnable
    requested format is already cached on disk, returns a completed record
    (status='done', cached=True) without scheduling any work.  Otherwise
    registers a pending record and schedules background generation.
    """
    cfg_hash = config_hash(req.config)
    job_id = _job_id(cfg_hash, req.formats)

    cached = _cache_lookup(req, out_dir)
    rec = JobRecord(
        jobId=job_id,
        configHash=cfg_hash,
        formats=list(req.formats),
        req=req,
        out_dir=out_dir,
    )

    if cached is not None:
        rec.status = "done"
        rec.progress = 100
        rec.stage = "cached"
        rec.files = cached
        rec.warnings = _cache_warnings(req)
        rec.cached = True
        with _LOCK:
            JOBS[job_id] = rec
        return rec

    with _LOCK:
        JOBS[job_id] = rec
    _EXECUTOR.submit(_run_job, job_id)
    return rec


def get_job(job_id: str) -> JobRecord | None:
    with _LOCK:
        return JOBS.get(job_id)
