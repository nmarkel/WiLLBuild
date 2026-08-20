"""STEP -> GLB converter for the render rig (offline).

Monolithic mode: whole part -> one mesh, meters, Y-up, origin at lower attach point.
Run with the geometry-service venv python (has OCP + numpy).
"""
from __future__ import annotations
import numpy as np
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp_Face
from OCP.gp import gp_Pnt, gp_Vec

from glb_writer import write_glb

MM_TO_M = 0.001

def load_step_shape(step_path: str):
    r = STEPControl_Reader()
    if r.ReadFile(step_path) != IFSelect_RetDone:
        raise RuntimeError(f"STEP read failed: {step_path}")
    r.TransferRoots()
    return r.OneShape()

def _finite_solids(shape) -> list:
    out = []
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        s = TopoDS.Solid_s(exp.Current()); exp.Next()
        b = Bnd_Box()
        try:
            BRepBndLib.Add_s(s, b)
        except Exception:
            continue
        if b.IsVoid():
            continue
        x0,y0,z0,x1,y1,z1 = b.Get()
        if max(abs(x0),abs(x1),abs(y0),abs(y1),abs(z0),abs(z1)) > 1e7:
            continue
        out.append(s)
    return out

def load_step_solids(step_path: str) -> list:
    """Load a STEP file and return its finite TopoDS_Solid list."""
    shape = load_step_shape(step_path)
    return _finite_solids(shape)

def tessellate_shape(shape, tol_mm: float, with_normals: bool = False,
                     ang_rad: float = 0.5):
    """Mesh every face; return (positions_mm Nx3, indices M) as numpy.

    with_normals=True (Phase 0.16) additionally returns exact B-rep surface
    normals evaluated at each node's UV — the analytic normal FreeCAD shades
    with, not an average of facet normals. Coincident boundary vertices on
    tangent-continuous faces get equal normals (seamless), while true feature
    edges keep their split-vertex hard crease. Return becomes a 3-tuple
    (positions, indices, normals).
    """
    BRepMesh_IncrementalMesh(shape, tol_mm, False, ang_rad, True)
    verts = []
    tris = []
    norms = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current()); exp.Next()
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            continue
        trsf = loc.Transformation()
        base = len(verts)
        n = tri.NbNodes()
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(trsf)
            verts.append((p.X(), p.Y(), p.Z()))
        reversed_ = face.Orientation() == 1  # TopAbs_REVERSED
        face_nrm = None
        if with_normals:
            props = BRepGProp_Face(face)
            has_uv = tri.HasUVNodes()
            face_nrm = np.zeros((n, 3))
            if has_uv:
                for i in range(1, n + 1):
                    uv = tri.UVNode(i)
                    pnt = gp_Pnt(); vec = gp_Vec()
                    props.Normal(uv.X(), uv.Y(), pnt, vec)
                    v = vec.Transformed(trsf)
                    face_nrm[i - 1] = (v.X(), v.Y(), v.Z())
        face_tris = []
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            if reversed_:
                a, c = c, a
            face_tris.append((a - 1, b - 1, c - 1))
        if with_normals and len(face_tris):
            # Sign the face's analytic normals against its OWN winding. Neither
            # TopAbs orientation alone nor a global flip works — measured on the
            # GVX export, winding agreement was 70.7% raw and 57.4% with a
            # REVERSED-only flip (mirrored assembly instances flip handedness
            # via the location transform). A face's normal field is continuous,
            # so one aggregate dot product per face settles the sign exactly.
            ft = np.asarray(face_tris)
            fpos = np.asarray(verts[base:], dtype=np.float64)
            cross = np.cross(fpos[ft[:, 1]] - fpos[ft[:, 0]], fpos[ft[:, 2]] - fpos[ft[:, 0]])
            avg = face_nrm[ft[:, 0]] + face_nrm[ft[:, 1]] + face_nrm[ft[:, 2]]
            if float(np.einsum("ij,ij->", cross, avg)) < 0:
                face_nrm = -face_nrm
        if with_normals:
            norms.extend(map(tuple, face_nrm))
        tris.extend((base + a, base + b, base + c) for a, b, c in face_tris)
    pos = np.array(verts, dtype=np.float64)
    idx = np.array(tris, dtype=np.uint32)
    if not with_normals:
        return pos, idx
    nrm = np.array(norms, dtype=np.float64) if norms else np.zeros((0, 3))
    nrm = _repair_normals(pos, idx, nrm)
    return pos, idx, nrm


def _repair_normals(pos: np.ndarray, idx: np.ndarray, nrm: np.ndarray) -> np.ndarray:
    """Normalize surface normals; fill degenerate ones (surface singularities
    like a cone apex, or faces meshed without UV nodes) from the winding of
    their incident triangles."""
    lens = np.linalg.norm(nrm, axis=1)
    good = lens > 1e-10
    nrm = nrm.copy()
    nrm[good] /= lens[good][:, None]
    if not np.all(good) and len(idx):
        tri = idx.reshape(-1, 3).astype(np.int64)
        fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
        acc = np.zeros_like(nrm)
        for k in range(3):
            np.add.at(acc, tri[:, k], fn)
        al = np.linalg.norm(acc, axis=1)
        fix = (~good) & (al > 1e-12)
        nrm[fix] = acc[fix] / al[fix][:, None]
        good = good | fix
        # A node can sit on a surface singularity AND own only zero-area
        # triangles (e.g. a collapsed cone-apex fan): borrow the average of its
        # co-vertices' good normals so no vertex ships a zero normal.
        rest = np.flatnonzero(~good)
        if len(rest):
            rest_set = set(rest.tolist())
            neigh = np.zeros_like(nrm)
            for t in tri:
                bad_here = [v for v in t if v in rest_set]
                if not bad_here:
                    continue
                for v in bad_here:
                    for w in t:
                        if good[w]:
                            neigh[v] += nrm[w]
            nl = np.linalg.norm(neigh, axis=1)
            fix2 = (~good) & (nl > 1e-12)
            nrm[fix2] = neigh[fix2] / nl[fix2][:, None]
            nrm[(~good) & (nl <= 1e-12)] = (0.0, 1.0, 0.0)
    return nrm

def tessellate_to_arrays(shape, tol_mm: float) -> tuple:
    """Tessellate `shape` and return (positions_m Y-up, indices) as numpy arrays."""
    verts_mm, tris = tessellate_shape(shape, tol_mm)
    pos_m = (verts_mm * MM_TO_M).astype(np.float32) if len(verts_mm) else verts_mm.astype(np.float32)
    return pos_m, tris.reshape(-1)

def _normalize(pos_mm: np.ndarray, origin: str) -> np.ndarray:
    pos = pos_mm * MM_TO_M
    if origin == "base":
        cx = (pos[:,0].min() + pos[:,0].max()) / 2
        cz = (pos[:,2].min() + pos[:,2].max()) / 2
        ymin = pos[:,1].min()
        pos = pos - np.array([cx, ymin, cz])
    elif origin == "top":
        cx = (pos[:,0].min() + pos[:,0].max()) / 2
        cz = (pos[:,2].min() + pos[:,2].max()) / 2
        ymax = pos[:,1].max()
        pos = pos - np.array([cx, ymax, cz])
    elif origin == "mount":
        # Trust the CAD's native X/Z origin (e.g. a side-mount bracket whose
        # pole-gripping collar is modeled on the native axis) and only floor Y
        # so the part sits on its mount socket. Do NOT re-center X/Z on the
        # bbox — that would shove an asymmetric part (long reach in one axis)
        # off the mount axis.
        ymin = pos[:,1].min()
        pos = pos - np.array([0.0, ymin, 0.0])
    elif origin == "mount-center":
        # Mid-shaft accessory (banner arm): the catalog origin is the shaft mount
        # point at the part's vertical CENTRE, and — like "mount" — the CAD's
        # native X/Z already sits on the pole axis, so only Y is re-based.
        ycenter = (pos[:,1].min() + pos[:,1].max()) / 2
        pos = pos - np.array([0.0, ycenter, 0.0])
    elif origin == "native":
        # Phase 0.14: trust the CAD frame ENTIRELY — X/Z on the pole axis AND
        # Y zeroed where Engineering put it. Used when the export's own origin
        # IS the catalog reference point (FH/PH kits: y=0 is the shaft bracket
        # the placement height drives; the staff/basket extends above AND below
        # it, so any bbox re-basing would move the origin off the bracket).
        pass
    return pos

def _stand_up(verts_mm: np.ndarray, rotate_x: float, rotate_z: float) -> np.ndarray:
    """Rotate raw CAD vertices about X then Z (degrees) BEFORE re-basing.

    Most of the WiLLstudio files are modelled Y-up, but a few (the bollard) are
    modelled lying along a horizontal axis.  Standing the part up has to happen
    before the origin is re-based, or the "floor Y" step floors the wrong axis.
    """
    out = verts_mm
    if rotate_x:
        t = np.radians(rotate_x)
        y, z = out[:, 1].copy(), out[:, 2].copy()
        out = out.copy()
        out[:, 1] = y * np.cos(t) - z * np.sin(t)
        out[:, 2] = y * np.sin(t) + z * np.cos(t)
    if rotate_z:
        t = np.radians(rotate_z)
        x, y = out[:, 0].copy(), out[:, 1].copy()
        out = out.copy()
        out[:, 0] = x * np.cos(t) - y * np.sin(t)
        out[:, 1] = x * np.sin(t) + y * np.cos(t)
    return out


def _crop_below(pos: np.ndarray, tris: np.ndarray, nrm, plane_y: float):
    """Clip the mesh at y = plane_y, discarding everything BELOW the plane.

    Phase 0.17 (Tyler 8/19): the pole tube must not extend through its anchor
    base — the shaft physically ends at the base's top, and the CLE-lifted
    clamshell exposes whatever renders below it. Straddling triangles are cut
    at the plane (vertices interpolated, normals re-normalized), so the crop
    is exact rather than jagged. Returns (pos, tris, nrm).
    """
    keep_tris = []
    new_pos = pos.tolist()
    new_nrm = nrm.tolist() if nrm is not None else None

    def lerp(i, j):
        a, b = pos[i], pos[j]
        t = (plane_y - a[1]) / (b[1] - a[1])
        p = a + (b - a) * t
        new_pos.append(p.tolist())
        if new_nrm is not None:
            n = nrm[i] + (nrm[j] - nrm[i]) * t
            ln = np.linalg.norm(n)
            new_nrm.append((n / ln).tolist() if ln > 1e-12 else nrm[i].tolist())
        return len(new_pos) - 1

    for tri in tris:
        above = [pos[v][1] >= plane_y for v in tri]
        n_above = sum(above)
        if n_above == 3:
            keep_tris.append(list(tri))
            continue
        if n_above == 0:
            continue
        # Rotate so the pattern starts at vertex 0 (keeps winding order).
        idx = list(tri)
        while not (above[0] and (n_above == 1 or not above[2])):
            idx = idx[1:] + idx[:1]
            above = above[1:] + above[:1]
        a, b, c = idx
        if n_above == 1:
            # a above; b, c below → one clipped triangle.
            keep_tris.append([a, lerp(a, b), lerp(c, a)])
        else:
            # a, b above; c below → quad a-b-bc-ca → two triangles.
            bc = lerp(b, c)
            ca = lerp(c, a)
            keep_tris.append([a, b, bc])
            keep_tris.append([a, bc, ca])

    pos_out = np.asarray(new_pos, dtype=np.float32)
    nrm_out = np.asarray(new_nrm, dtype=np.float32) if new_nrm is not None else None
    tris_out = np.asarray(keep_tris, dtype=np.uint32)
    return pos_out, tris_out, nrm_out


def _feature_only(pos: np.ndarray, tris: np.ndarray, nrm, nominal_r_m: float,
                  arc_deg: float = 60.0):
    """Keep only a shaft accessory's FEATURE, dropping what the pole already draws.

    Phase 0.17 (Tyler 8/20): HH-4R is a 6in SECTION of pole — the opening plus
    its frame — so overlaying it on the shaft left two visible circumferential
    seams ("what is the ring/line around the pole just above the hand hole?").
    Measured on the shell: 82 triangles are the annular END CAPS (the rings),
    158 are cylinder WALL at the pole's own radius (redundant — the pole draws
    that surface), and 64 are the recessed opening itself, spanning only +/-42
    degrees. Dropping caps + nominal-radius wall leaves the hole as a recessed
    dish in the pole's surface, which is what it physically is.

    An ANGULAR window is required too, not just cap/wall removal: the section's
    inner bore also wraps 360 degrees, and the image compositor draws layers in
    z-order without per-pixel occlusion — so ANY geometry that encircles the
    shaft paints a collar over it no matter its radius. Keeping only the arc
    around the opening (the shell measured the feature at +/-42 degrees) makes
    the layer a local patch that reads as a hole in the pole.

    Deliberate deviation, recorded: the accessory GLB is no longer the whole
    exported part. It exists to OVERLAY a pole, so the encircling wall is not
    geometry we can ship truthfully anyway (it would z-fight the shaft).
    """
    tol = 3e-4
    r = np.sqrt(pos[:, 0] ** 2 + pos[:, 2] ** 2)
    y = pos[:, 1]
    rt, yt = r[tris], y[tris]
    caps = (np.abs(yt - y.max()) < 1e-4).all(axis=1) | (np.abs(yt - y.min()) < 1e-4).all(axis=1)
    outer_wall = ((rt.max(axis=1) - rt.min(axis=1)) < tol) & (
        np.abs(rt.mean(axis=1) - nominal_r_m) < tol
    )
    # Feature direction is +X (the hole faces the catalog 0-degree reference).
    ang = np.degrees(np.arctan2(pos[:, 2], pos[:, 0]))
    tri_ang = np.abs(np.arctan2(
        np.sin(np.deg2rad(ang[tris])).mean(axis=1),
        np.cos(np.deg2rad(ang[tris])).mean(axis=1),
    ))
    off_arc = np.degrees(tri_ang) > arc_deg
    keep = ~(caps | outer_wall | off_arc)
    if not keep.any():
        raise ValueError("feature-only crop removed every triangle")
    kept = tris[keep]
    used = np.unique(kept)
    remap = np.full(len(pos), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    out_nrm = nrm[used] if nrm is not None else None
    return pos[used], remap[kept].astype(np.uint32), out_nrm


def convert_monolithic(step_path: str, out_glb: str, origin: str = "base",
                       tol_mm: float = 0.5, base_color=(0.75,0.75,0.75,1.0),
                       rotate_x: float = 0.0, rotate_z: float = 0.0,
                       scale_y: float = 1.0, with_normals: bool = True,
                       ang_rad: float = 0.5, crop_below_m: float | None = None,
                       feature_only_radius_m: float | None = None,
                       feature_arc_deg: float = 60.0) -> dict:
    shape = load_step_shape(step_path)
    nrm = None
    if with_normals:
        verts_mm, tris, nrm = tessellate_shape(shape, tol_mm, with_normals=True,
                                               ang_rad=ang_rad)
    else:
        verts_mm, tris = tessellate_shape(shape, tol_mm, ang_rad=ang_rad)
    verts_mm = _stand_up(verts_mm, rotate_x, rotate_z)
    pos = _normalize(verts_mm, origin).astype(np.float32)
    if nrm is not None:
        nrm = _stand_up(nrm, rotate_x, rotate_z)
    # Phase 0.10.5 (D10): axial scale for derived pole heights. Applied after
    # re-basing so the pole's base stays on the floor and only its length grows.
    if scale_y != 1.0:
        pos[:, 1] *= scale_y
        if nrm is not None:
            # normals transform by the inverse-transpose: diag(1, 1/s, 1)
            nrm = nrm.copy()
            nrm[:, 1] /= scale_y
            lens = np.linalg.norm(nrm, axis=1)
            ok = lens > 1e-12
            nrm[ok] /= lens[ok][:, None]
    # Phase 0.17: crop AFTER the axial scale — the crop plane is a fixed
    # world height (the anchor base's top), never something that stretches
    # with pole length (same rule as the hand-hole graft).
    if crop_below_m is not None:
        pos, tris, nrm = _crop_below(pos, tris, nrm, crop_below_m)
    if feature_only_radius_m is not None:
        pos, tris, nrm = _feature_only(pos, tris, nrm, feature_only_radius_m,
                                       arc_deg=feature_arc_deg)
    write_glb(out_glb, [{
        "positions": pos, "indices": tris.reshape(-1),
        "material_name": "will-body", "base_color": base_color,
        "normals": nrm.astype(np.float32) if nrm is not None else None,
    }])
    d = pos.max(axis=0) - pos.min(axis=0)
    return {"vertices": int(len(pos)), "triangles": int(len(tris)),
            "bbox_m": [float(d[0]), float(d[1]), float(d[2])]}

from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.XCAFDoc import XCAFDoc_ColorType
from OCP.TDF import TDF_LabelSequence
from OCP.TCollection import TCollection_ExtendedString
from OCP.Quantity import Quantity_Color
from OCP.TopoDS import TopoDS

ALU_GRAY = (0.894, 0.894, 0.894)

def is_aluminum(rgb, tol: float = 0.06) -> bool:
    return all(abs(rgb[i] - ALU_GRAY[i]) <= tol for i in range(3))

def _read_labeled_solids(step_path: str):
    """Return list of (TopoDS_Shape solid, (r,g,b)) using the XDE color tool."""
    doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    if reader.ReadFile(step_path) != IFSelect_RetDone:
        raise RuntimeError(f"CAF read failed: {step_path}")
    reader.Transfer(doc)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    labels = TDF_LabelSequence()
    shape_tool.GetShapes(labels)
    results = []
    default = ALU_GRAY
    for i in range(1, labels.Length() + 1):
        lbl = labels.Value(i)
        shp = shape_tool.GetShape_s(lbl)
        if shp is None or shp.IsNull():
            continue
        col = Quantity_Color()
        rgb = default
        for ct in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen):
            if color_tool.GetColor_s(lbl, ct, col):
                rgb = (col.Red(), col.Green(), col.Blue()); break
        # explode to solids so each solid inherits its label color
        exp = TopExp_Explorer(shp, TopAbs_SOLID)
        any_solid = False
        while exp.More():
            results.append((TopoDS.Solid_s(exp.Current()), rgb)); any_solid = True; exp.Next()
        if not any_solid:
            continue
    return results

def _solid_final_frame_stats(solid, tol_mm, ang_rad, rotate_x, rotate_z, off):
    """A solid's (r_max, y_min, y_max) in the part's FINAL normalized frame.

    Reuses the triangulation the full-compound pass already cached on the
    faces (same tol/ang), so this is a vertex walk, not a re-mesh."""
    verts_mm, _ = tessellate_shape(solid, tol_mm, ang_rad=ang_rad)
    if len(verts_mm) == 0:
        return 0.0, 0.0, 0.0
    v = _stand_up(verts_mm, rotate_x, rotate_z) * MM_TO_M - off
    r = np.hypot(v[:, 0], v[:, 2])
    return float(r.max()), float(v[:, 1].min()), float(v[:, 1].max())


def _drop_matches(rule: dict, r_max: float, y_min: float, y_max: float) -> bool:
    """One drop rule (Phase 0.16.5). Conditions AND together:
    r_below  — solid's max radius from the part axis is under this
    top_below — solid's highest point is under this (deep under-cavity junk)
    top_above — solid's highest point is above this (the protruding stem stack)
    """
    if "r_below" in rule and not r_max < rule["r_below"]:
        return False
    if "top_below" in rule and not y_max < rule["top_below"]:
        return False
    if "top_above" in rule and not y_max > rule["top_above"]:
        return False
    return True


def convert_color_aware(step_path: str, out_glb: str, origin: str = "top",
                        tol_mm: float = 1.0, rotate_x: float = 0.0,
                        rotate_z: float = 0.0, with_normals: bool = True,
                        ang_rad: float = 0.5, drop_solids: list | None = None) -> dict:
    labeled = _read_labeled_solids(step_path)
    # group solids by rounded color
    groups: dict[tuple, list] = {}
    for solid, rgb in labeled:
        key = tuple(round(c, 3) for c in rgb)
        groups.setdefault(key, []).append(solid)

    # First pass: gather all verts to compute a shared normalization offset.
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder
    builder = BRep_Builder(); comp = TopoDS_Compound(); builder.MakeCompound(comp)
    for solid, _ in labeled:
        builder.Add(comp, solid)
    all_mm, _ = tessellate_shape(comp, tol_mm, ang_rad=ang_rad)
    all_mm = _stand_up(all_mm, rotate_x, rotate_z)
    all_m = _normalize(all_mm, origin)
    offset_m = (all_mm * MM_TO_M) - all_m  # constant translation per vertex
    off = offset_m[0] if len(offset_m) else np.zeros(3)

    # Phase 0.16.5: per-part editorial solid drops (Tyler's punch list) — e.g.
    # the GVX's internal light-engine stack hanging under the shade, and its
    # protruding top stem that the arm's sleeve slides over in reality (the
    # layered compositor draws fixture OVER arm, so the stem can only be hidden
    # by not rendering it). Rules are geometric, measured per part, and applied
    # AFTER the normalization offset is computed from the FULL solid set, so
    # dropping art can never move the part's mounting frame.
    dropped = 0
    if drop_solids:
        kept: dict[tuple, list] = {}
        for key, solids in groups.items():
            for s in solids:
                r_max, y_min, y_max = _solid_final_frame_stats(
                    s, tol_mm, ang_rad, rotate_x, rotate_z, off)
                if any(_drop_matches(rule, r_max, y_min, y_max) for rule in drop_solids):
                    dropped += 1
                    continue
                kept.setdefault(key, []).append(s)
        groups = kept

    primitives = []
    body_count = 0
    total_tris = 0
    for key, solids in groups.items():
        b = BRep_Builder(); c = TopoDS_Compound(); b.MakeCompound(c)
        for s in solids:
            b.Add(c, s)
        nrm = None
        if with_normals:
            verts_mm, tris, nrm = tessellate_shape(c, tol_mm, with_normals=True,
                                                   ang_rad=ang_rad)
        else:
            verts_mm, tris = tessellate_shape(c, tol_mm, ang_rad=ang_rad)
        if len(tris) == 0:
            continue
        verts_mm = _stand_up(verts_mm, rotate_x, rotate_z)
        pos = (verts_mm * MM_TO_M - off).astype(np.float32)
        if nrm is not None:
            # _stand_up is a pure rotation, so it transforms normals directly;
            # the translation in _normalize doesn't touch them.
            nrm = _stand_up(nrm, rotate_x, rotate_z).astype(np.float32)
        alu = is_aluminum(key)
        if alu:
            body_count += 1
            name, color = "will-body", (0.75,0.75,0.75,1.0)
        else:
            name = "will-fixed-%02x%02x%02x" % tuple(int(round(c*255)) for c in key)
            color = (key[0], key[1], key[2], 1.0)
        primitives.append({"positions": pos, "indices": tris.reshape(-1),
                           "material_name": name, "base_color": color,
                           "normals": nrm})
        total_tris += len(tris)
    write_glb(out_glb, primitives)
    return {"vertices": int(sum(len(p["positions"]) for p in primitives)),
            "triangles": int(total_tris), "primitives": len(primitives),
            "body_primitives": body_count, "dropped_solids": dropped}

if __name__ == "__main__":
    import sys
    print(convert_monolithic(sys.argv[1], sys.argv[2],
                             origin=sys.argv[3] if len(sys.argv) > 3 else "base"))
