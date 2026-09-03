#!/usr/bin/env python3
"""Audit the repo's CAD references against Cole's Synology folder.

    python3 scripts/step-to-glb/audit_drive.py

Run this FIRST whenever Cole sends anything, and after any batch you ingest.

Why it exists
-------------
`ingest.py` never reads the drive: the local cache
`scripts/render-rig/real-assets/step/` is populated by hand, so renders keep
working from old local copies while the drive moves on underneath.  In Phase
0.21 that hid four stale references — including `WD-GVX-PM`, which Cole had
renamed to `GVX-PM.STEP` **six weeks earlier**, and `TEX.STEP`, the render
source for a launch-cut fixture, which had been retired outright.  Nobody had a
command that would have said so.

It reports four things, and each has a different fix:

  RENAMED/RETIRED  the repo names a file the drive no longer has.  SHA-compare
                   against the local cache before assuming a rename (the
                   CR1->CR2 precedent), then follow the name in ingest.py.
  REPLACED         same name on the drive, different bytes than the pin.  Cole
                   re-exported it in place (the TEX-AREA precedent) — the part
                   must be re-converted AND re-rendered or its shipped art
                   silently derives from bytes that no longer exist.
  UNREFERENCED     on the drive, nothing in the repo points at it.  Either a
                   new product or a new variant; classify it (skill section 1)
                   rather than ingesting it reflexively.
  CACHE STALE      the local cache disagrees with the drive, so the next
                   conversion would use the old bytes.

Exit status is 0 when the repo and the drive agree, 1 otherwise, so it can gate
a batch.  Hashing is skipped for files absent locally (nothing to compare) and
the drive read is the only slow part — a full audit is a couple of minutes over
the network mount.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

# The CloudStorage mount.  `~/SynologyDrive/...` also resolves but reads EMPTY,
# so a path built from it silently finds nothing (see ingest.py's docstring).
DRIVE = os.path.expanduser(
    "~/Library/CloudStorage/SynologyDrive-NickSynology206/Engineering/"
    "Marketing-Engineering/STEP-Website/WiLLstudio"
)
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(REPO, "scripts/render-rig/real-assets/step")
RECORD = os.path.join(REPO, "docs/real-geometry.json")

# Files on the drive that are deliberately not CAD inputs.
IGNORE = {".DS_Store"}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not os.path.isdir(DRIVE):
        print(f"drive not mounted: {DRIVE}", file=sys.stderr)
        print("(is Synology Drive running? this is the CloudStorage mount)", file=sys.stderr)
        return 2

    on_drive = {f for f in os.listdir(DRIVE) if f not in IGNORE and not f.startswith(".")}
    record = json.load(open(RECORD))

    referenced: dict[str, dict] = {}
    for section in ("components", "clusters", "unmapped", "shellSources", "derived"):
        for entry in record.get(section) or []:
            if isinstance(entry, dict) and entry.get("file"):
                referenced[entry["file"]] = {**entry, "_section": section}

    gone, replaced, cache_stale = [], [], []

    for name, entry in sorted(referenced.items()):
        drive_path = os.path.join(DRIVE, name)
        if name not in on_drive:
            gone.append((name, entry))
            continue
        pinned = entry.get("sha256")
        if not pinned:
            continue
        actual = sha256(drive_path)
        if actual != pinned:
            replaced.append((name, entry, actual))
        cache_path = os.path.join(CACHE, name)
        if os.path.isfile(cache_path) and sha256(cache_path) != actual:
            cache_stale.append(name)

    unreferenced = sorted(on_drive - set(referenced))

    print(f"drive:  {len(on_drive)} files   {DRIVE}")
    print(f"repo:   {len(referenced)} references   docs/real-geometry.json\n")

    def block(title: str, rows: list, fmt) -> None:
        print(f"=== {title} ({len(rows)}) ===")
        if not rows:
            print("  (none)")
        else:
            for row in rows:
                print("  " + fmt(row))
        print()

    block(
        "RENAMED OR RETIRED — repo names a file the drive no longer has",
        gone,
        lambda r: f"[{r[1]['_section']:13s}] {r[0]:34s} -> {r[1].get('partId')}",
    )
    block(
        "REPLACED IN PLACE — same name, different bytes than the pin",
        replaced,
        lambda r: f"[{r[1]['_section']:13s}] {r[0]:34s} pin {str(r[1].get('sha256'))[:12]} "
        f"-> drive {r[2][:12]}  ({r[1].get('partId')})",
    )
    block(
        "UNREFERENCED ON THE DRIVE — classify before ingesting",
        unreferenced,
        lambda f: f"{f:34s} {os.path.getsize(os.path.join(DRIVE, f)) / 1e6:8.1f} MB",
    )
    block(
        "LOCAL CACHE STALE — the next conversion would use old bytes",
        cache_stale,
        lambda f: f,
    )

    drifted = bool(gone or replaced or cache_stale)
    if drifted or unreferenced:
        print("repo and drive DISAGREE — see above.")
    else:
        print("repo and drive agree.")
    # Unreferenced files alone are informational: a new export is not a fault.
    return 1 if drifted else 0


if __name__ == "__main__":
    raise SystemExit(main())
