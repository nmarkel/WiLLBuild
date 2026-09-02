#!/usr/bin/env python3
"""Stage customer-cleared STEP files for the Docker image (Phase 0.19, A§2).

Copies every file named in geometry-service/assets/customer-step/manifest.json
from the gitignored dev cache (scripts/render-rig/real-assets/step/, or
$REAL_STEP_DIR) into geometry-service/assets/customer-step/, hashing the
source before the copy AND the copy afterwards.  Run it before `docker build`
— the image COPYs that directory, so an unstaged build ships an empty
factory-cad/ (documented, degraded, never wrong).

Fail-closed: a source file that is missing is SKIPPED with a warning (the
service degrades to empty-with-note); a source file that hashes DIFFERENTLY
from its pin is an ERROR and nothing is staged for it — that is the exact
full-master-under-a-reused-name accident the manifest exists to stop.  A copy
that lands wrong (truncated, interrupted) is an ERROR too and the partial file
is removed, rather than being reported as staged and only failing at request
time.

Staging is not release.  A file whose pin says `cleared: false` is still
staged — the bytes are pinned and known-good — but app/realgeom.py will not
serve it until a human flips the flag, so this script prints the clearance
state per file rather than implying everything staged is downloadable.

DEST is pruned: any file in the staging directory that the manifest no longer
lists is removed, because `COPY geometry-service/assets` bakes the whole
directory into the image and a retired STEP would otherwise keep riding along
in raw form even though realgeom refuses to serve it.

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


def prune() -> list[str]:
    """Remove staged STEPs the manifest no longer lists.

    DEST is gitignored and the Dockerfile COPYs the whole assets tree, so a
    file retired from the manifest keeps shipping inside the image until
    something deletes it — even though realgeom will never serve it.
    """
    files: dict[str, dict] = json.loads(MANIFEST.read_text())["files"]
    removed = []
    for path in sorted(DEST.iterdir()):
        if path.name == "manifest.json" or not path.is_file():
            continue
        if path.name in files:
            continue
        path.unlink()
        removed.append(path.name)
        print(f"PRUNE {path.name}: not in manifest — removed from staging")
    return removed


def main() -> int:
    files: dict[str, dict] = json.loads(MANIFEST.read_text())["files"]
    staged, skipped, errors = [], [], []
    for name, pin in sorted(files.items()):
        released = pin.get("cleared") is True
        state = "released" if released else "NOT released (cleared=false)"
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
            print(f"OK    {name}: already staged [{state}]")
        else:
            shutil.copy2(src, dest)
            # Verify the COPY, not just the source. A truncated or interrupted
            # write otherwise reports STAGE and only surfaces as a hash
            # mismatch when a customer requests the bundle.
            landed = sha256(dest)
            if landed != digest:
                dest.unlink(missing_ok=True)
                errors.append(name)
                print(
                    f"ERROR {name}: copy landed as {landed[:12]}… not {digest[:12]}… "
                    f"— partial file removed, NOT staged"
                )
                continue
            print(f"STAGE {name}: {src.stat().st_size:,} bytes, copy verified [{state}]")
        staged.append(name)
    removed = prune()
    held = [n for n in staged if files[n].get("cleared") is not True]
    print(
        f"\n{len(staged)} staged, {len(skipped)} skipped, {len(errors)} hash errors, "
        f"{len(removed)} pruned"
    )
    if held:
        print(
            "NOTE  staged but NOT released (realgeom will not serve these until "
            "their manifest pin says cleared=true): " + ", ".join(sorted(held))
        )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
