"""Real-CAD geometry resolution (Phase 0.10 ingest).

Engineering's WiLLstudio STEP drop (``STEP-Website/WiLLstudio``) is the factory
CAD for many catalog parts.  When a file for a part is present locally, the
service uses it INSTEAD of the parametric placeholder, so STEP/DWG/IFC/RFA
downloads carry real geometry.  When it is absent — which is the case on any
deploy, because real CAD is deliberately gitignored (see .gitignore and
docs/real-geometry.json) — every part falls back to the parametric kit and the
service behaves exactly as it did in 0.9.

Resolution order for a part:

1. the **design-code** file, when the configured part number resolves one
   (``SS3-40F.STEP`` is the real 3-arm cluster, not a synthesised copy of SS1);
2. the part's **base** file (``SS1-40F.STEP``);
3. ``None`` → parametric placeholder.

Cost + caching
--------------
OCCT parses these masters in ~0.5 s (brackets/covers) to ~20 s (a 36 MB fixture
master, measured 2026-08-04).  That is too slow to redo per request, so an
imported shape is cached two ways: an in-process LRU, and an on-disk BREP
(OCCT's native format, an order of magnitude faster to read than STEP).  The
BREP cache is written on first use and lives beside the STEP files.

Units/orientation: these files are SolidWorks exports in inches with **Y up**;
OCCT normalises the length unit to mm on read, so only the axis convention has
to change — the kit works in mm with **Z up**, so a real shape is rotated +90°
about X and its origin moved to the part's lower attachment point, matching the
placeholder convention (``viewer_to_cad``).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

# Default location = where scripts/step-to-glb/ingest.py copies the drive files.
_DEFAULT_STEP_DIR = Path(__file__).parent.parent.parent / "scripts" / "render-rig" / "real-assets" / "step"

# part id -> STEP filename for the part's BASE geometry (single arm, one cover…).
# Mirrors INGEST in scripts/step-to-glb/ingest.py; provenance lives in
# docs/real-geometry.json.
BASE_FILES: dict[str, str] = {
    "alum-pole-12": "RSAA-4040-12.STEP",
    "sh1-shepherds-hook": "SH1-40F.STEP",
    "willstudio-side-shepherds-hook-pole-top-brackets": "SS1-40F.STEP",
    "willstudio-suspension-arm-pole-top-brackets": "AR1-40F.STEP",
    # Phase 0.12 (A3) — corrected base-cover mapping.
    #
    # This table used to read bc-round->CL1, aluminum-light-pole-base-covers->CL2,
    # bc-fluted->CL3: the pre-spec-sheet GUESS from the 0.10 ingest.  The 8/4
    # spec sheet and the ingest record both say CL1/CL2/CL3 are the SMALL/MEDIUM/
    # LARGE clamshells and SC1/SC2 the spun collars — the five base covers a
    # customer can actually select.  The three ids above are superseded standalone
    # catalog entries with NO real CAD of their own, so under the old mapping the
    # five selectable covers downloaded parametric placeholders while three
    # retired products served real (and wrong) geometry.  Renders were corrected
    # in 0.10.5; this download path never was.
    "bc-cl1-small-clamshell": "CL1-4R.STEP",
    "bc-cl2-medium-clamshell": "CL2-4R.STEP",
    "bc-cl3-large-clamshell": "CL3-4R.STEP",
    "bc-sc1-spun-collar": "SC1-4R.STEP",
    "bc-sc2-spun-collar-split": "SC2-4R.STEP",
    "willstudio-ba1-banner-arm": "BA24-4R.STEP",
    "gvx-pendant": "WD-GVX-PM",
    "drx-post-top": "DRX-Post-Top.STEP",
    "tex-post-top": "TEX.STEP",
    "mvx-coach": "MXV.STEP",
    "willstudio-rxb-sxb-bollard": "RXB.STEP",
    "willstudio-dwx-flood-spot": "DWX.STEP",
}

# (part id, design code) -> real file for a SINGLE-component design.  Used as kit
# geometry: the assembly places one of these and repeats it radially, exactly as it
# does with a placeholder.
DESIGN_FILES: dict[tuple[str, str], str] = {
    ("willstudio-side-shepherds-hook-pole-top-brackets", "SS1"): "SS1-40F.STEP",
    ("willstudio-suspension-arm-pole-top-brackets", "AR1"): "AR1-40F.STEP",
    ("sh1-shepherds-hook", "SH1"): "SH1-40F.STEP",
    # Phase 0.12 (A3): same correction as BASE_FILES above — the design code is
    # the base cover's OWN code, on the part that actually carries it.
    ("bc-cl1-small-clamshell", "CL1"): "CL1-4R.STEP",
    ("bc-cl2-medium-clamshell", "CL2"): "CL2-4R.STEP",
    ("bc-cl3-large-clamshell", "CL3"): "CL3-4R.STEP",
    ("bc-sc1-spun-collar", "SC1"): "SC1-4R.STEP",
    ("bc-sc2-spun-collar-split", "SC2"): "SC2-4R.STEP",
}

# (part id, design code) -> real file that already contains the WHOLE cluster
# (SS3-40F.STEP is Engineering's 3-arm assembly, tenon adapter included).  These are
# NOT used as kit geometry — the kit would then repeat an already-complete cluster.
# They ship as-is inside the zip bundle, named by the configured part number: the
# best possible answer to "give me the CAD for WP-SS3-40F-BK".
CLUSTER_FILES: dict[tuple[str, str], str] = {
    ("willstudio-side-shepherds-hook-pole-top-brackets", "SS2"): "SS2-40F.STEP",
    ("willstudio-side-shepherds-hook-pole-top-brackets", "SS3"): "SS3-40F.STEP",
    ("willstudio-side-shepherds-hook-pole-top-brackets", "SS4"): "SS4-40F.STEP",
    ("willstudio-suspension-arm-pole-top-brackets", "AR2"): "AR2-40F.STEP",
    ("willstudio-suspension-arm-pole-top-brackets", "AR3"): "AR3-40F.STEP",
    ("willstudio-suspension-arm-pole-top-brackets", "AR4"): "AR4-40F.STEP",
    # Phase 0.12 (A3): three variant files that carry real CAD but were
    # referenced by no table at all — the coverage matrix's "real CAD exists,
    # nothing serves it" row.  Registering them here puts the order code next to
    # its released file so the mapping is reviewable and no longer folklore.
    #
    # ⚠ This does NOT make them downloadable, and nothing here should be read as
    # claiming it does.  TWO independent gates are still shut:
    #   1. Nothing in app/ calls cluster_step_path() — app/kit/assembly.py's
    #      _design() returns None unconditionally (a tracked 0.10.5 carry-forward),
    #      so this whole table is unreachable from a request today.
    #   2. These are Engineering's FULL masters; customer downloads resolve only
    #      through the fail-closed CUSTOMER_STEP_FILES allowlist below, which
    #      still contains exactly one entry.
    ("willstudio-ba1-banner-arm", "BA30"): "BA30-4R.STEP",
    ("willstudio-rxb-sxb-bollard", "SXB"): "SXB.STEP",
    # DRX's Area (side-mount) variant.  The catalog's DRX mounting column offers
    # SMS (square pole/wall) and SMR (round pole); one released side-mount export
    # covers both, so both codes point at it.
    ("drx-post-top", "SMS"): "DRX-Area-4R-Side-Mount.STEP",
    ("drx-post-top", "SMR"): "DRX-Area-4R-Side-Mount.STEP",
    # Phase 0.13: Cole's 8/11-8/12 exports.  TEX now has the same side-mount
    # export DRX has, and it is registered identically — TEX's mounting column
    # offers the same SMS/SMR pair and one released file covers both.
    ("tex-post-top", "SMS"): "TEX-AREA.STEP",
    ("tex-post-top", "SMR"): "TEX-AREA.STEP",
    # The GVX with its House Side Shield fitted, keyed by the ACCESSORY code
    # (HSS-GVX) rather than a design code — gvx-pendant's design code is GVX and
    # already resolves the master through BASE_FILES.  Both gates above still
    # apply: nothing calls cluster_step_path(), and this is another full master.
    ("gvx-pendant", "HSS-GVX"): "GVX-HSS.STEP",
}


# ---------------------------------------------------------------------------
# Phase 0.11 (Workstream I) — the customer-download allowlist.
#
# part id -> the STEP file CLEARED to leave the building.
#
# Deliberately a SEPARATE, opt-in table rather than a reuse of BASE_FILES.
# BASE_FILES holds Engineering's FULL masters (WD-GVX-PM is 88 MB of internal
# detail); shipping one to a customer leaks exactly the IP that de-featuring
# exists to protect.  Phase 0.10's bundle attachment resolved downloads from
# "any part with real CAD", which is why it had to be dropped wholesale in
# 0.10.5 rather than fixed in place.
#
# This table is FAIL-CLOSED: a new real STEP does not become downloadable just
# by existing.  A part joins only once Cole has supplied a de-featured shell
# AND it has been confirmed by a human.
# ---------------------------------------------------------------------------
CUSTOMER_STEP_FILES: dict[str, str] = {
    # Confirmed by Nick, 2026-08-10: GVX-Simple.STEP is Cole's simplified export
    # for the GVX (27 MB, against the 88 MB WD-GVX-PM master). The master stays
    # the VIEWER source — it has more detail and only images ship from it — while
    # this shell is what a customer actually receives.
    "gvx-pendant": "GVX-Simple.STEP",
}


def step_dir() -> Path:
    """Where the real STEP files live (``REAL_STEP_DIR`` overrides the default)."""
    return Path(os.environ.get("REAL_STEP_DIR", _DEFAULT_STEP_DIR))


def customer_step_path(part_id: str) -> Path | None:
    """The de-featured STEP cleared for customer download, or None.

    None means "not cleared" — never "fall back to the master".  Callers must
    not substitute ``real_step_path`` here.
    """
    if os.environ.get("DISABLE_REAL_GEOMETRY"):
        return None
    name = CUSTOMER_STEP_FILES.get(part_id)
    if not name:
        return None
    candidate = step_dir() / name
    return candidate if candidate.is_file() else None


def real_step_path(part_id: str, design_code: str | None = None) -> Path | None:
    """The real STEP file for this part (design-specific first), or None."""
    if os.environ.get("DISABLE_REAL_GEOMETRY"):
        return None
    root = step_dir()
    if design_code:
        name = DESIGN_FILES.get((part_id, design_code))
        if name:
            candidate = root / name
            if candidate.is_file():
                return candidate
    name = BASE_FILES.get(part_id)
    if not name:
        return None
    candidate = root / name
    return candidate if candidate.is_file() else None


def has_real_geometry(part_id: str, design_code: str | None = None) -> bool:
    return real_step_path(part_id, design_code) is not None


def cluster_step_path(part_id: str, design_code: str | None) -> Path | None:
    """Engineering's whole-cluster file for a configured design (bundle attachment)."""
    if os.environ.get("DISABLE_REAL_GEOMETRY") or not design_code:
        return None
    name = CLUSTER_FILES.get((part_id, design_code))
    if not name:
        return None
    candidate = step_dir() / name
    return candidate if candidate.is_file() else None


def available_parts() -> list[str]:
    """Part ids whose real CAD is present locally — drives the coverage report."""
    return sorted(pid for pid in BASE_FILES if real_step_path(pid) is not None)


# Origin mode per part — the SAME modes scripts/step-to-glb/ingest.py uses for the
# render-rig GLBs, so a CAD download and the viewer layer describe one object.
ORIGIN_MODES: dict[str, str] = {
    "alum-pole-12": "base",
    "sh1-shepherds-hook": "mount",
    "willstudio-side-shepherds-hook-pole-top-brackets": "mount",
    "willstudio-suspension-arm-pole-top-brackets": "mount",
    "bc-round": "base",
    "aluminum-light-pole-base-covers": "base",
    "bc-fluted": "base",
    "willstudio-ba1-banner-arm": "mount-center",
    "gvx-pendant": "top",
    "drx-post-top": "base",
    "tex-post-top": "base",
    "mvx-coach": "base",
    "willstudio-rxb-sxb-bollard": "base",
    "willstudio-dwx-flood-spot": "base",
}

# Z rotation (deg) that brings a part's real reach onto the kit's +X reach axis —
# the same correction real-parts.json applies for the render rig (rotateY there).
ROTATIONS: dict[str, float] = {
    "sh1-shepherds-hook": -90.0,
    "willstudio-ba1-banner-arm": 90.0,
}

# Most masters are modelled Y-up (SolidWorks); the bollard and flood are modelled
# Z-up — verified from their raw bounding boxes during the 0.10 ingest.  A Z-up file
# is already in the kit's frame and must NOT be rotated again.
SOURCE_FRAMES: dict[str, str] = {
    "willstudio-rxb-sxb-bollard": "z-up",
    "willstudio-dwx-flood-spot": "z-up",
}


def kit_uses_real_geometry() -> bool:
    """Whether the CAD kit builds from real STEP solids (opt-in, default OFF).

    MEASURED COST (2026-08-04): OCCT parses a fixture master in ~10-20 s (3 s from
    the BREP cache), but *fusing* real B-reps is the killer — the GVX master alone
    carries **41,933 faces**, and a 3-arm assembly with three of them did not
    finish in 10 minutes, because the kit fuses every placed part into one solid.
    (Per-part import is fine: the pole is 6 faces, a real arm 414.)  So the download path
    keeps the fast, deterministic parametric geometry by default, and the real CAD
    reaches customers two other ways:

      * the viewer's pre-rendered layers ARE the real geometry (render rig), and
      * the zip bundle ships Engineering's own STEP per component, named by part
        number (``factory-cad/WP-SS3-40F-BK.step``).

    Set ``REAL_GEOMETRY_IN_KIT=1`` to build assemblies from real solids anyway
    (useful for a one-off high-fidelity export, expect minutes per request).
    """
    return bool(os.environ.get("REAL_GEOMETRY_IN_KIT"))


@lru_cache(maxsize=32)
def load_real_solid(part_id: str, design_code: str | None = None):
    """The real solid for a part in the kit's frame (mm, Z up), or None.

    The engine import is deferred to ``app/kit/real_import.py`` so this module
    stays engine-free (adapter-boundary rule).  Returns None whenever real
    geometry is disabled, missing or unreadable, so callers degrade to the
    parametric placeholder instead of failing a download.
    """
    if not kit_uses_real_geometry():
        return None
    path = real_step_path(part_id, design_code)
    if path is None:
        return None
    from .kit.real_import import import_real_shape

    return import_real_shape(
        str(path),
        mode=ORIGIN_MODES.get(part_id, "base"),
        rotate_z_deg=ROTATIONS.get(part_id, 0.0),
        source_frame=SOURCE_FRAMES.get(part_id, "y-up"),
    )
