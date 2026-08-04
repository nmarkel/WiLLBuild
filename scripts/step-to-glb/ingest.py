"""Ingest the real WiLLstudio STEP files into render-rig GLBs (offline).

Phase 0.10 ingest.  Source: Engineering's STEP-Website drop
(``/Volumes/WiLLdrive/Engineering/Marketing-Engineering/STEP-Website/WiLLstudio``),
copied into ``scripts/render-rig/real-assets/step/`` — gitignored, like every
real-CAD input since the 0.6 spike.  The *outputs* that ship are the ~4 KB WebP
layers the render rig bakes from these GLBs; the GLBs themselves stay offline
(see docs/superpowers/plans/real-geometry-rig-results.md).

The filenames ARE ordering codes (``SS3-40F.STEP`` = Side Shepherds Hook, 3 arms,
4" flush pole fit), so this module is also the provenance record that maps real
geometry to catalog parts and part numbers — see ``INGEST`` below and
``docs/real-geometry.json``.

Run with the geometry-service venv python (has OCP + numpy):

    cd scripts/step-to-glb
    ../../geometry-service/.venv/bin/python ingest.py              # everything affordable
    ../../geometry-service/.venv/bin/python ingest.py SS1-40F.STEP # one file
    ../../geometry-service/.venv/bin/python ingest.py --fixtures   # the slow ones

Cost note (measured 2026-08-04): OCCT parses the small/medium parts in <0.5 s but
the 22-87 MB fixture masters take ~8 MINUTES each.  That is why fixtures are a
separate opt-in batch here, and why the geometry-service never parses a raw STEP
at request time (it reads a pre-baked BREP — see app/realgeom.py).
"""
from __future__ import annotations

import json
import os
import sys
import time

from convert import convert_color_aware, convert_monolithic

STEP_DIR = os.path.join(os.path.dirname(__file__), "..", "render-rig", "real-assets", "step")
GLB_DIR = os.path.join(os.path.dirname(__file__), "..", "render-rig", "real-assets", "glb")

# ---------------------------------------------------------------------------
# The mapping: real STEP file -> catalog part + ordering codes.
#
# `origin` follows the catalog convention "origin at the part's lower attachment
# point": 'base' floors Y and centres X/Z, 'top' ceilings Y, 'mount' trusts the
# CAD's native X/Z (pole-axis) and only floors Y, 'mount-center' trusts X/Z and
# centres Y (a mid-shaft accessory whose origin is its vertical centre).
# `mode` picks the converter: 'color' keeps STEP-authored colours on non-paintable
# solids and leaves only `will-body` for the finish; 'mono' is one uniform body.
# `slow` marks the masters whose OCCT parse takes minutes.
# ---------------------------------------------------------------------------
INGEST: list[dict] = [
    # --- pole ---
    dict(file="RSAA-4040-12.STEP", part="alum-pole-12", design="RSAA-4040-12", fit="40",
         origin="base", mode="mono", tol=0.5),
    # --- arms (single-arm files are the per-azimuth render source; the 2/3/4-arm
    #     files are whole clusters, used for the CAD downloads, not the layers) ---
    dict(file="SH1-40F.STEP", part="sh1-shepherds-hook", design="SH1", fit="40F",
         origin="mount", mode="mono", tol=0.5),
    dict(file="SS1-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS1", fit="40F", origin="mount", mode="mono", tol=0.5),
    dict(file="AR1-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR1", fit="40F", origin="mount", mode="mono", tol=0.5),
    # --- base covers (CL1/CL2/CL3 are three cover designs; see docs/real-geometry.json
    #     for how each was matched to a catalog cover) ---
    dict(file="CL1-4R.STEP", part="bc-round", design="CL1", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="CL2-4R.STEP", part="aluminum-light-pole-base-covers", design="CL2", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="CL3-4R.STEP", part="bc-fluted", design="CL3", fit="4R",
         origin="base", mode="mono", tol=0.5),
    # --- banner arm (mid-shaft: origin is the banner's vertical centre) ---
    dict(file="BA24-4R.STEP", part="willstudio-ba1-banner-arm", design="BA24", fit="4R",
         origin="mount-center", mode="mono", tol=0.75),
    # --- fixtures: masters with full internal detail; minutes to parse ---
    dict(file="WD-GVX-PM", part="gvx-pendant", design="GVX", fit="PM",
         origin="top", mode="color", tol=1.0, slow=True),
    dict(file="DRX-Post-Top.STEP", part="drx-post-top", design="DRX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    dict(file="TEX.STEP", part="tex-post-top", design="TEX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    dict(file="MXV.STEP", part="mvx-coach", design="MVX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    # --- standalone products (single hero render, no assembly) ---
    # The bollard + flood masters are modelled Z-UP (verified from their raw bboxes),
    # unlike every other file here, so they are stood up before re-basing.
    dict(file="RXB.STEP", part="willstudio-rxb-sxb-bollard", design="RXB", fit="C",
         origin="base", mode="color", tol=1.5, slow=True, rotateX=90),
    dict(file="DWX.STEP", part="willstudio-dwx-flood-spot", design="DWX", fit="C",
         origin="base", mode="color", tol=1.5, slow=True, rotateX=-90),
]

# Cluster/variant files that carry real CAD for a *configured design code* but are
# not a per-part render source (the rig renders one arm and repeats it radially).
CLUSTERS: list[dict] = [
    dict(file="SS2-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS2", fit="40F", armCount=2),
    dict(file="SS3-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS3", fit="40F", armCount=3),
    dict(file="SS4-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS4", fit="40F", armCount=4),
    dict(file="AR2-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR2", fit="40F", armCount=2),
    dict(file="AR3-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR3", fit="40F", armCount=3),
    dict(file="AR4-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR4", fit="40F", armCount=4),
    dict(file="DRX-Area-4R-Side-Mount.STEP", part="drx-post-top", design="DRX",
         fit="SMR", note="Area/side-mount variant of the DRX (mounting code SMR)."),
    dict(file="SXB.STEP", part="willstudio-rxb-sxb-bollard", design="SXB", fit="C",
         note="Second bollard variant sharing the RXB/SXB catalog entry."),
]

# Files with no confirmed catalog mapping — recorded, never guessed.
UNMAPPED: list[dict] = [
    dict(file="FH-4R.STEP", note="Code 'FH' is not on the supplied ordering matrix - confirm with Tyler/Cole."),
    dict(file="PH-4R.STEP", note="Code 'PH' is not on the supplied ordering matrix - confirm with Tyler/Cole."),
    dict(file="SC1-4R.STEP", note="Code 'SC1' unconfirmed; possibly a centre-hook feature (CF1/CF2 family)."),
    dict(file="SC2-4R.STEP", note="Code 'SC2' unconfirmed; possibly a centre-hook feature (CF1/CF2 family)."),
]


def convert_one(entry: dict) -> dict:
    step_path = os.path.join(STEP_DIR, entry["file"])
    out_path = os.path.join(GLB_DIR, f"{entry['part']}.glb")
    os.makedirs(GLB_DIR, exist_ok=True)
    t0 = time.time()
    rot = dict(rotate_x=entry.get("rotateX", 0.0), rotate_z=entry.get("rotateZ", 0.0))
    if entry["mode"] == "color":
        stats = convert_color_aware(step_path, out_path, origin=entry["origin"],
                                    tol_mm=entry["tol"], **rot)
    else:
        stats = convert_monolithic(step_path, out_path, origin=entry["origin"],
                                   tol_mm=entry["tol"], **rot)
    stats["seconds"] = round(time.time() - t0, 1)
    stats["glb_bytes"] = os.path.getsize(out_path)
    stats["glb"] = os.path.relpath(out_path, os.path.join(os.path.dirname(__file__), "..", "render-rig"))
    return stats


def _sha256(path: str) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "real-geometry.json")


def write_manifest() -> str:
    """Write docs/real-geometry.json — the tracked provenance record.

    The STEP/GLB binaries are gitignored, so this file IS the repo's memory of what
    real CAD exists, where it came from, which catalog part and part-number code it
    maps to, and what is still unmapped.  Sizes/hashes are read from the local
    ingest directory; entries whose file is absent are still listed (with
    ``present: false``) so the record survives a machine without the drive.
    """
    def describe(entry: dict, kind: str) -> dict:
        step_path = os.path.join(STEP_DIR, entry["file"])
        present = os.path.isfile(step_path)
        glb_path = os.path.join(GLB_DIR, f"{entry.get('part', '')}.glb")
        out = {
            "file": entry["file"],
            "kind": kind,
            "present": present,
            "bytes": os.path.getsize(step_path) if present else None,
            "sha256": _sha256(step_path) if present else None,
            "partId": entry.get("part"),
            "designCode": entry.get("design"),
            "fitCode": entry.get("fit"),
        }
        if "armCount" in entry:
            out["armCount"] = entry["armCount"]
        if kind == "component":
            out["origin"] = entry.get("origin")
            out["converter"] = entry.get("mode")
            out["tolMm"] = entry.get("tol")
            if entry.get("rotateX"):
                out["rotateXDeg"] = entry["rotateX"]
            out["glb"] = (
                os.path.relpath(glb_path, os.path.join(os.path.dirname(__file__), ".."))
                if os.path.isfile(glb_path)
                else None
            )
            out["glbBytes"] = os.path.getsize(glb_path) if os.path.isfile(glb_path) else None
        if entry.get("note"):
            out["note"] = entry["note"]
        return out

    manifest = {
        "source": "/Volumes/WiLLdrive/Engineering/Marketing-Engineering/STEP-Website/WiLLstudio",
        "ingestedBy": "scripts/step-to-glb/ingest.py",
        "localStepDir": "scripts/render-rig/real-assets/step (gitignored)",
        "localGlbDir": "scripts/render-rig/real-assets/glb (gitignored)",
        "note": (
            "Filenames are WiLL ordering codes. 'component' files are the render-rig + "
            "geometry-service geometry source for one part; 'cluster' files are whole "
            "multi-arm assemblies shipped as-is in the download bundle; 'unmapped' files "
            "have no confirmed catalog part yet and are never guessed at."
        ),
        "components": [describe(e, "component") for e in INGEST],
        "clusters": [describe(e, "cluster") for e in CLUSTERS],
        "unmapped": [describe(e, "unmapped") for e in UNMAPPED],
    }
    path = os.path.abspath(MANIFEST_PATH)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    return path


def main(argv: list[str]) -> int:
    only = [a for a in argv if not a.startswith("--")]
    include_slow = "--fixtures" in argv or "--all" in argv
    fast_only = not include_slow and not only

    if "--manifest" in argv:
        print(f"wrote {write_manifest()}")
        return 0

    results = {}
    for entry in INGEST:
        if only and entry["file"] not in only:
            continue
        if fast_only and entry.get("slow"):
            print(f"skip (slow master, pass --fixtures): {entry['file']}")
            continue
        print(f"converting {entry['file']} -> {entry['part']}.glb ...", flush=True)
        try:
            stats = convert_one(entry)
        except Exception as exc:  # noqa: BLE001 — one bad file must not stop the batch
            print(f"  FAILED: {exc}", flush=True)
            results[entry["part"]] = {"error": str(exc)}
            continue
        print(
            f"  {stats['glb_bytes'] / 1e6:.1f} MB, {stats.get('triangles', 0)} tris, "
            f"{stats['seconds']}s",
            flush=True,
        )
        results[entry["part"]] = stats

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
