#!/usr/bin/env python3
"""Stage customer-cleared STEP files for the Docker image (Phase 0.19, A§2).

Copies every file named in geometry-service/assets/customer-step/manifest.json
from the gitignored dev cache (scripts/render-rig/real-assets/step/, or
$REAL_STEP_DIR) into geometry-service/assets/customer-step/, verifying each
copy against its SHA-256 pin.  Run it before `docker build` — the image COPYs
that directory, so an unstaged build ships an empty factory-cad/ (documented,
degraded, never wrong).

Fail-closed: a source file that is missing is SKIPPED with a warning (the
service degrades to empty-with-note); a source file that hashes DIFFERENTLY
from its pin is an ERROR and nothing is staged for it — that is the exact
full-master-under-a-reused-name accident the manifest exists to stop.

Stdlib only; run with any python3.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEST = REPO / "geometry-service" / "assets" / "customer-step"
MANIFEST = DEST / "manifest.json"
SOURCE = Path(os.environ.get("REAL_STEP_DIR", REPO / "scripts" / "render-rig" / "real-assets" / "step"))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    files: dict[str, dict] = json.loads(MANIFEST.read_text())["files"]
    staged, skipped, errors = [], [], []
    for name, pin in sorted(files.items()):
        src = SOURCE / name
        if not src.is_file():
            skipped.append(name)
            print(f"SKIP  {name}: not in {SOURCE} (deploy will degrade to empty-with-note)")
            continue
        digest = sha256(src)
        if digest != pin["sha256"]:
            errors.append(name)
            print(f"ERROR {name}: sha256 {digest[:12]}… does not match pin {pin['sha256'][:12]}… — NOT staged")
            continue
        dest = DEST / name
        if dest.is_file() and sha256(dest) == digest:
            print(f"OK    {name}: already staged")
        else:
            shutil.copy2(src, dest)
            print(f"STAGE {name}: {src.stat().st_size:,} bytes")
        staged.append(name)
    print(f"\n{len(staged)} staged, {len(skipped)} skipped, {len(errors)} hash errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
