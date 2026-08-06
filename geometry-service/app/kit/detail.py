"""Concept-level fixture detail (Phase 0.10, Workstream D).

Round-4 feedback (Tyler, 8/3): *fixtures need more detail — step-downs, flush
transitions — the STEP file is "a little blocky."*  This module is that detail
pass.  It refines the FIXTURE solids only:

* **flush transitions** — every hard edge of a fixture primitive gets a small
  chamfer, so a housing reads as a machined part instead of a slab;
* **step-downs** — a housing-sized box gains an inset lower band (the lens/door
  step every real luminaire housing has);
* **smoothed revolves** — a lathe profile's corners are filleted before the
  revolve, so the rings between profile segments blend instead of stepping.

Rules of engagement
-------------------
* Fixtures ONLY.  Poles, base covers, arms and banner hardware still build
  exactly as they did in 0.9 — their solids stay byte-identical.  The detail flag
  is threaded from ``build_fixture``; everything else defaults to off.
* Size-gated.  Detail is derived from the part's own dimensions and is skipped
  entirely on small/thin features (brackets, panels, accent bands), where a
  chamfer or step would swallow the feature.
* Guarded.  OCCT chamfers/fillets can fail on tight geometry; every operation
  falls back to the undetailed solid rather than failing a customer's download.
* Deterministic.  Pure functions of the placeholder dimensions — no wall clock,
  no randomness, so the same config still produces byte-identical output.

Fidelity bar is unchanged: this is concept-level geometry, not a
manufacturing-released model.
"""

from __future__ import annotations

from build123d import Align, Box, Location, chamfer, fillet

# --- chamfer (flush transitions) -------------------------------------------
_CHAMFER_FRACTION = 0.06   # of the smallest dimension
_CHAMFER_MIN_MM = 1.0
_CHAMFER_MAX_MM = 8.0
_CHAMFER_SKIP_BELOW_MM = 20.0  # thin plates/bars keep their sharp edges

# --- step-down (housing lens/door band) ------------------------------------
_STEP_MIN_FOOTPRINT_MM = 120.0  # only housing-sized boxes get a step
_STEP_MIN_HEIGHT_MM = 80.0
_STEP_BAND_FRACTION = 0.15      # of the housing height
_STEP_BAND_MIN_MM = 8.0
_STEP_BAND_MAX_MM = 40.0
_STEP_INSET_FRACTION = 0.08     # of the smaller footprint dimension
_STEP_INSET_MIN_MM = 3.0
_STEP_INSET_MAX_MM = 20.0

# --- lathe profile fillet ---------------------------------------------------
_PROFILE_FILLET_FRACTION = 0.02  # of the profile's vertical extent
_PROFILE_FILLET_MIN_MM = 1.0
_PROFILE_FILLET_MAX_MM = 6.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def chamfer_length(dims_mm: tuple[float, ...]) -> float:
    """Chamfer size for a primitive with these dimensions (0 = skip)."""
    smallest = min(dims_mm)
    if smallest < _CHAMFER_SKIP_BELOW_MM:
        return 0.0
    return _clamp(_CHAMFER_FRACTION * smallest, _CHAMFER_MIN_MM, _CHAMFER_MAX_MM)


def chamfer_all_edges(solid, length: float):
    """Chamfer every edge of ``solid``; return the original if OCCT declines.

    A chamfer that cannot fit (tight corner, coincident faces) raises out of
    OCCT.  A slightly blockier concept solid is always better than a failed
    download, so the undetailed solid is the fallback.
    """
    if length <= 0 or solid is None:
        return solid
    try:
        return chamfer(solid.edges(), length=length)
    except Exception:  # noqa: BLE001 - OCCT raises a range of failures
        return solid


def step_down_box(width: float, depth: float, height: float):
    """A housing box with an inset lower band, or None when it doesn't apply.

    Dimensions are mm (CAD axes: width=X, depth=Y, height=Z, origin at the base
    centre — the same convention ``_build_box`` uses).  The step is inset
    horizontally only, so the part's bounding box (and therefore every dimension
    callout on the drawings) is unchanged.
    """
    footprint = min(width, depth)
    if footprint < _STEP_MIN_FOOTPRINT_MM or height < _STEP_MIN_HEIGHT_MM:
        return None

    band = _clamp(_STEP_BAND_FRACTION * height, _STEP_BAND_MIN_MM, _STEP_BAND_MAX_MM)
    inset = _clamp(_STEP_INSET_FRACTION * footprint, _STEP_INSET_MIN_MM, _STEP_INSET_MAX_MM)
    if band >= height or inset * 2 >= footprint:
        return None

    # Lower band (stepped in), then the main housing above it.
    lower = Location((0, 0, 0)) * Box(
        width - 2 * inset,
        depth - 2 * inset,
        band,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    )
    upper = Location((0, 0, band)) * Box(
        width,
        depth,
        height - band,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    )
    return lower + upper


def profile_fillet_radius(profile_mm: list[tuple[float, float]]) -> float:
    """Fillet radius for a revolve profile's corners (0 = skip)."""
    if len(profile_mm) < 3:
        return 0.0
    ys = [y for _r, y in profile_mm]
    extent = max(ys) - min(ys)
    if extent <= 0:
        return 0.0
    return _clamp(
        _PROFILE_FILLET_FRACTION * extent, _PROFILE_FILLET_MIN_MM, _PROFILE_FILLET_MAX_MM
    )


def fillet_sketch_corners(sketch, radius: float) -> bool:
    """Fillet a BuildSketch's corners in place; True when it took.

    Called inside a ``BuildSketch`` context.  Returns False (leaving the sharp
    profile) when the radius cannot fit any corner.
    """
    if radius <= 0:
        return False
    try:
        fillet(sketch.vertices(), radius=radius)
        return True
    except Exception:  # noqa: BLE001 - OCCT raises a range of failures
        return False
