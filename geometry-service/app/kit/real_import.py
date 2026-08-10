"""Import real SolidWorks STEP geometry into the kit's CAD frame (Phase 0.10).

Engine module — OCCT/build123d imports live here (inside ``app/kit/``), keeping the
adapter boundary intact.  ``app/realgeom.py`` decides WHICH file to use and never
imports an engine itself.

Frame conversion
----------------
The real files are SolidWorks exports with **Y up** (OCCT normalises their inch
unit to mm on read).  The kit works in **mm with Z up** and every part's origin at
its lower attachment point, so a real shape is:

1. rotated +90° about X  (Y-up → Z-up), then
2. re-based per the part's origin mode — the SAME modes the render-rig converter
   uses (``scripts/step-to-glb/convert.py``), so the CAD download and the viewer
   layer describe the same object:

   * ``base``          floor Z, centre X/Y  (poles, covers, post-top fixtures)
   * ``mount``         floor Z, trust native X/Y  (pole-top brackets/arms)
   * ``mount-center``  centre Z, trust native X/Y  (mid-shaft banner arm)
   * ``top``           ceiling Z, centre X/Y  (pendants that hang)

BREP cache
----------
Parsing a 36 MB STEP master costs ~10-20 s.  The converted shape is cached next to
the source as ``<name>.<mode>.brep`` (OCCT's native format), which reads back in
well under a second, so only the first request after an ingest pays the price.
"""

from __future__ import annotations

from pathlib import Path

from build123d import Compound, Location, Rotation

_MM = 1.0  # OCCT returns millimetres


def _bbox(shape):
    return shape.bounding_box()


def _rebase(shape, mode: str):
    """Move the shape so its origin is the part's lower attachment point."""
    bb = _bbox(shape)
    cx = (bb.min.X + bb.max.X) / 2
    cy = (bb.min.Y + bb.max.Y) / 2
    if mode == "mount":
        dx, dy, dz = 0.0, 0.0, -bb.min.Z
    elif mode == "mount-center":
        dx, dy, dz = 0.0, 0.0, -(bb.min.Z + bb.max.Z) / 2
    elif mode == "top":
        dx, dy, dz = -cx, -cy, -bb.max.Z
    else:  # "base"
        dx, dy, dz = -cx, -cy, -bb.min.Z
    return Location((dx, dy, dz)) * shape


def _cache_path(step_path: Path, mode: str) -> Path:
    return step_path.with_suffix(step_path.suffix + f".{mode}.brep")


def import_real_shape(
    step_path_str: str,
    mode: str = "base",
    rotate_z_deg: float = 0.0,
    source_frame: str = "y-up",
):
    """Return the real part as a kit-frame ``Part`` (mm, Z up), or None on failure.

    ``source_frame`` is ``y-up`` for the SolidWorks masters and ``z-up`` for the few
    files modelled standing already (the bollard/flood) — a z-up file needs no
    axis rotation.
    """
    step_path = Path(step_path_str)
    if not step_path.is_file():
        return None

    cache = _cache_path(step_path, f"{mode}-{source_frame}")
    shape = _read_brep(cache) if cache.is_file() else None

    if shape is None:
        shape = _read_step(step_path)
        if shape is None:
            return None
        if source_frame != "z-up":
            # Y-up (SolidWorks) → Z-up (kit).
            shape = Rotation(90.0, 0.0, 0.0) * shape
        shape = _rebase(shape, mode)
        _write_brep(shape, cache)

    if rotate_z_deg:
        shape = Rotation(0.0, 0.0, rotate_z_deg) * shape
    return shape


def _read_step(step_path: Path):
    """Parse a STEP file into a single fused shape (None when unreadable)."""
    try:
        from build123d import import_step

        return import_step(str(step_path))
    except Exception:  # noqa: BLE001 — a bad/huge file must degrade, not crash
        return None


def _read_brep(cache: Path):
    try:
        from OCP.BRep import BRep_Builder
        from OCP.BRepTools import BRepTools
        from OCP.TopoDS import TopoDS_Shape

        shape = TopoDS_Shape()
        builder = BRep_Builder()
        if not BRepTools.Read_s(shape, str(cache), builder):
            return None
        # Cast to the concrete wrapper (Solid/Shell/Compound…) that matches the
        # OCCT shape's actual type — a bare ``Part(shape)`` around a raw
        # TopoDS_Solid masquerades as a Compound, and Compound.volume walks
        # sub-shapes rather than measuring the shape itself, so it silently
        # reports 0 for anything that isn't a genuine TopoDS_Compound. This is
        # the same cast build123d's own Rotation/Location operators apply, so a
        # cache hit and a fresh STEP parse return the same wrapper type.
        return Compound.cast(shape)
    except Exception:  # noqa: BLE001
        return None


def _write_brep(shape, cache: Path) -> None:
    try:
        from OCP.BRepTools import BRepTools

        BRepTools.Write_s(shape.wrapped, str(cache))
    except Exception:  # noqa: BLE001 — cache is an optimisation, never required
        pass
