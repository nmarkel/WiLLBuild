"""2D projection of the shell assembly for the drawing deliverable.

Phase 0.18 (Tyler 8/20): the 2D drawing gets FOUR views — 0 degrees,
90 degrees, top, and an isometric. This module turns the same
``ShellAssembly`` the IFC/STEP ship (real castings + the analytic pole) into
per-view 2D line work, so the drawing agrees with every other deliverable
instead of re-deriving a silhouette from the parametric placeholders (the
0.17 lesson, one format later).

Lines come from the mesh itself, two kinds:
  * SILHOUETTE edges — an edge whose adjacent faces disagree about facing the
    camera, i.e. the outline of the form from this direction.
  * CREASE edges — an edge whose adjacent faces meet at a sharp angle and both
    face the camera: the feature lines a drafter expects (the cast base's
    steps, the hand-hole frame, the cover's rings).

`project_outlines` is what the sheet draws (Tyler 8/20, second pass): ONE
outline per component — fixture, arm, pole, base cover — and nothing inside it.
Silhouette+crease line work drew every internal feature of a casting, which on
a 45k-triangle fixture reads as a scribble rather than a drawing, and it drew
parts THROUGH each other because it had no hidden-line removal. The outline
path unions each component's projected triangles and subtracts the components
in front of it, so a component is opaque and only its profile is drawn.
`project_view` (silhouette + crease, no occlusion) stays for callers that want
feature lines.

Component occlusion is by NEAREST point, not per-face: two components that
interpenetrate along the view direction — an arm reaching behind the pole it
mounts on — are ordered as wholes. Per-face HLR needs B-rep solids (OCC
HLRBRep) and is a separate decision.

numpy + shapely (shapely does the 2D set algebra; both are already service
dependencies), so this lives in app/ next to shellgeom.
"""

from __future__ import annotations

import numpy as np
from shapely import LineString, MultiPolygon, Polygon, polygons, unary_union

from .shellgeom import ShellAssembly

M_TO_IN = 1.0 / 0.0254

#: Crease threshold: faces meeting sharper than this yield a drawn line.
#: Calibrated twice, on different subjects. Against the GVX spec sheet
#: (Tyler 8/20): 32 vs 24 vs 18 degrees leaves the fixture's distinct feature
#: count unchanged (22 -> 22 -> 18 levels), so the fixture gains nothing below
#: 32. Against the FLUTED clamshell (Tyler's 8/21 base cover reference): the
#: CL3's flutes are shallow enough that 32 degrees reduces them to broken
#: dashes, while 24 draws them as the continuous fluted curves the reference
#: shows (measured: 303 -> 428 in of cover crease line work; rendered
#: side-by-side to confirm the gain is flutes, not noise). 18 and below dredge
#: decimation serration on the smooth CL1, so 24 is the floor. File cost of
#: 32 -> 24 measured 8/20 at about +14% (885 KB -> 1.01 MB).
_CREASE_DEG = 24.0


def view_matrix(name: str) -> np.ndarray:
    """3x3 world->view basis. World is metres, +Y up (the viewer/GLB frame).

    The returned rows are the view's (right, up, toward-camera) axes, so
    `verts @ M.T` gives (x, y, depth) with x/y the drawing plane.
    """
    if name == "front":  # 0 degrees: looking along -Z at the X/Y plane
        return np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=float)
    if name == "side":  # 90 degrees about the vertical
        return np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], dtype=float)
    if name == "top":  # plan: looking down, +Z of the drawing is world -Z
        return np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=float)
    if name == "iso":
        # Standard isometric: rotate 45 degrees about the vertical, then tip
        # down by atan(1/sqrt(2)) ~ 35.264 degrees.
        a = np.deg2rad(45.0)
        b = np.arctan(1.0 / np.sqrt(2.0))
        ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
        rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
        return rx @ ry
    raise ValueError(f"unknown view {name!r}")


VIEWS = ("front", "side", "top", "iso")


def _edges_for_piece(verts: np.ndarray, tris: np.ndarray) -> list[tuple[float, float, float, float]]:
    """Silhouette + crease segments for one mesh, already in view space."""
    if len(tris) == 0:
        return []
    p0, p1, p2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    nrm = np.cross(p1 - p0, p2 - p0)
    lens = np.linalg.norm(nrm, axis=1)
    ok = lens > 1e-15
    nrm[ok] /= lens[ok][:, None]
    facing = nrm[:, 2] > 0.0  # +Z points toward the camera

    # Edge -> adjacent triangle indices
    adj: dict[tuple[int, int], list[int]] = {}
    for ti, tri in enumerate(tris):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            key = (int(a), int(b)) if a < b else (int(b), int(a))
            adj.setdefault(key, []).append(ti)

    cos_thresh = np.cos(np.deg2rad(_CREASE_DEG))
    out: list[tuple[float, float, float, float]] = []
    for (a, b), faces in adj.items():
        draw = False
        if len(faces) == 1:
            draw = bool(facing[faces[0]])  # open boundary of a front face
        else:
            f0, f1 = faces[0], faces[1]
            if facing[f0] != facing[f1]:
                draw = True  # silhouette
            elif facing[f0] and float(np.dot(nrm[f0], nrm[f1])) < cos_thresh:
                draw = True  # visible crease
        if draw:
            out.append((verts[a, 0], verts[a, 1], verts[b, 0], verts[b, 1]))
    return out


def project_view(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """All line work for one view, as (x0, y0, x1, y1) tuples in `unit_scale`
    units (inches by default — US drafting practice, and the imperial-only
    rule for generated documents)."""
    m = view_matrix(view)
    segs: list[tuple[float, float, float, float]] = []
    for piece in shells.pieces:
        v = piece.verts @ m.T
        segs.extend(_edges_for_piece(v, piece.tris))
    return [tuple(c * unit_scale for c in s) for s in segs]


def view_extents(segs) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) of a view's line work."""
    if not segs:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [c for s in segs for c in (s[0], s[2])]
    ys = [c for s in segs for c in (s[1], s[3])]
    return (min(xs), min(ys), max(xs), max(ys))


# ---------------------------------------------------------------------------
# Drafting conventions read off WiLL's own submittal template (Tyler 8/20:
# Tenon-Drilling-Adapter-Round-Approval-Rev A) — C-size sheet, dimensions in
# FRACTIONAL inches ('10 1/2"', 'ID 2 7/16"', '4"'), degrees for angles.
# ---------------------------------------------------------------------------

#: ANSI C sheet, landscape (the template's 1584 x 1224 pt).
SHEET_C_IN = (22.0, 17.0)


def fmt_inches(value_in: float, denom: int = 16) -> str:
    """Format inches the way the template does: whole + reduced fraction.

    4.0 -> '4"' ; 10.5 -> '10 1/2"' ; 2.4375 -> '2 7/16"'. Rounds to the
    nearest 1/denom, then reduces — never prints '2 8/16"'.
    """
    neg = value_in < 0
    v = abs(value_in)
    whole = int(v)
    num = int(round((v - whole) * denom))
    if num == denom:
        whole += 1
        num = 0
    if num:
        from math import gcd

        g = gcd(num, denom)
        num, den = num // g, denom // g
        text = f'{whole} {num}/{den}"' if whole else f'{num}/{den}"'
    else:
        text = f'{whole}"'
    return f"-{text}" if neg else text


def simplify(segs, tol_in: float = 0.02):
    """Collapse projected line work into a drawable set.

    A dense mesh yields tens of thousands of tiny collinear segments (measured:
    ~20k per view on a GVX build). CAD wants line WORK, not a triangle dump,
    so: drop sub-tolerance segments, snap endpoints to a grid, deduplicate,
    and merge runs that are collinear within tolerance.
    """
    q = 1.0 / max(tol_in, 1e-6)

    def snap(v: float) -> float:
        return round(v * q) / q

    seen: set[tuple[float, float, float, float]] = set()
    kept: list[tuple[float, float, float, float]] = []
    for x0, y0, x1, y1 in segs:
        a = (snap(x0), snap(y0))
        b = (snap(x1), snap(y1))
        if a == b:
            continue  # degenerate after snapping
        key = (a[0], a[1], b[0], b[1]) if a <= b else (b[0], b[1], a[0], a[1])
        if key in seen:
            continue  # same edge from the other adjacent face
        seen.add(key)
        kept.append(key)

    # Merge collinear neighbours: group by direction+offset, then join runs.
    buckets: dict[tuple[int, int, int], list[tuple[float, float, float, float]]] = {}
    for x0, y0, x1, y1 in kept:
        dx, dy = x1 - x0, y1 - y0
        n = (dx * dx + dy * dy) ** 0.5
        ux, uy = dx / n, dy / n
        if (ux, uy) < (0.0, 0.0):
            ux, uy = -ux, -uy
        # signed perpendicular offset from the origin identifies the line
        off = x0 * -uy + y0 * ux
        buckets.setdefault((round(ux, 2), round(uy, 2), round(off / tol_in)), []).append((x0, y0, x1, y1))

    out: list[tuple[float, float, float, float]] = []
    for (ux, uy, _), group in buckets.items():
        # project each endpoint onto the line's direction and merge intervals
        spans = []
        for x0, y0, x1, y1 in group:
            t0, t1 = x0 * ux + y0 * uy, x1 * ux + y1 * uy
            spans.append((min(t0, t1), max(t0, t1), (x0, y0, x1, y1)))
        spans.sort()
        cur_lo, cur_hi, ref = spans[0]
        base = ref
        for lo, hi, seg in spans[1:]:
            if lo <= cur_hi + tol_in:
                cur_hi = max(cur_hi, hi)
            else:
                out.append(_span_to_seg(base, ux, uy, cur_lo, cur_hi))
                cur_lo, cur_hi, base = lo, hi, seg
        out.append(_span_to_seg(base, ux, uy, cur_lo, cur_hi))
    return out


def _span_to_seg(ref, ux: float, uy: float, lo: float, hi: float):
    """Rebuild a segment from a merged interval along (ux, uy)."""
    x0, y0, x1, y1 = ref
    t0 = x0 * ux + y0 * uy
    px, py = x0 - t0 * ux, y0 - t0 * uy  # the line's perpendicular foot
    return (px + lo * ux, py + lo * uy, px + hi * ux, py + hi * uy)


# ---------------------------------------------------------------------------
# Component outlines (what the sheet draws)
# ---------------------------------------------------------------------------

#: Shell pieces grouped into the components a drafter names. The pole's base
#: casting and hand hole are PART of the pole, not separate items on the
#: drawing, so they share its outline instead of adding two more.
_COMPONENT_OF = {
    "Pole": "pole",
    "Pole Base": "pole",
    "Anchor Bolts": "pole",
    "Hand Hole": "pole",
    "Base Cover": "baseCover",
    "Arm": "arm",
    "Fixture": "fixture",
}

#: Hairline suppression. Coincident silhouettes (the pole inside its base
#: cover) would otherwise leave a sliver of the hidden component along the
#: shared edge; the occluder is grown by this much before subtracting.
_OCCLUDER_PAD_IN = 0.01

#: Outline vertex tolerance, and the smallest fragment worth drawing (a 1/32"
#: crumb left by the subtraction is noise on a 1:30 sheet).
_OUTLINE_TOL_IN = 0.01
_MIN_FRAGMENT_IN2 = 0.02


def subassembly(shells: ShellAssembly, names) -> ShellAssembly:
    """The same assembly with only `names` kept — for a detail view.

    A decorative base cover WRAPS the anchor base, so in a full elevation the
    bolts are correctly hidden. The spec sheet solves that with its own anchor
    base detail, and this is what lets the sheet draw one from the same shells.
    """
    wanted = set(names)
    return ShellAssembly(
        pieces=[p for p in shells.pieces if p.name in wanted],
        warnings=list(shells.warnings),
    )


def bolt_centres(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """Projected centre of each anchor bolt, in `unit_scale` units.

    Read off the geometry rather than the table: whatever the model actually
    contains is what the drawing should dimension.
    """
    m = view_matrix(view)
    out = []
    for piece in shells.pieces:
        if piece.name != "Anchor Bolts":
            continue
        v = (piece.verts @ m.T) * unit_scale
        # Each bolt is one connected cylinder, and they are far apart compared
        # with their own diameter, so a simple quadrant split separates them.
        for sx in (-1, 1):
            for sz in (-1, 1):
                sel = v[(np.sign(v[:, 0]) == sx) & (np.sign(v[:, 1]) == sz)]
                if len(sel):
                    out.append((float(sel[:, 0].mean()), float(sel[:, 1].mean())))
    return out


def component_of(piece_name: str) -> str:
    """Which drawing component a shell piece belongs to."""
    return _COMPONENT_OF.get(piece_name, piece_name)


def _silhouette(verts_in: np.ndarray, tris: np.ndarray):
    """Union of a mesh's projected triangles — its filled 2D profile.

    Back faces project onto the same region as front faces on a closed shell,
    so they are dropped: half the triangles, same union.
    """
    if len(tris) == 0:
        return None
    p0, p1, p2 = verts_in[tris[:, 0]], verts_in[tris[:, 1]], verts_in[tris[:, 2]]
    cross = (p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1]) - (
        p1[:, 1] - p0[:, 1]
    ) * (p2[:, 0] - p0[:, 0])
    keep = np.abs(cross) > 1e-9  # a triangle seen edge-on adds no area
    if not keep.any():
        return None
    rings = np.stack(
        [p0[keep][:, :2], p1[keep][:, :2], p2[keep][:, :2], p0[keep][:, :2]], axis=1
    )
    return unary_union(polygons(rings))


def _ring_segments(geom, out: list) -> None:
    """Append every ring of a (Multi)Polygon as consecutive segments."""
    if geom.is_empty:
        return
    parts = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for poly in parts:
        if not isinstance(poly, Polygon) or poly.is_empty:
            continue
        for ring in (poly.exterior, *poly.interiors):
            pts = list(ring.coords)
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                if (x0, y0) != (x1, y1):
                    out.append((x0, y0, x1, y1))


def component_silhouettes(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """(filled, depth) per component: its 2D profile, and how near it is.

    `depth` is the component's NEAREST point along the view direction, which is
    what orders the components for occlusion.
    """
    m = view_matrix(view)
    grouped: dict[str, list] = {}
    depth: dict[str, float] = {}
    for piece in shells.pieces:
        v = (piece.verts @ m.T) * unit_scale
        key = component_of(piece.name)
        grouped.setdefault(key, []).append((v, piece.tris))
        # +Z of view space points at the camera, so the largest z is nearest.
        depth[key] = max(depth.get(key, -np.inf), float(v[:, 2].max()))

    filled: dict[str, object] = {}
    for key, meshes in grouped.items():
        shapes = [s for s in (_silhouette(v, t) for v, t in meshes) if s is not None]
        if shapes:
            filled[key] = unary_union(shapes)
    return filled, {k: depth[k] for k in filled}


def outlines_by_component(
    shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN
) -> dict[str, list[tuple[float, float, float, float]]]:
    """Each component's visible outline for `view`, keyed by component.

    Components are drawn NEAREST FIRST and each one subtracts everything
    already drawn in front of it, so nothing shows through a solid part. The
    per-component split is what `tests/test_drawing.py` checks the occlusion
    against; the sheet itself just wants the segments.
    """
    filled, depth = component_silhouettes(shells, view, unit_scale)
    out: dict[str, list[tuple[float, float, float, float]]] = {}
    occluded = None
    for key in sorted(filled, key=lambda k: depth[k], reverse=True):
        shape = filled[key]
        visible = shape if occluded is None else shape.difference(occluded)
        visible = visible.simplify(_OUTLINE_TOL_IN)
        segs: list[tuple[float, float, float, float]] = []
        if not visible.is_empty:
            parts = visible.geoms if isinstance(visible, MultiPolygon) else [visible]
            for part in parts:
                if isinstance(part, Polygon) and part.area >= _MIN_FRAGMENT_IN2:
                    _ring_segments(part, segs)
        out[key] = segs
        padded = shape.buffer(_OCCLUDER_PAD_IN, join_style="mitre")
        occluded = padded if occluded is None else unary_union([occluded, padded])
    return out


def project_outlines(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """One outline per component for `view`, with hidden components removed.

    Returns (x0, y0, x1, y1) tuples in `unit_scale` units, like `project_view`.
    """
    return [
        seg for segs in outlines_by_component(shells, view, unit_scale).values()
        for seg in segs
    ]


# ---------------------------------------------------------------------------
# Surface features with hidden-line removal
# ---------------------------------------------------------------------------

#: Depth-raster resolution. 20 px/in resolves a 1/2" step, and the whole front
#: elevation of a 20 ft pole is a 741 x 5471 float32 grid — 16 MB, ~1 s.
_HLR_PX_PER_IN = 20.0

#: How far BEHIND the nearest surface a feature line has to be before it counts
#: as hidden. It absorbs raster quantisation (a pixel straddling a steep depth
#: gradient at a grazing silhouette) without letting an internal part through:
#: a fixture's optics sit inches behind its housing, not thousandths.
_HLR_BIAS_IN = 0.15

#: Visibility is sampled ALONG each edge at this step, never once per edge. The
#: pole's mesh runs one facet edge the whole 20 ft, so a midpoint test called it
#: visible and drew it straight through the base cover.
_HLR_STEP_IN = 0.25

#: Features smaller than this are fastener heads and mesh noise, not drafting
#: information — at 1:30 a 1/8" detail draws four thousandths of an inch wide.
_MIN_FEATURE_IN = 0.15


def _crease_edges(verts_in: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Front-facing crease edges of one mesh: (x0, y0, z0, x1, y1, z1) rows.

    Creases are the surface features a drafter expects — the cast base's steps,
    the cover's rings, the WiLL logo, the fixture's dome seam and skirt bands.
    Silhouettes are NOT included: the outer profile comes from
    `outlines_by_component`, which is cleaner and already occlusion-correct, and
    emitting both would double every profile line.
    """
    if len(tris) == 0:
        return np.zeros((0, 6))
    p0, p1, p2 = verts_in[tris[:, 0]], verts_in[tris[:, 1]], verts_in[tris[:, 2]]
    nrm = np.cross(p1 - p0, p2 - p0)
    lens = np.linalg.norm(nrm, axis=1)
    ok = lens > 1e-15
    nrm[ok] /= lens[ok][:, None]
    facing = nrm[:, 2] > 0.0

    adj: dict[tuple[int, int], list[int]] = {}
    for ti, tri in enumerate(tris):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            key = (int(a), int(b)) if a < b else (int(b), int(a))
            adj.setdefault(key, []).append(ti)

    cos_thresh = np.cos(np.deg2rad(_CREASE_DEG))
    rows: list[tuple[float, ...]] = []
    for (a, b), faces in adj.items():
        if len(faces) == 1:
            keep = bool(facing[faces[0]])
        else:
            f0, f1 = faces[0], faces[1]
            keep = bool(
                facing[f0]
                and facing[f1]
                and float(np.dot(nrm[f0], nrm[f1])) < cos_thresh
            )
        if keep:
            rows.append((*verts_in[a][:3], *verts_in[b][:3]))
    return np.array(rows) if rows else np.zeros((0, 6))


def _depth_raster(meshes, px_per_in: float = _HLR_PX_PER_IN):
    """Nearest-surface depth per pixel over every mesh — a plain z-buffer.

    BOTH triangle windings are rasterised: the shells' winding is not reliable
    (rasterising only "front facing" ones put the base cover's BACK wall in the
    buffer, and the pole then ghosted through it), and "is any surface nearer
    than this line" does not care which way a triangle faces.
    """
    xs = np.concatenate([v[:, 0] for v, _ in meshes])
    ys = np.concatenate([v[:, 1] for v, _ in meshes])
    x0, y0 = float(xs.min()), float(ys.min())
    width = int((float(xs.max()) - x0) * px_per_in) + 2
    height = int((float(ys.max()) - y0) * px_per_in) + 2
    buf = np.full((height, width), -np.inf, dtype=np.float32)

    for verts, tris in meshes:
        if len(tris) == 0:
            continue
        p0, p1, p2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
        cross = (p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1]) - (
            p1[:, 1] - p0[:, 1]
        ) * (p2[:, 0] - p0[:, 0])
        keep = np.abs(cross) > 1e-9  # a triangle seen edge-on covers nothing
        for a, b, c in zip(p0[keep], p1[keep], p2[keep]):
            ix0 = int((min(a[0], b[0], c[0]) - x0) * px_per_in)
            iy0 = int((min(a[1], b[1], c[1]) - y0) * px_per_in)
            ix1 = int((max(a[0], b[0], c[0]) - x0) * px_per_in) + 1
            iy1 = int((max(a[1], b[1], c[1]) - y0) * px_per_in) + 1
            gx = (np.arange(ix0, ix1 + 1) + 0.5) / px_per_in + x0
            gy = (np.arange(iy0, iy1 + 1) + 0.5) / px_per_in + y0
            if gx.size == 0 or gy.size == 0:
                continue
            grid_x, grid_y = np.meshgrid(gx, gy)
            det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
            if abs(det) < 1e-12:
                continue
            w1 = (
                (grid_x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (grid_y - a[1])
            ) / det
            w2 = (
                (b[0] - a[0]) * (grid_y - a[1]) - (grid_x - a[0]) * (b[1] - a[1])
            ) / det
            w0 = 1.0 - w1 - w2
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            depth = w0 * a[2] + w1 * b[2] + w2 * c[2]
            window = buf[iy0 : iy0 + grid_y.shape[0], ix0 : ix0 + grid_x.shape[1]]
            np.maximum(window, np.where(inside, depth, -np.inf), out=window)
    return buf, x0, y0, px_per_in


def _forgiving_depth(buf: np.ndarray) -> np.ndarray:
    """Per-pixel MINIMUM over a 3x3 window.

    A line grazing a curved surface can land in a pixel whose depth was set by
    the nearer side of a steep gradient. Comparing against the nearest-but-one
    neighbourhood keeps that line rather than nibbling holes in every profile.
    """
    height, width = buf.shape
    padded = np.pad(buf, 1, constant_values=-np.inf)
    windows = [
        padded[1 + dy : height + 1 + dy, 1 + dx : width + 1 + dx]
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
    ]
    return np.stack(windows).min(axis=0)


def _visible_runs(edge: np.ndarray, depth_lookup, step_in: float, bias_in: float):
    """Split one edge into the runs of it that are not behind a surface."""
    x0, y0, z0, x1, y1, z1 = edge
    span = float(np.hypot(x1 - x0, y1 - y0))
    n = max(int(span / step_in) + 1, 2)
    t = np.linspace(0.0, 1.0, n)
    xs = x0 + (x1 - x0) * t
    ys = y0 + (y1 - y0) * t
    zs = z0 + (z1 - z0) * t
    visible = zs >= depth_lookup(xs, ys) - bias_in

    runs = []
    start = None
    for i, ok in enumerate(visible):
        if ok and start is None:
            start = i
        elif not ok and start is not None:
            if i - 1 > start:
                runs.append((t[start], t[i - 1]))
            start = None
    if start is not None and n - 1 > start:
        runs.append((t[start], t[n - 1]))
    return [
        (x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)
        for a, b in runs
    ]


def visible_features(
    shells: ShellAssembly,
    view: str,
    unit_scale: float = M_TO_IN,
    min_feature_in: float = _MIN_FEATURE_IN,
    skip: frozenset[str] = frozenset(),
):
    """Surface feature lines for `view`, with the hidden parts removed.

    The lines a drafter wants — cast steps, cover rings, the logo, the dome
    seam — minus everything an intervening surface covers, whether that surface
    belongs to another component or to the same one. This is what keeps the
    fixture's optics, springs and fasteners off the sheet: they are inches
    behind the housing, and the depth raster knows it.

    Pieces named in `skip` still occlude (they stay in the depth raster) but
    emit no edges of their own — the sheet passes the features whose loops
    `feature_line_work` draws deliberately, so the raster's grazing-angle
    fragments cannot double over them.
    """
    m = view_matrix(view)
    meshes = [((piece.verts @ m.T) * unit_scale, piece.tris) for piece in shells.pieces]
    buf, bx, by, ppi = _depth_raster(meshes)
    forgiving = _forgiving_depth(buf)
    height, width = forgiving.shape

    def depth_lookup(xs, ys):
        ix = np.clip(((xs - bx) * ppi).astype(int), 0, width - 1)
        iy = np.clip(((ys - by) * ppi).astype(int), 0, height - 1)
        return forgiving[iy, ix]

    segs: list[tuple[float, float, float, float]] = []
    for piece, (verts, tris) in zip(shells.pieces, meshes):
        if piece.name in skip:
            continue
        edges = _crease_edges(verts, tris)
        if not len(edges):
            continue
        spans = np.hypot(edges[:, 3] - edges[:, 0], edges[:, 4] - edges[:, 1])
        for edge in edges[spans >= min_feature_in]:
            segs.extend(_visible_runs(edge, depth_lookup, _HLR_STEP_IN, _HLR_BIAS_IN))
    return [s for s in segs if np.hypot(s[2] - s[0], s[3] - s[1]) >= min_feature_in]


def project_sheet_lines(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """What the sheet draws: component outlines plus visible surface features."""
    return outlines_by_component(shells, view, unit_scale), simplify(
        visible_features(shells, view, unit_scale)
    )


def fmt_length(value_in: float, denom: int = 16) -> str:
    """Feet-and-inches at 12" and over, plain inches below (Tyler 8/20).

    9.5 -> '9 1/2"' ; 36.9375 -> "3'-0 15/16\"" ; 273.4375 -> "22'-9 7/16\"".
    Nobody reads a pole as 273 1/2 inches. Rounding happens BEFORE the
    feet/inches split, so 11.97" prints 1'-0" rather than 12".
    """
    from math import gcd

    neg = value_in < 0
    ticks = int(round(abs(value_in) * denom))  # length in 1/denom inch
    if ticks < 12 * denom:
        text = fmt_inches(ticks / denom, denom)
    else:
        feet, rest = divmod(ticks, 12 * denom)
        whole, frac = divmod(rest, denom)
        if frac:
            g = gcd(frac, denom)
            text = f"{feet}'-{whole} {frac // g}/{denom // g}\""
        else:
            text = f"{feet}'-{whole}\""
    return f"-{text}" if neg else text


#: Pieces that ride ON the pole and get their own height callout. Accessories
#: (couplings, banner arms, receptacles) arrive named after their catalog part,
#: so anything that is not one of the four majors counts too.
#: "Anchor Bolts" belongs here rather than in the callouts: it IS the pole's
#: base hardware, and a height callout for something sitting on the datum reads
#: as noise.
_MAJOR_PIECES = frozenset({"Pole", "Pole Base", "Anchor Bolts", "Base Cover", "Arm"})


def is_pole_feature(piece_name: str) -> bool:
    """Whether a shell piece is a feature riding ON the pole.

    Multi-arm pieces are named "Arm 1"/"Arm 2", so a set-membership test alone
    would call every arm of a radial cluster a pole feature and give each one
    a height callout.
    """
    return (
        piece_name not in _MAJOR_PIECES
        and not piece_name.startswith("Fixture")
        and not piece_name.startswith("Arm")
    )


def feature_face_view(piece) -> str:
    """The elevation a shaft feature presents widest to — its face-on view.

    A hand hole faces one way; in the other elevation it is an edge-on sliver
    a reader cannot identify, so both its drawn loops and its height callout
    belong on the view that actually shows it.
    """
    widths = {}
    for view in ("front", "side"):
        v = piece.verts @ view_matrix(view).T
        widths[view] = float(v[:, 0].max() - v[:, 0].min())
    return "front" if widths["front"] >= widths["side"] else "side"


def pole_features(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """[(label, y_centre, y_bottom, y_top, face_view)] for pole features.

    Heights are in `unit_scale` units measured from the assembly datum (the
    bottom of the structure), which is what the drawing dimensions them to.
    `face_view` is the elevation that shows the feature face-on — where its
    callout reads against a drawn feature instead of an edge-on sliver.
    """
    m = view_matrix(view)
    out = []
    for piece in shells.pieces:
        if not is_pole_feature(piece.name):
            continue
        v = (piece.verts @ m.T) * unit_scale
        y0, y1 = float(v[:, 1].min()), float(v[:, 1].max())
        out.append((piece.name.upper(), (y0 + y1) / 2.0, y0, y1, feature_face_view(piece)))
    return sorted(out, key=lambda row: row[1])


#: A component must be nearer than a feature by more than this to occlude its
#: drafted loops. Cole's hand hole is a section OF the tube — flush, an exact
#: depth tie with its host — and a tie must not hide the feature the way the
#: whole-component sort otherwise would.
_FLUSH_TIE_IN = 0.05

#: Scraps shorter than this after occlusion clipping are boundary
#: quantisation, not drafting lines.
_FEATURE_LOOP_MIN_IN = 0.02


def feature_line_work(shells: ShellAssembly, view: str, unit_scale: float = M_TO_IN):
    """(segments, boxes, claimed) — pole features drawn DELIBERATELY for `view`.

    The per-pixel HLR loses a flush feature at grazing angles: the hand hole's
    obround sits exactly on the tube surface, where raster quantisation on a
    steep depth gradient ate 74% of its edge length (measured: 3.55 of 13.54
    inches survived). A drawing sheet draws feature outlines on purpose, so
    each feature's crease loops are taken whole from the mesh and clipped only
    by components STRICTLY nearer — the same shapely cut the outlines use.
    Only the feature's face-on elevation draws them; `claimed` names the pieces
    this view now owns, so the raster pass can skip their fragments.

    `boxes` carries (label, x0, y0, x1, y1) per drawn feature for centre marks.
    """
    claimed = frozenset(
        p.name
        for p in shells.pieces
        if is_pole_feature(p.name) and feature_face_view(p) == view
    )
    if not claimed:
        return [], [], claimed
    m = view_matrix(view)
    filled, depth = component_silhouettes(shells, view, unit_scale)
    segs: list[tuple[float, float, float, float]] = []
    boxes: list[tuple[str, float, float, float, float]] = []
    for piece in shells.pieces:
        if piece.name not in claimed:
            continue
        v = (piece.verts @ m.T) * unit_scale
        edges = _crease_edges(v, piece.tris)
        if not len(edges):
            continue
        near = float(v[:, 2].max())
        # The feature's HOST component never occludes it: the feature sits on
        # the host's surface, but the host is depth-sorted as a WHOLE, so the
        # anchor base's near corner (4.3" out) would otherwise count the
        # entire pole component as "in front of" a hand hole flush with the
        # tube at 2.0".
        host = component_of(piece.name)
        occluders = [
            filled[key].buffer(_OCCLUDER_PAD_IN, join_style="mitre")
            for key in filled
            if key != host and depth[key] > near + _FLUSH_TIE_IN
        ]
        drawn: list[tuple[float, float, float, float]] = []
        blocker = unary_union(occluders) if occluders else None
        for x0, y0, _z0, x1, y1, _z1 in edges:
            if x0 == x1 and y0 == y1:
                continue
            geom = LineString(((x0, y0), (x1, y1)))
            if blocker is not None:
                geom = geom.difference(blocker)
            parts = getattr(geom, "geoms", [geom])
            for part in parts:
                if isinstance(part, LineString) and part.length >= _FEATURE_LOOP_MIN_IN:
                    pts = list(part.coords)
                    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                        drawn.append((ax, ay, bx, by))
        if drawn:
            segs.extend(drawn)
            boxes.append(
                (
                    piece.name.upper(),
                    float(v[:, 0].min()),
                    float(v[:, 1].min()),
                    float(v[:, 0].max()),
                    float(v[:, 1].max()),
                )
            )
    return segs, boxes, claimed
