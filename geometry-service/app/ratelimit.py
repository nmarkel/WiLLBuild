"""Per-IP rate limiting (Phase 0.20, Workstream D-4).

In-process and per-instance, which is exactly right at this scale and would be
exactly wrong at any other: App Runner max-instances is pinned to 1 (see
docs/DEPLOY.md — scaling orphans in-flight jobs held in a process-local dict),
so "per instance" and "per service" are currently the same statement. If that
pin is ever lifted, this becomes a per-instance limit N times looser than it
reads, and it should move to a shared store alongside the job registry.

**CORS is not access control.** `ALLOWED_ORIGINS` asks a *browser* to withhold
a response it has already fetched. It does nothing to curl, to a script, or to
anything that is not a browser honouring the protocol. It is a UX guard for
first-party pages, and it has never protected a single endpoint here — this
module and app.merchandising are what do.

A fixed window rather than a token bucket: at these limits the difference is
theoretical, and a dict of deques is something the next person can read in one
sitting.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

_WINDOW_SECONDS = 60.0

# Generous by design. Generation is measured in seconds, so a human cannot
# approach these; they exist to bound a runaway script or a scraper, not to
# meter real use.
_DEFAULT_LIMIT = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "120"))

# Tighter for the one endpoint that writes to durable storage on request.
_LEAD_LIMIT = int(os.environ.get("LEAD_RATE_LIMIT_PER_MINUTE", "20"))

_LOCK = threading.Lock()
_HITS: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def limit_for(path: str) -> int:
    """Requests per minute allowed on this path."""
    if path.startswith("/leads"):
        return _LEAD_LIMIT
    return _DEFAULT_LIMIT


def _bucket_for(path: str) -> str:
    """Leads get their own counter so a download burst cannot exhaust the
    lower lead allowance (or the reverse)."""
    return "leads" if path.startswith("/leads") else "default"


def check(client_ip: str, path: str, now: float | None = None) -> float | None:
    """Record a hit. Returns None when allowed, else seconds until retry."""
    limit = limit_for(path)
    if limit <= 0:  # 0 disables the limiter entirely
        return None
    stamp = now if now is not None else time.monotonic()
    key = (client_ip, _bucket_for(path))
    with _LOCK:
        hits = _HITS[key]
        cutoff = stamp - _WINDOW_SECONDS
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return max(1.0, _WINDOW_SECONDS - (stamp - hits[0]))
        hits.append(stamp)
    return None


def reset() -> None:
    """Drop all counters. For tests, and for an operator in a REPL."""
    with _LOCK:
        _HITS.clear()
