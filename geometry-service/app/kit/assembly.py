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

from build123d import Location, Part, Rotation

from app.catalog import part
from app.models import PoleConfig

from .parts import build_part, viewer_to_cad


# Phase 0.10 (Workstream A): mount azimuths for a radial arm arrangement, per the
# WiLLstudio ordering matrix — arms sit on a 90-degree DRILLED TENON, so a triple
# is 3@90 with one leg empty, NOT the 120-degree spacing Phase 0.8 assumed.
# Mirrors DRILLED_TENON_AZIMUTHS in src/lib/compat.ts — keep the two in sync.
_DRILLED_TENON_AZIMUTHS: dict[int, list[float]] = {
    1: [0.0],
    2: [0.0, 180.0],
    3: [0.0, 90.0, 180.0],
    4: [0.0, 90.0, 180.0, 270.0],
}


def _arm_azimuths(count: int) -> list[float]:
    """Mount azimuths (degrees) for ``count`` radial arms.

    Matches the frontend ``armAzimuths``.  Position 0 deg is the single-arm
    reference direction, so azimuths[0] is always 0 — arm 0 is placed unrotated
    and is byte-identical to the pre-0.8 single-arm output.  Counts outside the
    drilled-tenon vocabulary fall back to even spacing.
    """
    n = max(1, int(count))
    return _DRILLED_TENON_AZIMUTHS.get(n) or [i * 360.0 / n for i in range(n)]


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

    # Phase 0.10 ingest: a component's resolved Design code selects Engineering's
    # real CAD for exactly that SKU when it is present locally (app/realgeom.py).
    def _design(part_obj: dict | None) -> str | None:
        if part_obj is None:
            return None
        try:
            from app.partnumber import design_code_for

            return design_code_for(catalog, cfg, part_obj["id"])
        except Exception:  # noqa: BLE001 — part numbers must never break geometry
            return None

    placed: list[tuple[str, Part]] = []

    # --- Pole at origin ---
    pole_solid = _place(build_part(pole, _design(pole)), (0.0, 0.0, 0.0))
    placed.append((pole["id"], pole_solid))

    # --- Base cover (optional) at the pole socket matching its mount ---
    if base_cover is not None:
        bc_hit = _socket_for_mount(pole, base_cover.get("mount"))
        bc_origin = viewer_to_cad(bc_hit[1]["position"]) if bc_hit else (0.0, 0.0, 0.0)
        bc_solid = _place(build_part(base_cover, _design(base_cover)), bc_origin)
        placed.append((base_cover["id"], bc_solid))

    # --- Arm(s) + fixture(s): N arms mounted radially around the pole top ---
    #
    # The arm mounts at the pole socket, which lies ON the pole's vertical axis
    # (CAD X=Y=0, +Z up).  For arm i at azimuth θ = i*360/armCount we rotate the
    # placed arm (and its fixture) about the CAD +Z axis — the pole axis — so the
    # mount point is rotation-invariant.  Viewer +Y maps to CAD +Z, so a viewer
    # Y-rotation is a CAD Z-rotation with the SAME angle and sign.
    #
    # Sign: the frontend rotateY(offset, θ) gives (in viewer axes)
    #   x' = x·cosθ + z·sinθ,  z' = -x·sinθ + z·cosθ.
    # Mapping viewer→CAD (x,y,z)->(x,z,y) turns that into a CAD +Z rotation of
    #   cx' = cx·cosθ + cy·sinθ,  cy' = -cx·sinθ + cy·cosθ,
    # which is build123d ``Rotation(0, 0, -θ)`` (right-handed Rz(-θ)).  arm 0
    # (θ=0) is left unrotated, so armCount=1 stays byte-identical to pre-0.8.
    arm_hit = _socket_for_mount(pole, arm.get("mount"))
    arm_origin = viewer_to_cad(arm_hit[1]["position"]) if arm_hit else (0.0, 0.0, 0.0)

    fx_hit = _socket_for_mount(arm, fixture.get("mount"))
    if fx_hit is None:
        # No matching arm socket: mount directly at the arm origin.
        fx_socket_local = (0.0, 0.0, 0.0)
    else:
        fx_socket_local = viewer_to_cad(fx_hit[1]["position"])
    # Fixture world position of the unrotated (θ=0) arm; Z is azimuth-invariant.
    fx_world = (
        arm_origin[0] + fx_socket_local[0],
        arm_origin[1] + fx_socket_local[1],
        arm_origin[2] + fx_socket_local[2],
    )

    arm_design = _design(arm)
    fixture_design = _design(fixture)
    azimuths = _arm_azimuths(cfg.armCount)
    single = len(azimuths) == 1
    arm_solids: list[Part] = []
    for i, deg in enumerate(azimuths):
        rot = None if deg == 0 else Rotation(0.0, 0.0, -deg)

        arm_solid = _place(build_part(arm, arm_design), arm_origin)
        if rot is not None:
            arm_solid = rot * arm_solid
        arm_solids.append(arm_solid)
        placed.append((arm["id"] if single else f"{arm['id']}#{i}", arm_solid))

        fx_solid = _place(build_part(fixture, fixture_design), fx_world)
        if rot is not None:
            fx_solid = rot * fx_solid
        placed.append((fixture["id"] if single else f"{fixture['id']}#{i}", fx_solid))

    # --- Banner arm (optional, Phase 0.8 C) ---
    # A mid-shaft bracket set mounted on the pole axis at a parametric shaft
    # height, repeated on `count` radial sides with the SAME azimuth set and
    # Rz(-θ) rotation as the arms above (viewer +Y up → CAD +Z up, so the shaft
    # height is the CAD +Z coordinate).  The banner origin is its shaft mount
    # point, so it lies on the pole axis and rotation about +Z keeps it there.
    banner_solids: list[Part] = []
    if cfg.banner is not None:
        try:
            banner = part(catalog, cfg.banner.armId)
        except KeyError:
            banner = None
        if banner is not None:
            height_mm = cfg.banner.heightFt * 304.8  # ft → mm (0.3048 m × 1000)
            banner_origin = (0.0, 0.0, height_mm)
            for i, deg in enumerate(_arm_azimuths(cfg.banner.count)):
                rot = None if deg == 0 else Rotation(0.0, 0.0, -deg)
                b_solid = _place(build_part(banner, _design(banner)), banner_origin)
                if rot is not None:
                    b_solid = rot * b_solid
                banner_solids.append(b_solid)
                placed.append((f"{banner['id']}#{i}", b_solid))

    # --- Fuse ---
    fused = pole_solid
    for _pid, s in placed[1:]:
        fused = fused + s

    dims = _compute_dims(
        catalog, cfg, fused, arm_solids, fx_world, fixture, pole, banner_solids
    )
    return BuiltAssembly(solid=fused, parts=placed, dims=dims)


def _compute_dims(
    catalog: dict,
    cfg: PoleConfig,
    fused: Part,
    arm_solids: list[Part],
    fx_world: tuple[float, float, float],
    fixture: dict,
    pole: dict,
    banner_solids: list[Part] | None = None,
) -> AssemblyDims:
    """Derive AssemblyDims (mm) from the built geometry + catalog data."""
    bb = fused.bounding_box()
    overall_height = bb.max.Z

    pole_top = pole["sockets"]["top"]["position"][1] * 1000.0

    # arm_reach: max horizontal distance from the pole axis.
    # Single arm (byte-identical to pre-0.8): max |X| of the single arm bbox.
    # Radial arms extend on multiple horizontal axes, so we take the widest
    # |X|/|Y| bbox extent across ALL placed arms (each is the same reach, just
    # rotated, so this recovers the same magnitude while staying correct if the
    # arm geometry is asymmetric).
    arm_bb = arm_solids[0].bounding_box()
    if len(arm_solids) == 1:
        arm_reach = max(abs(arm_bb.max.X), abs(arm_bb.min.X))
    else:
        arm_reach = 0.0
        for s in arm_solids:
            sbb = s.bounding_box()
            arm_reach = max(
                arm_reach,
                abs(sbb.max.X), abs(sbb.min.X),
                abs(sbb.max.Y), abs(sbb.min.Y),
            )

    # A mid-shaft banner set can extend the horizontal reach; fold its widest
    # |X|/|Y| extent in (only when present, so no-banner output is unchanged).
    if banner_solids:
        for s in banner_solids:
            sbb = s.bounding_box()
            arm_reach = max(
                arm_reach,
                abs(sbb.max.X), abs(sbb.min.X),
                abs(sbb.max.Y), abs(sbb.min.Y),
            )

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
