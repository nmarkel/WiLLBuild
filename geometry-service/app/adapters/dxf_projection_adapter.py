"""DXF adapter — Route 2: build123d solid projection onto the XZ plane.

Selected when DXF_ROUTE=projection.

Strategy
--------
For each part solid in ctx.assembly.parts we project onto the CAD XZ plane
(which is the front elevation: CAD X = viewer X, CAD Z = viewer Y = height).
build123d ``project()`` returns a ShapeList of edges which we write as DXF
LINE entities.  On real imported B-reps ``project()`` can return an *empty*
ShapeList without raising (silent failure) — we detect that (zero edges
written) and fall back to an OCP HLRBRep hidden-line projection that writes
the visible edges (sharp + smooth + silhouette outlines) as a real outline.
A tessellated convex hull remains the final last-resort fallback so the
elevation is never blank.

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
from app.adapters._drawing_sheet import pin_document, try_shell_sheet
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
        # Phase 0.18: the shell sheet is shared with Route 1. This route's
        # difference is how a part SILHOUETTE is produced, and the shell sheet
        # takes its line work from the shells instead — so returning it only on
        # Route 1 would ship a different drawing down each route and void the
        # boundary proof in docs/adapter-swap-note.md.
        shell_sheet = try_shell_sheet(ctx)
        if shell_sheet is not None:
            return [shell_sheet]

        if ctx.assembly is None:
            raise RuntimeError("DxfProjectionAdapter requires ctx.assembly")

        doc = ezdxf.new(dxfversion="R2010")
        pin_document(doc)  # no wall clock in generated artifacts
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

    Returns True only if the projection actually produced geometry (one or
    more LINE entities written).  Returns False when projection raises OR
    when it returns an *empty* ShapeList (the silent-failure case on real
    imported B-reps: build123d ``project()`` returns an empty Compound
    without raising).  The caller then falls back to the HLR outline.
    """
    try:
        projected: ShapeList = project(solid, _XZ)
        written = _write_shape_list(msp, projected)
        return written > 0
    except Exception:
        return False


def _write_shape_list(msp, shapes: ShapeList) -> int:
    """Write edges from a projected ShapeList to msp; return edges written."""
    written = 0
    for shape in shapes:
        if hasattr(shape, "edges"):
            edges = shape.edges()
        elif hasattr(shape, "__iter__"):
            edges = list(shape)
        else:
            edges = [shape]

        for edge in edges:
            if _write_edge(msp, edge):
                written += 1
    return written


def _write_edge(msp, edge) -> bool:
    """Write a single projected edge to msp; return True if a line was added.

    Supports straight lines and curves (tessellated into segments).
    The edge lives in the XZ plane: we read its start/end vertices
    as (X, Z) and write DXF (x, y) = (X, Z).
    """
    try:
        from build123d import GeomType

        # Prefer explicit start/end for lines
        geom_type = getattr(edge, "geom_type", None)
        if geom_type is not None and str(geom_type) in ("LINE", "GeomType.LINE"):
            return _line_from_edge(msp, edge)
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
            return True
    except Exception:
        pass

    # Final fallback: start/end only
    try:
        return _line_from_edge(msp, edge)
    except Exception:
        return False


def _line_from_edge(msp, edge) -> bool:
    """Add a single DXF line from edge start to edge end (XZ→DXF XY)."""
    start = edge.start_vertex()
    end = edge.end_vertex()
    p1 = (start.X, start.Z)
    p2 = (end.X, end.Z)
    ln = msp.add_line(p1, p2)
    ln.dxf.true_color = GUNMETAL
    return True


# ---------------------------------------------------------------------------
# HLR (hidden-line removal) fallback — real outline, not a convex hull
# ---------------------------------------------------------------------------
#
# On real imported B-reps build123d ``project()`` silently returns an empty
# ShapeList.  Rather than degrade to a crude convex hull (which loses the
# shepherd's-hook curve and the base profile), we run an OCP HLRBRep hidden-
# line projection onto the front (XZ) elevation and write the *visible* edges
# (sharp + smooth + silhouette outlines) as DXF lines.  This yields a true
# outline at real scale.

def _hlr_outline(msp, solid: Part) -> bool:
    """Project one solid to the XZ elevation via OCP HLR; write visible edges.

    Front elevation: projected 2D X = CAD X, projected 2D Y = CAD Z (height),
    view direction along -Y.  Returns True if any LINE was written.
    """
    try:
        from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
        from OCP.HLRAlgo import HLRAlgo_Projector
        from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir

        # Coordinate system so the projected XY plane is (CAD_X, CAD_Z):
        #   X-dir = world +X, Y-dir = world +Z, view (Z) dir = world -Y.
        ax2 = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, -1, 0), gp_Dir(1, 0, 0))
        projector = HLRAlgo_Projector(ax2)

        algo = HLRBRep_Algo()
        algo.Add(solid.wrapped)
        algo.Projector(projector)
        algo.Update()
        algo.Hide()

        to_shape = HLRBRep_HLRToShape(algo)
        written = 0
        # Visible sharp edges + visible smooth edges + visible silhouette
        # outlines (the last captures the round pole / hook curve profile).
        for comp in (
            to_shape.VCompound(),
            to_shape.Rg1LineVCompound(),
            to_shape.OutLineVCompound(),
        ):
            written += _write_ocp_edges(msp, comp)
        return written > 0
    except Exception:
        return False


def _write_ocp_edges(msp, compound) -> int:
    """Tessellate every OCP TopoDS edge in `compound` into DXF lines.

    The compound comes from HLR and already lives in the projection plane
    (Z≈0), so we read each sampled point's (X, Y) directly as DXF (x, y).
    Returns the number of LINE entities written.
    """
    if compound is None:
        return 0
    try:
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_EDGE
        from OCP.TopoDS import TopoDS
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        from OCP.GeomAbs import GeomAbs_Line
    except Exception:
        return 0

    written = 0
    exp = TopExp_Explorer(compound, TopAbs_EDGE)
    while exp.More():
        try:
            edge = TopoDS.Edge_s(exp.Current())
            curve = BRepAdaptor_Curve(edge)
            u0, u1 = curve.FirstParameter(), curve.LastParameter()
            # Straight lines need only endpoints; curves are sampled.
            n = 2 if curve.GetType() == GeomAbs_Line else 16
            pts = []
            for i in range(n):
                u = u0 + (u1 - u0) * i / (n - 1)
                p = curve.Value(u)
                pts.append((p.X(), p.Y()))
            for i in range(len(pts) - 1):
                if pts[i] == pts[i + 1]:
                    continue
                ln = msp.add_line(pts[i], pts[i + 1])
                ln.dxf.true_color = GUNMETAL
                written += 1
        except Exception:
            pass
        exp.Next()
    return written


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
    """Project each part solid onto the front elevation.

    Fallback chain (each step fires only if the previous wrote no geometry):
      1. build123d ``project()`` — works on the kit's parametric solids.
      2. OCP HLR hidden-line outline — real visible-edge silhouette; this is
         what fires on Cole's real imported B-reps where ``project()`` returns
         an empty ShapeList.
      3. tessellated convex hull — crude last resort so the elevation is
         never blank.
    """
    for part_id, solid in ctx.assembly.parts:
        if _project_part(msp, solid):
            continue
        if _hlr_outline(msp, solid):
            continue
        _tessellate_fallback(msp, solid)
