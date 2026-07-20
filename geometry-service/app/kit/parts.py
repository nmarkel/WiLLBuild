"""Concept-level B-rep solid builders for every catalog part.

Conventions
-----------
* Catalog placeholder specs are in METERS with +Y up (viewer convention).
* build123d works in +Z up.  We convert: catalog meters -> mm (x1000) and map
  viewer ``(x, y, z)`` -> CAD ``(x, z, y)`` so viewer +Y becomes CAD +Z.
* Every builder returns a ``build123d`` ``Part`` whose origin is the part's lower
  attachment point, +Z up, dimensions in mm.

Fidelity bar is concept-level (overall form, correct dims, correct mounting
interfaces) — not manufacturing geometry.  We prefer robust simple solids over
fillet fights.
"""

from __future__ import annotations

from build123d import (
    Align,
    Axis,
    Box,
    BuildLine,
    BuildPart,
    BuildSketch,
    Circle,
    Cone,
    FilletPolyline,
    Plane,
    Polyline,
    RegularPolygon,
    loft,
    make_face,
    revolve,
    sweep,
)

M = 1000.0  # catalog meters -> mm


def viewer_to_cad(p: list[float]) -> tuple[float, float, float]:
    """Map viewer ``[x, y, z]`` (meters, +Y up) to CAD mm ``(x, z, y)`` (+Z up)."""
    x, y, z = p
    return (x * M, z * M, y * M)


# ---------------------------------------------------------------------------
# Tapered cylinders: poles, base covers, direct-mount tenon adapter
# ---------------------------------------------------------------------------

def _tapered_cylinder(radius_bottom_m: float, radius_top_m: float, height_m: float):
    """Loft between a bottom and top circle; origin at base, +Z up."""
    rb, rt, h = radius_bottom_m * M, radius_top_m * M, height_m * M
    with BuildPart() as bp:
        with BuildSketch(Plane.XY):
            Circle(rb)
        with BuildSketch(Plane.XY.offset(h)):
            Circle(rt)
        loft()
    return bp.part


def build_pole(p: dict):
    """Tapered aluminium pole from placeholder radii/height."""
    ph = p["placeholder"]
    return _tapered_cylinder(ph["radiusBottomM"], ph["radiusTopM"], ph["heightM"])


def build_base_cover(p: dict):
    """Base cover: tapered shell.  'fluted' gets 12 shallow cosmetic flutes."""
    ph = p["placeholder"]
    solid = _tapered_cylinder(ph["radiusBottomM"], ph["radiusTopM"], ph["heightM"])
    if "fluted" in p.get("id", ""):
        solid = _add_flutes(solid, ph)
    return solid


def _add_flutes(solid, ph: dict):
    """Subtract 12 slender vertical rods around the surface (cosmetic flutes)."""
    import math

    from build123d import Cylinder, Location, Rotation

    n = 12
    h = ph["heightM"] * M
    r_mid = ((ph["radiusTopM"] + ph["radiusBottomM"]) / 2.0) * M
    flute_r = min(r_mid * 0.12, 12.0)
    cut = solid
    for i in range(n):
        ang = 2 * math.pi * i / n
        x, y = r_mid * math.cos(ang), r_mid * math.sin(ang)
        rod = Location((x, y, h / 2.0)) * Cylinder(flute_r, h)
        cut = cut - rod
    return cut


# ---------------------------------------------------------------------------
# Arms: sweep a circle along a spline through placeholder.points
# ---------------------------------------------------------------------------

def build_arm(p: dict):
    """Sweep a circular section along the polyline of ``placeholder.points``.

    Substitution note: a ``Spline`` through the control points overshoots the
    point envelope (bulging the tube ~5-8 cm above the shepherd's-hook apex and,
    at tight bends, self-intersecting into a negative-volume solid).  We sweep a
    ``FilletPolyline`` instead — straight segments with small corner fillets
    (1.5x the tube radius).  This keeps the tube inside its control-point
    envelope, matches the socket geometry, and stays robust.

    The direct-mount pseudo-arm is a small tenon adapter cylinder (kind 'pole').
    """
    ph = p["placeholder"]
    if ph["kind"] == "pole":
        return _tapered_cylinder(ph["radiusBottomM"], ph["radiusTopM"], ph["heightM"])

    r = ph["radiusM"] * M
    cad = [viewer_to_cad(pt) for pt in ph["points"]]
    # tangent at the start for the sweep-section orientation
    d = (cad[1][0] - cad[0][0], cad[1][1] - cad[0][1], cad[1][2] - cad[0][2])
    with BuildPart() as bp:
        with BuildLine() as ln:
            FilletPolyline(*cad, radius=r * 1.5)
        with BuildSketch(Plane(origin=cad[0], z_dir=d)):
            Circle(r)
        sweep(path=ln.line)
    return bp.part


# ---------------------------------------------------------------------------
# Fixtures: dispatch on placeholder kind
# ---------------------------------------------------------------------------

def build_fixture_lathe(profile: list[list[float]]):
    """Revolve a (radius, height) profile about the vertical axis.

    Points are closed back to the axis; consecutive duplicates are dropped so a
    profile that already ends on the axis (e.g. DRX ``[0, 0.53]``) is valid.
    """
    pts = [(r * M, y * M) for r, y in profile]
    seq = pts + [(0.0, pts[-1][1]), (0.0, pts[0][1])]
    ded = [seq[0]]
    for q in seq[1:]:
        if abs(q[0] - ded[-1][0]) > 1e-6 or abs(q[1] - ded[-1][1]) > 1e-6:
            ded.append(q)
    with BuildPart() as bp:
        with BuildSketch(Plane.XZ):
            with BuildLine():
                Polyline(*ded, close=True)
            make_face()
        revolve(axis=Axis.Z)
    return bp.part


def _build_prism(spec: dict):
    """Regular-polygon loft between bottom and top faces; origin at base."""
    rb, rt, h = spec["radiusBottomM"] * M, spec["radiusTopM"] * M, spec["heightM"] * M
    sides = spec["sides"]
    with BuildPart() as bp:
        with BuildSketch(Plane.XY):
            RegularPolygon(radius=rb, side_count=sides)
        with BuildSketch(Plane.XY.offset(h)):
            RegularPolygon(radius=rt, side_count=sides)
        loft()
    return bp.part


def _build_cone(spec: dict):
    """Cone finial; origin at base, apex up."""
    r, h = spec["radiusM"] * M, spec["heightM"] * M
    with BuildPart() as bp:
        Cone(
            bottom_radius=r,
            top_radius=0,
            height=h,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        )
    return bp.part


def _build_group_child(spec: dict):
    """Build a single group child by its inner kind."""
    kind = spec["kind"]
    if kind in ("baseCover", "pole"):
        return _tapered_cylinder(spec["radiusBottomM"], spec["radiusTopM"], spec["heightM"])
    if kind == "prism":
        return _build_prism(spec)
    if kind == "cone":
        return _build_cone(spec)
    if kind == "box":
        return _build_box(spec)
    if kind == "lathe":
        return build_fixture_lathe(spec["profile"])
    raise ValueError(f"unknown group child kind: {kind!r}")


def build_fixture_group(children: list[dict]):
    """Union of group children, each translated by its viewer position."""
    from build123d import Location

    solid = None
    for child in children:
        part_solid = _build_group_child(child["spec"])
        placed = Location(viewer_to_cad(child["position"])) * part_solid
        solid = placed if solid is None else solid + placed
    return solid


def _build_box(spec: dict):
    """Rectangular fixture housing; origin at the base center (viewer y-up -> CAD z-up)."""
    w, h, d = (v * M for v in spec["sizeM"])
    with BuildPart() as bp:
        Box(w, d, h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return bp.part


def build_fixture(p: dict):
    """Fixture dispatch on placeholder kind: lathe -> revolve, group -> union, box -> housing."""
    ph = p["placeholder"]
    kind = ph["kind"]
    if kind == "lathe":
        return build_fixture_lathe(ph["profile"])
    if kind == "group":
        return build_fixture_group(ph["children"])
    if kind == "box":
        return _build_box(ph)
    raise ValueError(f"unknown fixture kind: {kind!r}")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def build_part(p: dict):
    """Build any catalog part, dispatching on its slot."""
    slot = p["slot"]
    if slot == "pole":
        return build_pole(p)
    if slot == "baseCover":
        return build_base_cover(p)
    if slot == "arm":
        return build_arm(p)
    if slot == "fixture":
        return build_fixture(p)
    raise ValueError(f"unknown slot: {slot!r}")
