"""DXF adapter — Route 2: build123d solid projection onto the XZ plane.

Selected when DXF_ROUTE=projection.

Strategy
--------
For each part solid in ctx.assembly.parts we project onto the CAD XZ plane
(which is the front elevation: CAD X = viewer X, CAD Z = viewer Y = height).
build123d ``project()`` returns a ShapeList of edges which we write as DXF
LINE entities.  If a particular edge type fails to project (e.g. a B-spline
that build123d can't flatten), we tessellate that part's mesh convex outline
as a fallback.

DXF dimensions and title block are identical to Route 1 — they are driven
entirely by ctx.assembly.dims from ``app.titleblock`` and
``app.adapters.dxf_adapter._draw_dimensions``.  Only the silhouette
geometry differs between routes.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
from build123d import Plane, Part, project, ShapeList
from ezdxf.colors import rgb2int

from app.adapters.dxf_adapter import _draw_dimensions
from app.naming import base_name
from app.adapters._titleblock import GUNMETAL, draw as draw_titleblock

from .base import Adapter, GenContext


class DxfProjectionAdapter:
    """Route 2: build123d projection silhouette."""

    format: str = "dxf"

    def available(self) -> bool:
        """build123d is a hard dependency of the service; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        if ctx.assembly is None:
            raise RuntimeError("DxfProjectionAdapter requires ctx.assembly")

        doc = ezdxf.new(dxfversion="R2010")
        msp = doc.modelspace()

        _project_assembly(msp, ctx)
        _draw_dimensions(msp, ctx)
        draw_titleblock(msp, ctx)

        out_path = ctx.out_dir / f"{ctx.base_name}.dxf"
        doc.saveas(str(out_path))
        return [out_path]


# ---------------------------------------------------------------------------
# Projection helpers
# ---------------------------------------------------------------------------

_XZ = Plane.XZ  # CAD front elevation plane (X = viewer X, Z = viewer Y/height)


def _project_part(msp, solid: Part) -> bool:
    """Project a single solid onto XZ; write edges as DXF lines.

    Returns True on success, False if projection raised an exception
    (caller will fall back to tessellated mesh outline).
    """
    try:
        projected: ShapeList = project(solid, _XZ)
        _write_shape_list(msp, projected)
        return True
    except Exception:
        return False


def _write_shape_list(msp, shapes: ShapeList) -> None:
    """Write edges from a projected ShapeList to msp as LINE entities."""
    from build123d import Edge, Wire, Face

    for shape in shapes:
        if hasattr(shape, "edges"):
            edges = shape.edges()
        elif hasattr(shape, "__iter__"):
            edges = list(shape)
        else:
            edges = [shape]

        for edge in edges:
            _write_edge(msp, edge)


def _write_edge(msp, edge) -> None:
    """Write a single projected edge to msp.

    Supports straight lines and curves (tessellated into segments).
    The edge lives in the XZ plane: we read its start/end vertices
    as (X, Z) and write DXF (x, y) = (X, Z).
    """
    try:
        from build123d import GeomType

        # Prefer explicit start/end for lines
        geom_type = getattr(edge, "geom_type", None)
        if geom_type is not None and str(geom_type) in ("LINE", "GeomType.LINE"):
            _line_from_edge(msp, edge)
            return
    except Exception:
        pass

    # Tessellate: sample the edge at intervals
    try:
        pts = edge.positions(count=12)
        if len(pts) >= 2:
            dxf_pts = [(v.X, v.Z) for v in pts]
            for i in range(len(dxf_pts) - 1):
                ln = msp.add_line(dxf_pts[i], dxf_pts[i + 1])
                ln.dxf.true_color = GUNMETAL
        return
    except Exception:
        pass

    # Final fallback: start/end only
    try:
        _line_from_edge(msp, edge)
    except Exception:
        pass


def _line_from_edge(msp, edge) -> None:
    """Add a single DXF line from edge start to edge end (XZ→DXF XY)."""
    start = edge.start_vertex()
    end = edge.end_vertex()
    p1 = (start.X, start.Z)
    p2 = (end.X, end.Z)
    ln = msp.add_line(p1, p2)
    ln.dxf.true_color = GUNMETAL


def _tessellate_fallback(msp, solid: Part) -> None:
    """Tessellate the solid to a mesh and project convex hull outline to XZ.

    This is a fallback when build123d ``project()`` fails.  We convert the
    mesh triangles to XZ projected points and draw the convex outline.
    """
    try:
        import math

        vertices, triangles = solid.tessellate(0.5)  # 0.5mm tolerance

        # Project all vertices onto XZ (drop Y)
        pts_xz = list({(round(v.X, 2), round(v.Z, 2)) for v in vertices})
        if len(pts_xz) < 2:
            return

        # Graham scan / simple convex hull on XZ projection
        hull = _convex_hull(pts_xz)
        if len(hull) < 2:
            return

        for i in range(len(hull)):
            p1 = hull[i]
            p2 = hull[(i + 1) % len(hull)]
            ln = msp.add_line(p1, p2)
            ln.dxf.true_color = GUNMETAL

    except Exception:
        pass  # If tessellation also fails, skip this part silently


def _convex_hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Simple O(n log n) convex hull (Graham scan)."""
    import math

    pts = sorted(set(pts))
    if len(pts) <= 1:
        return pts

    def cross(O, A, B):
        return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def _project_assembly(msp, ctx: GenContext) -> None:
    """Project each part solid; fall back to tessellation on failure."""
    for part_id, solid in ctx.assembly.parts:
        success = _project_part(msp, solid)
        if not success:
            _tessellate_fallback(msp, solid)
