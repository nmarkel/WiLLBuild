"""Shell-mesh assembly for accurate deliverables (Phase 0.17, Tyler 8/19).

The kit's build123d solids are parametric CONCEPT placeholders, so every
geometric download (IFC first) looked nothing like the real products the
viewer renders. This module assembles the config from the gated EXTERIOR
SHELLS instead — the 0.15 web-GLB pipeline's output (interior triangles
culled, decimated to a non-manufacturable subset, hash-bound by the IP gate
in src/lib/webModels.test.ts) — re-exported as plain float32 GLBs into
``geometry-service/assets/shells/`` by scripts/web-glb/export-service-shells.mjs
with each part's rig rotation already baked.

The assembly walk mirrors ``resolveAssemblyLayout`` in src/lib/composite.ts —
the same catalog-socket math the viewer uses — in world METERS, +Y up (the
GLB/viewer frame). Consumers convert axes/units themselves (the IFC adapter
wants millimetres, +Z up).

IP: inputs are the already-gated shells; this module cannot reach the
engineering masters at all. Engine-free (numpy + stdlib only), so it lives in
app/ rather than app/adapters/.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

_SHELL_DIR = Path(__file__).resolve().parent.parent / "assets" / "shells"

FT_TO_M = 0.3048
# The pole shell is cropped below y=0.08 m (the tube ends inside its anchor
# base — see cropBelowM in scripts/step-to-glb/ingest.py). Derived pole
# heights scale the tube ABOVE that fixed line, exactly like the converter
# does (crop applied after scale), so the cut never drifts with pole length.
_POLE_CROP_M = 0.08
# The one real pole export the whole family derives from (12 ft).
_POLE_SOURCE_ID = "alum-pole-12"
_POLE_SOURCE_FT = 12.0


@dataclass
class CylinderSpec:
    """Exact analytic description of a straight round shaft on the pole axis
    (x = z = 0), +Y up, meters. Carried ALONGSIDE the mesh (Phase 0.17.5):
    the decimated shell tube is a 32-segment prism whose radius wobbles
    47.5–50.9 mm, and normal-less IFC/STEP meshes flat-shade every facet —
    solid-capable consumers emit this instead and match the smooth analytic
    cylinder a CAD STEP import shows."""

    radius_m: float
    y0_m: float
    y1_m: float


@dataclass
class ShellPiece:
    """One placed component: name for the IFC tree, mesh in meters, +Y up.
    ``cylinder`` is set only on a piece whose true shape IS a plain straight
    cylinder (the pole shaft) — consumers that can express real solids should
    prefer it over the decimated mesh."""

    name: str
    verts: np.ndarray  # (N, 3) float64
    tris: np.ndarray  # (M, 3) int64
    cylinder: CylinderSpec | None = None


@dataclass
class ShellAssembly:
    pieces: list[ShellPiece]
    warnings: list[str] = field(default_factory=list)


def shell_path(part_id: str) -> Path:
    return _SHELL_DIR / f"{part_id}.glb"


def has_shell(part_id: str) -> bool:
    return shell_path(part_id).is_file()


def load_shell(part_id: str) -> tuple[np.ndarray, np.ndarray]:
    """Parse one of OUR plain GLBs (float32 POSITION + uint32 indices)."""
    data = shell_path(part_id).read_bytes()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    bin_off = 20 + json_len + 8
    prim = doc["meshes"][0]["primitives"][0]

    def read(acc_i: int, dtype: str, comps: int) -> np.ndarray:
        acc = doc["accessors"][acc_i]
        view = doc["bufferViews"][acc["bufferView"]]
        off = bin_off + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"] * comps
        arr = np.frombuffer(data, dtype=dtype, count=count, offset=off)
        return arr.reshape(-1, comps) if comps > 1 else arr

    verts = read(prim["attributes"]["POSITION"], "<f4", 3).astype(np.float64)
    tris = read(prim["indices"], "<u4", 1).astype(np.int64).reshape(-1, 3)
    return verts, tris


def _rot_y(verts: np.ndarray, deg: float) -> np.ndarray:
    """Rotate about +Y — must match src/lib/composite.ts `rotateY` exactly:
    x' = x·cos + z·sin ; z' = −x·sin + z·cos."""
    if deg % 360 == 0:
        return verts
    r = np.deg2rad(deg)
    c, s = np.cos(r), np.sin(r)
    out = verts.copy()
    out[:, 0] = verts[:, 0] * c + verts[:, 2] * s
    out[:, 2] = -verts[:, 0] * s + verts[:, 2] * c
    return out


def _arm_azimuths(count: int) -> list[float]:
    """Official radial layouts — mirror armAzimuths in src/lib/compat.ts."""
    return {1: [0.0], 2: [0.0, 180.0], 3: [0.0, 90.0, 270.0], 4: [0.0, 90.0, 180.0, 270.0]}[
        max(1, min(4, int(count)))
    ]


def _part(catalog: dict, part_id: str | None) -> dict | None:
    if not part_id:
        return None
    return next((p for p in catalog["parts"] if p["id"] == part_id), None)


def _socket_to(host: dict | None, part: dict | None) -> list[float] | None:
    """First host socket matching the part's mount (attachSocket)."""
    if not host or not part or not part.get("mount"):
        return None
    for s in (host.get("sockets") or {}).values():
        if s.get("type") == part["mount"]:
            return list(s["position"])
    return None


def _sockets_to(host: dict | None, part: dict | None) -> list[list[float]]:
    """EVERY host socket matching the part's mount (attachSockets — crossarms)."""
    if not host or not part or not part.get("mount"):
        return []
    return [
        list(s["position"])
        for s in (host.get("sockets") or {}).values()
        if s.get("type") == part["mount"]
    ]


def _pole_shell(pole: dict) -> tuple[np.ndarray, np.ndarray]:
    """The pole family derives from the one real 12 ft shell by scaling the
    tube ABOVE the fixed crop line (the anchor-base joint must not move)."""
    verts, tris = load_shell(_POLE_SOURCE_ID)
    height_ft = float(pole.get("heightFt") or _POLE_SOURCE_FT)
    if height_ft != _POLE_SOURCE_FT:
        src_h = _POLE_SOURCE_FT * FT_TO_M
        dst_h = height_ft * FT_TO_M
        k = (dst_h - _POLE_CROP_M) / (src_h - _POLE_CROP_M)
        verts = verts.copy()
        verts[:, 1] = _POLE_CROP_M + (verts[:, 1] - _POLE_CROP_M) * k
    return verts, tris


def _pole_cylinder(pole: dict) -> CylinderSpec | None:
    """The pole shaft's analytic description, from the same catalog placeholder
    the parametric kit builds from. Straight shafts only — a tapered pole (no
    WiLLstudio pole is) keeps mesh-only, never a wrong analytic stand-in."""
    ph = pole.get("placeholder") or {}
    specs = [ph] + [c.get("spec") or {} for c in ph.get("children") or []]
    spec = next((s for s in specs if s.get("kind") == "pole"), None)
    if not spec:
        return None
    r_top, r_bottom = spec.get("radiusTopM"), spec.get("radiusBottomM")
    if r_top is None or r_top != r_bottom:
        return None
    # Same height/crop math as _pole_shell, so mesh and solid always agree.
    top = float(pole.get("heightFt") or _POLE_SOURCE_FT) * FT_TO_M
    if top <= _POLE_CROP_M:
        return None
    return CylinderSpec(radius_m=float(r_top), y0_m=_POLE_CROP_M, y1_m=top)


def _pole_graft_pieces(catalog: dict, pole: dict) -> list[ShellPiece]:
    """The pole's own hardware: the standard base at the origin and the
    hand-hole frame at the cover's centre — the same plan the render rig
    bakes (poleGraftPlan in scripts/render-rig/generate.mjs)."""
    pieces: list[ShellPiece] = []
    if has_shell("willstudio-pole-base-standard"):
        v, t = load_shell("willstudio-pole-base-standard")
        pieces.append(ShellPiece("Pole Base", v, t))
    # Cover box child (proud of the shaft, position x > 0) anchors the frame.
    children = (pole.get("placeholder") or {}).get("children") or []
    cover = next(
        (c for c in children if c.get("spec", {}).get("kind") == "box" and c["position"][0] > 0),
        None,
    )
    if cover and has_shell("willstudio-acc-hand-hole"):
        center_y = cover["position"][1] + cover["spec"]["sizeM"][1] / 2
        v, t = load_shell("willstudio-acc-hand-hole")
        v = v.copy()
        v[:, 1] += center_y
        pieces.append(ShellPiece("Hand Hole", v, t))
    return pieces


def _spec_codes(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    return [c for c in value if c]


def shell_assembly(catalog: dict, cfg) -> ShellAssembly | None:
    """Assemble the config from gated shells, or None when a CORE part
    (fixture/arm/pole/base cover) has no shell — the caller falls back to the
    parametric kit whole, never a hybrid of real and placeholder cores.
    Accessories degrade individually with a warning (festoon has no CAD)."""
    pole = _part(catalog, getattr(cfg, "pole", ""))
    base_cover = _part(catalog, getattr(cfg, "baseCover", ""))
    arm = _part(catalog, getattr(cfg, "arm", ""))
    fixture = _part(catalog, getattr(cfg, "fixture", ""))

    core = [p for p in (pole, base_cover, arm, fixture) if p]
    if not core:
        return None
    missing = [
        p["id"]
        for p in core
        if not (has_shell(p["id"]) or (p is pole and has_shell(_POLE_SOURCE_ID)))
    ]
    if missing:
        return None

    warnings: list[str] = []
    pieces: list[ShellPiece] = []

    if pole:
        v, t = _pole_shell(pole)
        pieces.append(ShellPiece("Pole", v, t, cylinder=_pole_cylinder(pole)))
        pieces.extend(_pole_graft_pieces(catalog, pole))

        if base_cover:
            socket = _socket_to(pole, base_cover) or [0.0, 0.0, 0.0]
            lift = 0.0
            # CLE stacks under the cover (coverExtenderFor in compat.ts).
            chosen = (getattr(cfg, "specOptions", None) or {}).get("baseCover") or {}
            for opt in base_cover.get("options") or []:
                if opt.get("group") != "options-accessories":
                    continue
                for code in _spec_codes(chosen.get(opt["key"])):
                    value = next((x for x in opt["values"] if x["code"] == code), None)
                    rid = (value or {}).get("renderPartId")
                    ext = _part(catalog, rid) if rid else None
                    if ext and ext.get("stackHeightM") is not None:
                        if has_shell(ext["id"]):
                            ev, et = load_shell(ext["id"])
                            ev = ev + np.array(socket)
                            pieces.append(ShellPiece(ext["name"], ev, et))
                            lift = float(ext["stackHeightM"])
                        else:
                            warnings.append(f"{ext['id']}: no shell — extender omitted from model")
            cv, ct = load_shell(base_cover["id"])
            cv = cv + np.array([socket[0], socket[1] + lift, socket[2]])
            pieces.append(ShellPiece("Base Cover", cv, ct))

        if arm:
            arm_socket = _socket_to(pole, arm)
            if arm_socket:
                mo = arm.get("mountOffset") or [0.0, 0.0, 0.0]
                mount = np.array(arm_socket) + np.array(mo)
                count = int(getattr(cfg, "armCount", None) or 1)
                orientation = float(getattr(cfg, "armOrientation", None) or 0)
                fix_sockets = _sockets_to(arm, fixture)
                av, at = load_shell(arm["id"])
                fx = load_shell(fixture["id"]) if fixture and fix_sockets else None
                for i, az in enumerate(_arm_azimuths(count)):
                    deg = az + orientation
                    pieces.append(
                        ShellPiece(
                            f"Arm{'' if count == 1 else f' {i + 1}'}",
                            _rot_y(av, deg) + mount,
                            at,
                        )
                    )
                    if fx is not None:
                        for s_i, fs in enumerate(fix_sockets):
                            world = _rot_y(np.array([fs]), deg)[0] + mount
                            suffix = "" if count == 1 and len(fix_sockets) == 1 else f" {i + 1}.{s_i + 1}"
                            pieces.append(
                                ShellPiece(f"Fixture{suffix}", _rot_y(fx[0], deg) + world, fx[1])
                            )

        # Placed shaft accessories (hand holes, festoons, couplings, flag/
        # plant holders) — mirror the compositor's renderPartId walk.
        chosen_pole = (getattr(cfg, "specOptions", None) or {}).get("pole") or {}
        placements = getattr(cfg, "accessoryPlacements", None) or {}
        for opt in pole.get("options") or []:
            if opt.get("group") != "options-accessories":
                continue
            for code in _spec_codes(chosen_pole.get(opt["key"])):
                value = next((x for x in opt["values"] if x["code"] == code), None)
                if not value or not value.get("renderPartId"):
                    continue
                acc = _part(catalog, value["renderPartId"])
                if not acc:
                    continue
                raw = placements.get(code) or []
                if not isinstance(raw, list):
                    raw = [raw]
                if not raw:
                    default_ft = (value.get("placement") or {}).get("defaultFt") or (
                        value.get("placement") or {}
                    ).get("minFt") or 0
                    raw = [{"heightFt": default_ft, "orientation": 0}]
                if not has_shell(acc["id"]):
                    warnings.append(f"{acc['id']}: no shell (no CAD yet) — omitted from model")
                    continue
                sv, st = load_shell(acc["id"])
                for j, inst in enumerate(raw):
                    h = float(_get(inst, "heightFt", 0)) * FT_TO_M
                    o = float(_get(inst, "orientation", 0))
                    label = acc["name"] if len(raw) == 1 else f"{acc['name']} {j + 1}"
                    pieces.append(ShellPiece(label, _rot_y(sv, o) + np.array([0.0, h, 0.0]), st))

    elif fixture and fixture.get("groundMounted"):
        v, t = load_shell(fixture["id"])
        pieces.append(ShellPiece("Fixture", v, t))

    if not pieces:
        return None
    return ShellAssembly(pieces=pieces, warnings=warnings)


def _get(inst, key: str, default):
    if isinstance(inst, dict):
        return inst.get(key, default) if inst.get(key) is not None else default
    return getattr(inst, key, default) or default
