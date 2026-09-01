"""Artifact-cache schema guard (Phase 0.20, Workstream C).

`out/` is a write-only-growing directory of generated files. `_OUTPUT_VERSION`
lives inside `config_hash`, so bumping it changes every filename — a fresh
request can never be answered by a stale file. What it does NOT do is make the
stale files go away, or stop `/files/{filename}` from handing one back to
anybody who still holds its URL.

Two consequences, both real:

* **Disk.** 553 MB of orphans on the dev box at the time of writing; App
  Runner's filesystem is ephemeral, so there it is a slow leak inside one
  instance's lifetime rather than a permanent one, which is a difference of
  degree and not of kind on a 2 GB instance.
* **Correctness.** Every artifact generated before Phase 0.20 predates the
  merchandising gate. Among them are held-part downloads and mock `rfa` files
  that /generate now refuses — still sitting there, still served by name.

So the schema becomes VISIBLE in the filename rather than dissolved into an
opaque hash. `WiLL_v6_<hash>_<id8>` either carries the current version or it
does not, which is a question the read path and the purge can both answer.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

from .naming import _OUTPUT_VERSION

# Everything this service has ever written starts with this.  Used to keep the
# purge off files it did not create — out/ is a directory on somebody's
# machine, and a cleaner that treats every file as disposable is waiting for
# the day OUT_DIR is pointed somewhere real.
_OURS = re.compile(r"^WiLL_")

# The current schema: WiLL_v<version>_<8 hex config hash>_<configId prefix>
_CURRENT = re.compile(rf"^WiLL_v{_OUTPUT_VERSION}_[0-9a-f]{{8}}_")


def is_current_schema(filename: str) -> bool:
    """Whether this filename was produced by the CURRENT output schema.

    Fail-closed: anything unrecognised — a previous version, a pre-0.20 name
    with no version segment at all, a hand-dropped file — is not current.
    """
    return bool(_CURRENT.match(filename))


def is_ours(filename: str) -> bool:
    """Whether this service wrote the file (by naming convention)."""
    return bool(_OURS.match(filename))


def purge_stale_artifacts(out_dir: Path) -> int:
    """Delete every artifact of ours that a previous schema produced.

    Returns the number removed.  Idempotent by construction: a second call
    finds nothing left to do.  Errors on an individual file are swallowed —
    a locked or already-vanished file must not stop the service starting.
    """
    if not out_dir.is_dir():
        return 0
    removed = 0
    for path in sorted(out_dir.iterdir()):
        if not path.is_file():
            continue
        if not is_ours(path.name) or is_current_schema(path.name):
            continue
        try:
            path.unlink()
        except OSError:
            continue
        removed += 1
    return removed


# ---------------------------------------------------------------------------
# Age-based expiry (Phase 0.20, D-3)
# ---------------------------------------------------------------------------

_DEFAULT_TTL_HOURS = int(os.environ.get("ARTIFACT_TTL_HOURS", "24"))


def sweep_expired_artifacts(out_dir: Path, max_age_hours: int | None = None) -> int:
    """Delete our artifacts older than the TTL.  Returns the count removed.

    Separate from `purge_stale_artifacts`, and deliberately so: that one is
    about CORRECTNESS (a previous schema must never be served) and this one is
    about SPACE (a current-schema file nobody has asked for in a day).  They
    answer different questions and a config change should be able to relax one
    without touching the other.

    Same restraint as the purge: only names beginning WiLL_.  A cache cleaner
    that deletes by age alone is a data-loss bug waiting for the day somebody
    points OUT_DIR at a directory with other things in it.
    """
    if not out_dir.is_dir():
        return 0
    ttl = _DEFAULT_TTL_HOURS if max_age_hours is None else max_age_hours
    if ttl <= 0:
        return 0
    cutoff = time.time() - ttl * 3600
    removed = 0
    for path in sorted(out_dir.iterdir()):
        if not path.is_file() or not is_ours(path.name):
            continue
        try:
            if path.stat().st_mtime >= cutoff:
                continue
            path.unlink()
        except OSError:
            continue
        removed += 1
    return removed
