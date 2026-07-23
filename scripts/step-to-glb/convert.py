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

def tessellate_shape(shape, tol_mm: float):
    """Mesh every face; return (positions_mm Nx3, indices M) as numpy."""
    BRepMesh_IncrementalMesh(shape, tol_mm, False, 0.5, True)
    verts = []
    tris = []
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
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            if reversed_:
                a, c = c, a
            tris.append((base + a - 1, base + b - 1, base + c - 1))
    return np.array(verts, dtype=np.float64), np.array(tris, dtype=np.uint32)

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
    return pos

def convert_monolithic(step_path: str, out_glb: str, origin: str = "base",
                       tol_mm: float = 0.5, base_color=(0.75,0.75,0.75,1.0)) -> dict:
    shape = load_step_shape(step_path)
    verts_mm, tris = tessellate_shape(shape, tol_mm)
    pos = _normalize(verts_mm, origin).astype(np.float32)
    write_glb(out_glb, [{
        "positions": pos, "indices": tris.reshape(-1),
        "material_name": "will-body", "base_color": base_color,
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

def convert_color_aware(step_path: str, out_glb: str, origin: str = "top",
                        tol_mm: float = 1.0) -> dict:
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
    all_mm, _ = tessellate_shape(comp, tol_mm)
    all_m = _normalize(all_mm, origin)
    offset_m = (all_mm * MM_TO_M) - all_m  # constant translation per vertex
    off = offset_m[0] if len(offset_m) else np.zeros(3)

    primitives = []
    body_count = 0
    total_tris = 0
    for key, solids in groups.items():
        b = BRep_Builder(); c = TopoDS_Compound(); b.MakeCompound(c)
        for s in solids:
            b.Add(c, s)
        verts_mm, tris = tessellate_shape(c, tol_mm)
        if len(tris) == 0:
            continue
        pos = (verts_mm * MM_TO_M - off).astype(np.float32)
        alu = is_aluminum(key)
        if alu:
            body_count += 1
            name, color = "will-body", (0.75,0.75,0.75,1.0)
        else:
            name = "will-fixed-%02x%02x%02x" % tuple(int(round(c*255)) for c in key)
            color = (key[0], key[1], key[2], 1.0)
        primitives.append({"positions": pos, "indices": tris.reshape(-1),
                           "material_name": name, "base_color": color})
        total_tris += len(tris)
    write_glb(out_glb, primitives)
    return {"vertices": int(sum(len(p["positions"]) for p in primitives)),
            "triangles": int(total_tris), "primitives": len(primitives),
            "body_primitives": body_count}

if __name__ == "__main__":
    import sys
    print(convert_monolithic(sys.argv[1], sys.argv[2],
                             origin=sys.argv[3] if len(sys.argv) > 3 else "base"))
