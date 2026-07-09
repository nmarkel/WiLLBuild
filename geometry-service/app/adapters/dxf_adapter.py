"""DXF adapter — Route 1: direct silhouette from catalog placeholder data.

This is the *default* DXF route (DXF_ROUTE=direct).  It computes a front
elevation of the pole assembly using 2D math on the catalog placeholder
specifications — NO build123d import at runtime.  The silhouette is:

  - Pole: trapezoid (radiusBottom left/right, tapering to radiusTop)
  - Base cover: trapezoid, placed at Z=0 (overlapping pole base)
  - Arm: polyline connecting placeholder.points, offset left/right by
    the tube radius to give a visible width
  - Fixture: outline built from the profile (lathe) or bounding box (group)

All coordinates in mm (1 catalog meter = 1000 mm).
viewer +Y up → DXF Y up; viewer X → DXF X.

DIMENSION entities (≥5) are drawn from ctx.assembly.dims:
  1. Overall height
  2. Pole height
  3. Mounting height
  4. Arm reach
  5. Base diameter

Both routes (direct / projection) share app.titleblock.draw for the
WiLL title block — the swap boundary is here in the silhouette only.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import ezdxf
from ezdxf.colors import rgb2int

from app.naming import base_name
from app.titleblock import GUNMETAL, draw as draw_titleblock

from .base import Adapter, GenContext

if TYPE_CHECKING:
    pass

M = 1000.0  # catalog meters → mm


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

class DxfAdapter:
    """Route 1: silhouette polylines from catalog placeholder data."""

    format: str = "dxf"

    def available(self) -> bool:
        """ezdxf is a hard dependency; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        if ctx.assembly is None:
            raise RuntimeError("DxfAdapter requires ctx.assembly")

        doc = ezdxf.new(dxfversion="R2010")
        msp = doc.modelspace()

        _draw_silhouette(msp, ctx)
        _draw_dimensions(msp, ctx)
        draw_titleblock(msp, ctx)

        out_path = ctx.out_dir / f"{ctx.base_name}.dxf"
        doc.saveas(str(out_path))
        return [out_path]


# ---------------------------------------------------------------------------
# Silhouette geometry helpers
# ---------------------------------------------------------------------------

def _viewer_to_dxf(x_m: float, y_m: float) -> tuple[float, float]:
    """Convert viewer X,Y (meters, +Y up) to DXF X,Y (mm, +Y up)."""
    return x_m * M, y_m * M


def _add_closed_poly(msp, points: list[tuple[float, float]], color: int) -> None:
    poly = msp.add_lwpolyline(points, close=True)
    poly.dxf.true_color = color


def _add_open_poly(msp, points: list[tuple[float, float]], color: int) -> None:
    if len(points) < 2:
        return
    poly = msp.add_lwpolyline(points, close=False)
    poly.dxf.true_color = color


def _trapezoid_silhouette(
    base_y_m: float,
    top_y_m: float,
    radius_bottom_m: float,
    radius_top_m: float,
) -> list[tuple[float, float]]:
    """Return four corners of a vertical trapezoid in mm.

    Bottom-left, top-left, top-right, bottom-right (CCW).
    """
    by = base_y_m * M
    ty = top_y_m * M
    rb = radius_bottom_m * M
    rt = radius_top_m * M
    return [(-rb, by), (-rt, ty), (rt, ty), (rb, by)]


# ---------------------------------------------------------------------------
# Per-slot silhouette builders
# ---------------------------------------------------------------------------

def _draw_pole(msp, pole: dict, arm_y_m: float | None) -> None:
    """Draw pole trapezoid silhouette."""
    ph = pole["placeholder"]
    pts = _trapezoid_silhouette(0.0, ph["heightM"], ph["radiusBottomM"], ph["radiusTopM"])
    _add_closed_poly(msp, pts, GUNMETAL)


def _draw_base_cover(msp, bc: dict) -> None:
    """Draw base cover trapezoid silhouette (at Z=0)."""
    ph = bc["placeholder"]
    pts = _trapezoid_silhouette(0.0, ph["heightM"], ph["radiusBottomM"], ph["radiusTopM"])
    _add_closed_poly(msp, pts, GUNMETAL)


def _arm_tube_silhouette(
    points_m: list[list[float]],
    radius_m: float,
    offset_y_m: float = 0.0,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    """Return two parallel polylines (top/bottom) offsetting the arm centreline.

    The arm placeholder points are in viewer space (x, y, z) but all arms
    lie in the XY plane (z=0).  We project to DXF XY and offset by ±radius
    in Y.
    """
    r = radius_m * M
    top: list[tuple[float, float]] = []
    bot: list[tuple[float, float]] = []
    for pt in points_m:
        x, y = pt[0], pt[1]
        dx, dy = x * M, (y + offset_y_m) * M
        top.append((dx, dy + r))
        bot.append((dx, dy - r))
    return top, bot


def _draw_arm(msp, arm: dict, arm_y_m: float) -> None:
    """Draw arm tube silhouette offset by tube radius."""
    ph = arm["placeholder"]
    if ph["kind"] == "pole":
        # direct-mount tenon adapter — draw as a small trapezoid
        pts = _trapezoid_silhouette(
            arm_y_m,
            arm_y_m + ph["heightM"],
            ph["radiusBottomM"],
            ph["radiusTopM"],
        )
        _add_closed_poly(msp, pts, GUNMETAL)
        return

    pts = ph["points"]
    r = ph["radiusM"]
    top, bot = _arm_tube_silhouette(pts, r, arm_y_m)
    # Draw outline: top polyline + reversed bottom to close
    outline = top + list(reversed(bot))
    _add_closed_poly(msp, outline, GUNMETAL)


def _draw_fixture_lathe(msp, fixture: dict, fx_world_y_m: float) -> None:
    """Draw lathe fixture as a symmetric outline from its revolve profile."""
    ph = fixture["placeholder"]
    profile = ph["profile"]  # list of [r, y]
    # Right side: profile as given
    right: list[tuple[float, float]] = []
    for r_m, y_m in profile:
        right.append((r_m * M, (fx_world_y_m + y_m) * M))
    # Left side: mirror, reversed
    left = [(-x, y) for x, y in reversed(right)]
    # Close: add bottom closure
    outline = right + left
    _add_closed_poly(msp, outline, GUNMETAL)


def _draw_fixture_group(msp, fixture: dict, fx_world_y_m: float) -> None:
    """Draw group fixture as bounding box silhouette."""
    ph = fixture["placeholder"]
    children = ph["children"]
    # Collect all bounding points
    all_pts: list[tuple[float, float]] = []
    for child in children:
        spec = child["spec"]
        pos = child["position"]  # viewer [x, y, z]
        child_y = fx_world_y_m + pos[1]
        kind = spec.get("kind")
        if kind in ("baseCover", "pole"):
            rb = spec["radiusBottomM"]
            rt = spec["radiusTopM"]
            h = spec["heightM"]
            all_pts += [
                (-rb * M, child_y * M),
                (rb * M, child_y * M),
                (-rt * M, (child_y + h) * M),
                (rt * M, (child_y + h) * M),
            ]
        elif kind == "prism":
            rb = spec["radiusBottomM"]
            h = spec["heightM"]
            all_pts += [
                (-rb * M, child_y * M),
                (rb * M, child_y * M),
                (-rb * M, (child_y + h) * M),
                (rb * M, (child_y + h) * M),
            ]
        elif kind == "cone":
            r = spec["radiusM"]
            h = spec["heightM"]
            all_pts += [
                (-r * M, child_y * M),
                (r * M, child_y * M),
                (0, (child_y + h) * M),
            ]
    if not all_pts:
        return
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    bbox = [
        (min(xs), min(ys)),
        (max(xs), min(ys)),
        (max(xs), max(ys)),
        (min(xs), max(ys)),
    ]
    _add_closed_poly(msp, bbox, GUNMETAL)


def _draw_silhouette(msp, ctx: GenContext) -> None:
    """Draw all part silhouettes into msp."""
    catalog = ctx.catalog
    cfg = ctx.cfg
    asm = ctx.assembly

    def _part(part_id: str) -> dict:
        for p in catalog["parts"]:
            if p["id"] == part_id:
                return p
        raise KeyError(f"Unknown part: {part_id!r}")

    pole = _part(cfg.pole)
    bc = _part(cfg.baseCover)
    arm = _part(cfg.arm)
    fixture = _part(cfg.fixture)

    # arm world Y (meters) from dims
    # mounting_height is in mm — convert back to meters for silhouette
    arm_origin_y_m = asm.dims.pole_height / M  # top of pole (mm→m)
    # The arm attaches at the pole top socket — same as arm_origin in assembly
    # For the silhouette we just need the arm's mount Y.  Use pole top socket.
    pole_sockets = pole.get("sockets", {})
    # Find the socket that hosts this arm
    arm_mount = arm.get("mount")
    arm_y_m = 0.0
    if arm_mount:
        for sock in pole_sockets.values():
            if sock.get("type") == arm_mount:
                arm_y_m = sock["position"][1]  # viewer Y (meters)
                break

    # fixture world Y from assembly dims (mm → m)
    fx_world_y_m = 0.0
    arm_sockets = arm.get("sockets", {})
    fx_mount = fixture.get("mount")
    if fx_mount:
        for sock in arm_sockets.values():
            if sock.get("type") == fx_mount:
                fx_sock_y = sock["position"][1]  # local Y on arm
                fx_world_y_m = arm_y_m + fx_sock_y
                break
    else:
        fx_world_y_m = arm_y_m

    _draw_base_cover(msp, bc)
    _draw_pole(msp, pole, arm_y_m)
    _draw_arm(msp, arm, arm_y_m)

    fx_ph = fixture["placeholder"]
    if fx_ph["kind"] == "lathe":
        _draw_fixture_lathe(msp, fixture, fx_world_y_m)
    elif fx_ph["kind"] == "group":
        _draw_fixture_group(msp, fixture, fx_world_y_m)


# ---------------------------------------------------------------------------
# Dimension entities
# ---------------------------------------------------------------------------

def _add_linear_dim(
    msp,
    start: tuple[float, float],
    end: tuple[float, float],
    dim_x: float,
    measurement_value: float,
    angle: float = 90.0,
) -> None:
    """Add a LinearDimension entity.

    Parameters
    ----------
    start, end:
        The two definition points (mm) being dimensioned.
    dim_x:
        X position of the dimension line.
    measurement_value:
        Explicit measurement override (mm).
    angle:
        Dimension line angle (90 = vertical, 0 = horizontal).
    """
    dim_style = msp.add_linear_dim(
        base=(dim_x, (start[1] + end[1]) / 2.0),
        p1=start,
        p2=end,
        angle=angle,
        override={"dimtxt": 3.0, "dimasz": 2.5},
    )
    # Set actual_measurement on the underlying Dimension entity BEFORE render
    # so ezdxf persists it in the DXF file.
    dim_style.dimension.dxf.actual_measurement = measurement_value
    dim_style.render()


def _draw_dimensions(msp, ctx: GenContext) -> None:
    """Draw ≥5 dimension entities (all mm) from ctx.assembly.dims."""
    dims = ctx.assembly.dims
    asm = ctx.assembly

    # Position dimension lines to the right of the silhouette (elevation area)
    # Silhouette is centred near X=0; dim lines at X = arm_reach + margin
    from app.titleblock import BLOCK_X
    max_x = dims.arm_reach + 100.0  # 100 mm margin right of arm reach
    # Keep within elevation area (BLOCK_X - 20 mm)
    dim_x_right = min(max_x, BLOCK_X - 20.0)
    dim_x_left = -(dims.base_diameter / 2.0 + 60.0)

    # 1. Overall height (vertical, right of assembly)
    _add_linear_dim(
        msp,
        start=(dim_x_right, 0.0),
        end=(dim_x_right, dims.overall_height),
        dim_x=dim_x_right + 30.0,
        measurement_value=dims.overall_height,
        angle=90.0,
    )

    # 2. Pole height (vertical, right — shorter)
    _add_linear_dim(
        msp,
        start=(dim_x_right - 20.0, 0.0),
        end=(dim_x_right - 20.0, dims.pole_height),
        dim_x=dim_x_right + 10.0,
        measurement_value=dims.pole_height,
        angle=90.0,
    )

    # 3. Mounting height (vertical, left of assembly)
    _add_linear_dim(
        msp,
        start=(dim_x_left, 0.0),
        end=(dim_x_left, dims.mounting_height),
        dim_x=dim_x_left - 30.0,
        measurement_value=dims.mounting_height,
        angle=90.0,
    )

    # 4. Arm reach (horizontal, at arm level)
    arm_y_dim = dims.mounting_height
    _add_linear_dim(
        msp,
        start=(0.0, arm_y_dim),
        end=(dims.arm_reach, arm_y_dim),
        dim_x=dims.arm_reach / 2.0,
        measurement_value=dims.arm_reach,
        angle=0.0,
    )

    # 5. Base diameter (horizontal, at ground level)
    half_bd = dims.base_diameter / 2.0
    _add_linear_dim(
        msp,
        start=(-half_bd, -40.0),
        end=(half_bd, -40.0),
        dim_x=0.0,
        measurement_value=dims.base_diameter,
        angle=0.0,
    )
