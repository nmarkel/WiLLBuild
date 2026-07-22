"""Socket-driven assembly composer.

Positions each part by walking the same socket data the viewer uses — no
hardcoded offsets.  Chain (viewer +Y up; all math here in CAD mm, +Z up):

    pole      at origin
    baseCover at the pole socket whose type == baseCover.mount
    arm       at the pole socket whose type == arm.mount
    fixture   at the arm socket whose type == fixture.mount

Each downstream part's origin is translated to the world position of the
socket that hosts it (parent world origin + socket offset).
"""

from __future__ import annotations

from dataclasses import dataclass

from build123d import Location, Part

from app.catalog import part
from app.models import PoleConfig

from .parts import build_part, viewer_to_cad


@dataclass
class AssemblyDims:
    """Everything the DXF/PDF adapters need — all in mm."""

    overall_height: float
    pole_height: float
    mounting_height: float  # fixture light/attach height above ground
    arm_reach: float
    base_diameter: float


@dataclass
class BuiltAssembly:
    solid: Part  # single fused solid, mm, sitting on Z=0
    parts: list[tuple[str, Part]]  # (part_id, positioned solid)
    dims: AssemblyDims


def _socket_for_mount(host: dict, mount: str | None):
    """Return (name, socket) of the host socket whose type == mount, else None."""
    if mount is None:
        return None
    for name, sock in host.get("sockets", {}).items():
        if sock.get("type") == mount:
            return name, sock
    return None


def _place(solid: Part, world_origin_mm: tuple[float, float, float]) -> Part:
    """Translate a part so its local origin sits at ``world_origin_mm``."""
    return Location(world_origin_mm) * solid


def _base_radius_m(spec: dict) -> float:
    """Ground-level radius of a placeholder spec (group specs take the widest
    child sitting at the base) — feeds the drawing's base-diameter callout."""
    kind = spec.get("kind")
    if kind in ("pole", "baseCover", "prism"):
        return spec["radiusBottomM"]
    if kind == "box":
        return spec["sizeM"][0] / 2.0
    if kind == "cone":
        return spec["radiusM"]
    if kind == "lathe":
        return max(r for r, _ in spec["profile"])
    if kind == "group":
        ground = [c for c in spec["children"] if abs(c["position"][1]) < 0.05]
        return max((_base_radius_m(c["spec"]) for c in (ground or spec["children"])), default=0.1)
    return 0.1


def build_assembly(catalog: dict, cfg: PoleConfig) -> BuiltAssembly:
    """Compose a fused assembly solid from a validated PoleConfig."""
    pole = part(catalog, cfg.pole)
    base_cover = part(catalog, cfg.baseCover) if cfg.baseCover else None
    arm = part(catalog, cfg.arm)
    fixture = part(catalog, cfg.fixture)

    placed: list[tuple[str, Part]] = []

    # --- Pole at origin ---
    pole_solid = _place(build_part(pole), (0.0, 0.0, 0.0))
    placed.append((pole["id"], pole_solid))

    # --- Base cover (optional) at the pole socket matching its mount ---
    if base_cover is not None:
        bc_hit = _socket_for_mount(pole, base_cover.get("mount"))
        bc_origin = viewer_to_cad(bc_hit[1]["position"]) if bc_hit else (0.0, 0.0, 0.0)
        bc_solid = _place(build_part(base_cover), bc_origin)
        placed.append((base_cover["id"], bc_solid))

    # --- Arm at the pole socket matching the arm mount ---
    arm_hit = _socket_for_mount(pole, arm.get("mount"))
    arm_origin = viewer_to_cad(arm_hit[1]["position"]) if arm_hit else (0.0, 0.0, 0.0)
    arm_local = build_part(arm)
    arm_solid = _place(arm_local, arm_origin)
    placed.append((arm["id"], arm_solid))

    # --- Fixture at the arm socket matching the fixture mount ---
    fx_hit = _socket_for_mount(arm, fixture.get("mount"))
    if fx_hit is None:
        # No matching arm socket: mount directly at the arm origin.
        fx_socket_local = (0.0, 0.0, 0.0)
    else:
        fx_socket_local = viewer_to_cad(fx_hit[1]["position"])
    fx_world = (
        arm_origin[0] + fx_socket_local[0],
        arm_origin[1] + fx_socket_local[1],
        arm_origin[2] + fx_socket_local[2],
    )
    fx_solid = _place(build_part(fixture), fx_world)
    placed.append((fixture["id"], fx_solid))

    # --- Fuse ---
    fused = pole_solid
    for _pid, s in placed[1:]:
        fused = fused + s

    dims = _compute_dims(
        catalog, cfg, fused, arm_solid, arm_origin, fx_world, fixture, pole
    )
    return BuiltAssembly(solid=fused, parts=placed, dims=dims)


def _compute_dims(
    catalog: dict,
    cfg: PoleConfig,
    fused: Part,
    arm_solid: Part,
    arm_origin: tuple[float, float, float],
    fx_world: tuple[float, float, float],
    fixture: dict,
    pole: dict,
) -> AssemblyDims:
    """Derive AssemblyDims (mm) from the built geometry + catalog data."""
    bb = fused.bounding_box()
    overall_height = bb.max.Z

    pole_top = pole["sockets"]["top"]["position"][1] * 1000.0

    # arm_reach: max horizontal (X) extent of the arm solid.
    arm_bb = arm_solid.bounding_box()
    arm_reach = max(abs(arm_bb.max.X), abs(arm_bb.min.X))

    # mounting_height: fixture light/attach height above ground (world Z of the
    # fixture's lightOffset when present, else the fixture mount point).
    light = fixture.get("lightOffset")
    if light is not None:
        mounting_height = fx_world[2] + light[1] * 1000.0
    else:
        mounting_height = fx_world[2]

    # Base diameter from the base cover when present, else the pole's own base
    if cfg.baseCover:
        base_cover = part(catalog, cfg.baseCover)
        base_diameter = _base_radius_m(base_cover["placeholder"]) * 2.0 * 1000.0
    else:
        pole_part_dims = part(catalog, cfg.pole)
        base_diameter = _base_radius_m(pole_part_dims["placeholder"]) * 2.0 * 1000.0

    return AssemblyDims(
        overall_height=overall_height,
        pole_height=pole_top,
        mounting_height=mounting_height,
        arm_reach=arm_reach,
        base_diameter=base_diameter,
    )
