# Real-Geometry Render Rig PoC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Cole's real STEP geometry (round pole + CL2 base + SH1 hook + GVX fixture) through the existing offline render rig to produce higher-fidelity WebP layers in the same `public/renders/manifest.json` slots, so the compositing viewer shows the real configured product — no app/compositor/viewer/manifest-schema change.

**Architecture:** A new offline Python converter turns each STEP into a GLB (monolithic mesh for pole/base/hook; color-aware multi-primitive mesh for the fixture). `generate.mjs` reads the GLB bytes and hands them to the rig page as base64; `main.ts` parses them with `GLTFLoader`, applies the finish material (whole part for monolithic; only the aluminum-body primitives for the fixture, keeping authored lens/LED/PCB colors), and renders through the unchanged camera/lighting/trim/anchor path. Corrected catalog sockets align the composited assembly.

**Tech Stack:** Python 3.13 + OCP (`cadquery-ocp`, geometry-service venv) + numpy for the converter and a hand-written glTF-2.0 GLB writer; three.js `GLTFLoader` in the existing rig page; Node/Puppeteer/Vite driver; Vitest for the compositor coverage regression.

## Global Constraints

- **No change to** `src/lib/composite.ts`, the viewer components, or the `manifest.json` schema. Only the layer *source* improves. (spec: "Non-negotiable invariant")
- **Rig block stays byte-identical** to the current manifest `rig` block: `{"version":1,"pxPerMeter":180,"azimuthDeg":35,"elevationDeg":6,...}`. Camera/scale constants in `main.ts` must NOT change (guarantees layer alignment + passes `merge-manifests.mjs`'s identical-rig assertion).
- **GLBs are offline rig inputs only** — never committed, never shipped to the browser. Write them under `scripts/render-rig/real-assets/` and gitignore that directory. The browser still receives only WebP layers.
- **Finish approach (user-approved):** uniform finish paint on pole/base/hook; color-preserving on the fixture (repaint only aluminum-body faces, RGB≈0.894 gray). **Fallback:** if XCAF color extraction proves fiddly, fall back to uniform paint on the fixture too and flag it — do not block the PoC.
- **Coordinate conventions:** rig is meters, +Y up. STEP is inches (OCP normalizes to mm) → divide by 1000 for meters. Keep Y-up (SolidWorks native = rig native; do NOT apply the Phase 0.6 Y→Z rotation, which was only for the Z-up geometry-service adapters).
- **Determinism:** no wall clock in converter or GLB output.
- **The four PoC parts** (all `line: WiLLstudio`): `alum-pole-12` ← `RSAA-4040-12.STEP`, `bc-round` ← `CL2-4R.STEP`, `sh1-shepherds-hook` ← `SH1-40F.STEP`, `gvx-pendant` ← `WD-GVX-PM`.
- **Python interpreter:** `/Users/nickmarkel/Documents/WiLLBuild/geometry-service/.venv/bin/python` (has OCP + numpy).
- **STEP source:** `geometry-service/WiLLstudio Design Files-STEP.zip` (untracked). Extract to `scripts/render-rig/real-assets/step/` (gitignored).

---

## Task 0: Scaffold — gitignore, dirs, extract STEP

**Files:**
- Modify: `.gitignore`
- Create: `scripts/render-rig/real-assets/` (dir, gitignored)

- [ ] **Step 1: Add gitignore entry**

Append to `.gitignore`:

```
# Real-geometry render-rig inputs (offline only — large STEP/GLB, never shipped)
scripts/render-rig/real-assets/
```

- [ ] **Step 2: Extract the STEP files**

Run:
```bash
mkdir -p scripts/render-rig/real-assets/step
unzip -o "geometry-service/WiLLstudio Design Files-STEP.zip" -d scripts/render-rig/real-assets/step
ls -la scripts/render-rig/real-assets/step
```
Expected: `CL2-4R.STEP`, `RSAA-4040-12.STEP`, `SH1-40F.STEP`, `WD-GVX-PM` present.

- [ ] **Step 3: Verify nothing under real-assets is tracked**

Run: `git status --porcelain scripts/render-rig/real-assets`
Expected: no output (ignored).

- [ ] **Step 4: Commit the gitignore change**

```bash
git add .gitignore
git commit -m "chore: gitignore offline render-rig real-assets (STEP/GLB inputs)"
```

---

## Task 1: GLB writer + monolithic STEP→GLB converter

Produces a single-mesh GLB (meters, Y-up, origin at the part's lower attachment point) for the monolithic parts. Includes a reusable, pure GLB writer.

**Files:**
- Create: `scripts/step-to-glb/glb_writer.py`
- Create: `scripts/step-to-glb/convert.py`
- Create: `scripts/step-to-glb/tests/test_glb_writer.py`
- Create: `scripts/step-to-glb/tests/test_convert_monolithic.py`

**Interfaces:**
- Produces:
  - `glb_writer.write_glb(path: str, primitives: list[Primitive]) -> None` where
    `Primitive = {"positions": np.ndarray (N,3) float32, "indices": np.ndarray (M,) uint32, "material_name": str, "base_color": tuple[float,float,float,float]}`.
  - `glb_writer.pack_glb(primitives: list[Primitive]) -> bytes` (pure; `write_glb` wraps it).
  - `convert.load_step_solids(step_path: str) -> list[OCP TopoDS_Solid]` (finite solids only).
  - `convert.tessellate_to_arrays(shape, tol_mm: float) -> tuple[np.ndarray, np.ndarray]` → (positions_m Y-up, indices).
  - `convert.convert_monolithic(step_path: str, out_glb: str, origin: str = "base", tol_mm: float = 0.5) -> dict` → writes GLB, returns `{"vertices": int, "triangles": int, "bbox_m": [dx,dy,dz]}`. `origin="base"` translates so min-Y sits at Y=0 and X/Z are centered on the bbox center.

- [ ] **Step 1: Write the failing test for the GLB writer**

`scripts/step-to-glb/tests/test_glb_writer.py`:
```python
import struct
import numpy as np
from scripts_step_to_glb.glb_writer import pack_glb  # see conftest note below

def _triangle():
    return {
        "positions": np.array([[0,0,0],[1,0,0],[0,1,0]], dtype=np.float32),
        "indices": np.array([0,1,2], dtype=np.uint32),
        "material_name": "will-body",
        "base_color": (0.5, 0.5, 0.5, 1.0),
    }

def test_pack_glb_header_and_chunks():
    blob = pack_glb([_triangle()])
    magic, version, total = struct.unpack("<4sII", blob[:12])
    assert magic == b"glTF"
    assert version == 2
    assert total == len(blob)
    # JSON chunk header
    json_len, json_type = struct.unpack("<I4s", blob[12:20])
    assert json_type == b"JSON"
    import json as _json
    gltf = _json.loads(blob[20:20+json_len].decode("utf-8"))
    assert gltf["asset"]["version"] == "2.0"
    assert len(gltf["meshes"][0]["primitives"]) == 1
    assert gltf["materials"][0]["name"] == "will-body"

def test_pack_glb_two_primitives_two_materials():
    tri = _triangle()
    tri2 = dict(tri, material_name="will-fixed-808080", base_color=(0.1,0.1,0.1,1.0))
    blob = pack_glb([tri, tri2])
    import json as _json, struct as _s
    json_len = _s.unpack("<I", blob[12:16])[0]
    gltf = _json.loads(blob[20:20+json_len].decode("utf-8"))
    assert len(gltf["materials"]) == 2
    names = {m["name"] for m in gltf["materials"]}
    assert names == {"will-body", "will-fixed-808080"}
```

Note: add `scripts/step-to-glb/tests/conftest.py` that puts the repo root on `sys.path` and aliases the package:
```python
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "step-to-glb"))
```
and import as `import glb_writer` (adjust the test imports to `from glb_writer import pack_glb`). Use plain `from glb_writer import pack_glb` in tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_glb_writer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'glb_writer'`.

- [ ] **Step 3: Implement the GLB writer**

`scripts/step-to-glb/glb_writer.py`:
```python
"""Minimal, dependency-light glTF 2.0 (.glb) writer.

Supports multiple primitives, each with its own material (name + baseColorFactor).
Y-up, meters. No external glTF library — just numpy + struct.
"""
from __future__ import annotations
import json
import struct
import numpy as np

def pack_glb(primitives: list[dict]) -> bytes:
    buffers = bytearray()
    accessors, buffer_views, meshes_prims, materials = [], [], [], []

    def add_view(data: bytes, target: int) -> int:
        # 4-byte align
        while len(buffers) % 4 != 0:
            buffers.append(0)
        offset = len(buffers)
        buffers.extend(data)
        buffer_views.append({"buffer": 0, "byteOffset": offset,
                             "byteLength": len(data), "target": target})
        return len(buffer_views) - 1

    for prim in primitives:
        pos = np.ascontiguousarray(prim["positions"], dtype=np.float32)
        idx = np.ascontiguousarray(prim["indices"], dtype=np.uint32)
        pos_view = add_view(pos.tobytes(), 34962)      # ARRAY_BUFFER
        idx_view = add_view(idx.tobytes(), 34963)      # ELEMENT_ARRAY_BUFFER
        pmin = pos.min(axis=0).tolist()
        pmax = pos.max(axis=0).tolist()
        accessors.append({"bufferView": pos_view, "componentType": 5126,  # FLOAT
                          "count": int(len(pos)), "type": "VEC3",
                          "min": pmin, "max": pmax})
        pos_acc = len(accessors) - 1
        accessors.append({"bufferView": idx_view, "componentType": 5125,  # UINT
                          "count": int(len(idx)), "type": "SCALAR"})
        idx_acc = len(accessors) - 1
        mat_index = len(materials)
        r, g, b, a = prim["base_color"]
        materials.append({
            "name": prim["material_name"],
            "pbrMetallicRoughness": {
                "baseColorFactor": [r, g, b, a],
                "metallicFactor": 0.0, "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        })
        meshes_prims.append({"attributes": {"POSITION": pos_acc},
                             "indices": idx_acc, "material": mat_index})

    gltf = {
        "asset": {"version": "2.0", "generator": "will-step-to-glb"},
        "scenes": [{"nodes": [0]}], "scene": 0,
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": meshes_prims}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(buffers)}],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":"), sort_keys=True).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "
    bin_bytes = bytes(buffers)
    while len(bin_bytes) % 4 != 0:
        bin_bytes += b"\x00"
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes
    return bytes(out)

def write_glb(path: str, primitives: list[dict]) -> None:
    with open(path, "wb") as f:
        f.write(pack_glb(primitives))
```

- [ ] **Step 4: Run the writer test to verify it passes**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_glb_writer.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for monolithic conversion**

`scripts/step-to-glb/tests/test_convert_monolithic.py`:
```python
import os, struct, json, pathlib
import pytest
from convert import convert_monolithic

STEP = pathlib.Path(__file__).resolve().parents[2] / "render-rig" / "real-assets" / "step" / "RSAA-4040-12.STEP"

@pytest.mark.skipif(not STEP.exists(), reason="real STEP not extracted (offline input)")
def test_pole_converts_to_valid_glb(tmp_path):
    out = tmp_path / "pole.glb"
    stats = convert_monolithic(str(STEP), str(out), origin="base")
    blob = out.read_bytes()
    assert blob[:4] == b"glTF"
    total = struct.unpack("<I", blob[8:12])[0]
    assert total == len(blob)
    # pole is ~12 ft = 3.6576 m tall in Y; near-square X/Z cross-section
    dx, dy, dz = stats["bbox_m"]
    assert 3.5 < dy < 3.75, f"pole height {dy} m not ~12 ft"
    assert dx < 0.2 and dz < 0.2, "pole cross-section not ~4 in"
    assert stats["triangles"] > 0
    # origin='base' => min Y ~ 0
    json_len = struct.unpack("<I", blob[12:16])[0]
    gltf = json.loads(blob[20:20+json_len])
    ymin = gltf["accessors"][0]["min"][1]
    assert abs(ymin) < 0.01, f"base not at Y=0 (ymin={ymin})"
```

- [ ] **Step 6: Run it to verify it fails**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_convert_monolithic.py -v`
Expected: FAIL — `ImportError` (no `convert.py`). (If STEP not extracted, test SKIPS — extract via Task 0 first.)

- [ ] **Step 7: Implement the monolithic converter**

`scripts/step-to-glb/convert.py`:
```python
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

if __name__ == "__main__":
    import sys
    print(convert_monolithic(sys.argv[1], sys.argv[2],
                             origin=sys.argv[3] if len(sys.argv) > 3 else "base"))
```

- [ ] **Step 8: Run the monolithic test to verify it passes**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_convert_monolithic.py -v`
Expected: PASS (pole GLB valid, ~3.66 m tall, base at Y=0).

- [ ] **Step 9: Convert the three monolithic parts**

Run:
```bash
PY=geometry-service/.venv/bin/python
cd scripts/step-to-glb
mkdir -p ../render-rig/real-assets/glb
../../$PY convert.py ../render-rig/real-assets/step/RSAA-4040-12.STEP ../render-rig/real-assets/glb/alum-pole-12.glb base
../../$PY convert.py ../render-rig/real-assets/step/CL2-4R.STEP     ../render-rig/real-assets/glb/bc-round.glb base
../../$PY convert.py ../render-rig/real-assets/step/SH1-40F.STEP    ../render-rig/real-assets/glb/sh1-shepherds-hook.glb base
```
Expected: three `.glb` files; printed stats show pole dy≈3.66, base dy≈0.57, hook present.

- [ ] **Step 10: Commit**

```bash
git add scripts/step-to-glb/glb_writer.py scripts/step-to-glb/convert.py scripts/step-to-glb/tests/
git commit -m "feat: STEP->GLB converter (monolithic mode) + GLB writer"
```

---

## Task 2: Color-aware fixture conversion (XCAF)

Adds a color-aware path for the GVX fixture: read per-solid authored colors, group into primitives, flag aluminum-body vs fixed, and emit a multi-primitive GLB.

**Files:**
- Modify: `scripts/step-to-glb/convert.py`
- Create: `scripts/step-to-glb/tests/test_convert_coloraware.py`

**Interfaces:**
- Consumes: `glb_writer.write_glb`, `tessellate_shape`, `_normalize` (Task 1).
- Produces:
  - `convert.is_aluminum(rgb: tuple[float,float,float], tol: float = 0.06) -> bool` — True when rgb ≈ (0.894,0.894,0.894).
  - `convert.convert_color_aware(step_path, out_glb, origin="top", tol_mm=1.0) -> dict` → writes a GLB with one primitive per authored-color group; aluminum groups get material name `"will-body"`, others `"will-fixed-RRGGBB"`; returns `{"vertices","triangles","primitives","body_primitives"}`.

- [ ] **Step 1: Write the failing test for `is_aluminum` + color-aware conversion**

`scripts/step-to-glb/tests/test_convert_coloraware.py`:
```python
import pathlib, struct, json
import pytest
from convert import is_aluminum, convert_color_aware

def test_is_aluminum_matches_0894_gray():
    assert is_aluminum((0.894, 0.894, 0.894))
    assert not is_aluminum((0.0, 0.0, 0.0))
    assert not is_aluminum((0.29, 0.66, 0.33))  # a green

STEP = pathlib.Path(__file__).resolve().parents[2] / "render-rig" / "real-assets" / "step" / "WD-GVX-PM"

@pytest.mark.skipif(not STEP.exists(), reason="real GVX STEP not extracted")
def test_gvx_color_aware_glb(tmp_path):
    out = tmp_path / "gvx.glb"
    stats = convert_color_aware(str(STEP), str(out), origin="top", tol_mm=2.0)
    blob = out.read_bytes()
    assert blob[:4] == b"glTF"
    assert stats["primitives"] >= 2, "expected multiple color groups"
    assert stats["body_primitives"] >= 1, "expected at least one aluminum-body group"
    json_len = struct.unpack("<I", blob[12:16])[0]
    gltf = json.loads(blob[20:20+json_len])
    names = {m["name"] for m in gltf["materials"]}
    assert any(n == "will-body" for n in names)
    assert any(n.startswith("will-fixed-") for n in names)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_convert_coloraware.py -v`
Expected: FAIL — `ImportError: cannot import name 'is_aluminum'`.

- [ ] **Step 3: Implement the color-aware path**

Append to `scripts/step-to-glb/convert.py`:
```python
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
```

- [ ] **Step 4: Run the color-aware test to verify it passes**

Run: `geometry-service/.venv/bin/python -m pytest scripts/step-to-glb/tests/test_convert_coloraware.py -v`
Expected: PASS. If XCAF extraction errors or yields 0 body primitives (fallback trigger): mark the fixture to use `convert_monolithic` with `origin="top"` instead, note it in the plan's task comments and the final findings, and continue. (Global-constraint fallback.)

- [ ] **Step 5: Convert the fixture**

Run:
```bash
PY=geometry-service/.venv/bin/python
cd scripts/step-to-glb
../../$PY -c "from convert import convert_color_aware as c; print(c('../render-rig/real-assets/step/WD-GVX-PM','../render-rig/real-assets/glb/gvx-pendant.glb', origin='top', tol_mm=1.0))"
```
Expected: prints stats with `primitives >= 2`, `body_primitives >= 1`; `gvx-pendant.glb` written.

- [ ] **Step 6: Commit**

```bash
git add scripts/step-to-glb/convert.py scripts/step-to-glb/tests/test_convert_coloraware.py
git commit -m "feat: color-aware STEP->GLB (XCAF) for the GVX fixture"
```

---

## Task 3: Rig real-geometry support in `main.ts`

Load real GLBs (base64) into a cache, and render them through the existing frame/trim/anchor path with the finish applied per material name.

**Files:**
- Modify: `scripts/render-rig/page/main.ts`

**Interfaces:**
- Consumes: existing `renderPart(partId, finishId)`, `makeMaterial(finish)`, camera/trim path.
- Produces:
  - `window.loadRealModel(partId: string, base64: string): Promise<void>` — parse a GLB and cache a cloneable `THREE.Group`.
  - `renderPart` gains a branch: if `realModels.has(partId)`, use the cached model (clone + apply materials) instead of `specToObject`.

- [ ] **Step 1: Add the GLTFLoader import + model cache (top of `main.ts`, after the THREE import)**

```typescript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const realModels = new Map<string, THREE.Group>()
const gltfLoader = new GLTFLoader()

/** Decode a base64 GLB to an ArrayBuffer (browser). */
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function loadRealModel(partId: string, base64: string): Promise<void> {
  const buf = b64ToArrayBuffer(base64)
  const gltf = await gltfLoader.parseAsync(buf, '')
  realModels.set(partId, gltf.scene)
}
```

- [ ] **Step 2: Add finish-application for real models (after `makeMaterial`)**

```typescript
/** Clone a cached real model and apply the finish: whole-part for monolithic;
 *  only `will-body` primitives for the color-aware fixture (keep authored colors). */
function instantiateRealModel(partId: string, finish: FinishDef): THREE.Object3D {
  const src = realModels.get(partId)!
  const root = src.clone(true)
  const finishMat = makeMaterial(finish)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const matName = (m.material as THREE.Material)?.name ?? ''
    if (matName === 'will-body' || matName === '') {
      m.material = finishMat
    }
    // 'will-fixed-*' keep their GLTF-imported material (authored color)
  })
  return root
}
```

- [ ] **Step 3: Branch `renderPart` to use real geometry when cached**

Replace the two lines in `renderPart` that require a placeholder:
```typescript
  const part = catalog.parts.find((p) => p.id === partId)
  if (!part || !part.placeholder) throw new Error(`no placeholder for part ${partId}`)
  const finish = catalog.finishes.find((f) => f.id === finishId)
  if (!finish) throw new Error(`no finish ${finishId}`)

  const material = makeMaterial(finish)
  const object = specToObject(part.placeholder, material)
```
with:
```typescript
  const part = catalog.parts.find((p) => p.id === partId)
  const finish = catalog.finishes.find((f) => f.id === finishId)
  if (!finish) throw new Error(`no finish ${finishId}`)

  const useReal = realModels.has(partId)
  if (!useReal && (!part || !part.placeholder)) throw new Error(`no placeholder for part ${partId}`)

  const material = makeMaterial(finish)
  const object = useReal ? instantiateRealModel(partId, finish) : specToObject(part!.placeholder!, material)
```
(Keep the existing `material.dispose()` at the end; it is harmless for the real path since real meshes reference `finishMat`/imported materials. To avoid disposing a still-referenced material, guard it: change `material.dispose()` to `if (!useReal) material.dispose()`.)

- [ ] **Step 4: Expose `loadRealModel` on window (in the boot block)**

In the `declare global` Window interface add:
```typescript
    loadRealModel: typeof loadRealModel
```
and in the `.then(() => { ... })` boot callback add:
```typescript
    window.loadRealModel = loadRealModel
```

- [ ] **Step 5: Typecheck the rig page**

Run: `npx tsc --noEmit -p tsconfig.json` (from repo root).
Expected: no new errors in `scripts/render-rig/page/main.ts`. (If the rig page isn't in the root tsconfig include, run `npx tsc --noEmit scripts/render-rig/page/main.ts --moduleResolution bundler --module esnext --target es2020 --skipLibCheck` and expect no errors.)

- [ ] **Step 6: Commit**

```bash
git add scripts/render-rig/page/main.ts
git commit -m "feat: render-rig loads real GLB geometry with finish material application"
```

---

## Task 4: Driver wiring + real-parts mapping

`generate.mjs` reads a mapping file and preloads each real GLB into the page (base64) before rendering that part's finishes.

**Files:**
- Create: `scripts/render-rig/real-parts.json`
- Modify: `scripts/render-rig/generate.mjs`

**Interfaces:**
- Consumes: `window.loadRealModel(partId, base64)` (Task 3).
- Produces: real GLB layers written into the normal per-part manifest flow.

- [ ] **Step 1: Create the mapping file**

`scripts/render-rig/real-parts.json`:
```json
{
  "alum-pole-12": "real-assets/glb/alum-pole-12.glb",
  "bc-round": "real-assets/glb/bc-round.glb",
  "sh1-shepherds-hook": "real-assets/glb/sh1-shepherds-hook.glb",
  "gvx-pendant": "real-assets/glb/gvx-pendant.glb"
}
```

- [ ] **Step 2: Load the mapping + read GLB bytes in `generate.mjs`**

After `const OUT_DIR = ...` add:
```javascript
import { existsSync } from 'node:fs'
const REALPARTS_PATH = resolve(__dirname, 'real-parts.json')
```
In `main()`, after `const catalog = ...`:
```javascript
  let realParts = {}
  try {
    realParts = JSON.parse(await readFile(REALPARTS_PATH, 'utf8'))
  } catch { /* no real parts mapped */ }
```

- [ ] **Step 3: Preload the GLB before each part's finish loop**

In the `for (const part of parts)` loop, immediately inside it (before `const finishes = {}`):
```javascript
      const realRel = realParts[part.id]
      if (realRel) {
        const glbPath = resolve(__dirname, realRel)
        if (existsSync(glbPath)) {
          const b64 = (await readFile(glbPath)).toString('base64')
          await page.evaluate((pid, data) => window.loadRealModel(pid, data), part.id, b64)
          console.log(`  loaded real geometry for ${part.id} (${(b64.length/1e6).toFixed(1)}MB b64)`)
        } else {
          console.error(`  MISSING GLB for ${part.id}: ${glbPath} — using placeholder`)
        }
      }
```

- [ ] **Step 4: Make the console log tolerate real parts (no placeholder.kind)**

Change the per-part summary line:
```javascript
      console.log(`  ${part.id}: ${n}/${finishIds.length} finishes  (${part.placeholder.kind})`)
```
to:
```javascript
      const kind = realParts[part.id] ? 'real' : part.placeholder.kind
      console.log(`  ${part.id}: ${n}/${finishIds.length} finishes  (${kind})`)
```

- [ ] **Step 5: Smoke-test the driver on one real part**

Run: `node scripts/render-rig/generate.mjs --parts alum-pole-12`
Expected: logs "loaded real geometry for alum-pole-12", writes `public/renders/alum-pole-12--hero--<finish>.webp` for all finishes, `manifest-all.json` written, "render rig complete." Open one WebP and confirm it looks like a real round pole (not a placeholder cylinder).

- [ ] **Step 6: Commit**

```bash
git add scripts/render-rig/real-parts.json scripts/render-rig/generate.mjs
git commit -m "feat: render-rig driver preloads real GLB per part before rendering finishes"
```

---

## Task 5: Assembly alignment + full regen + visual verification

Set corrected sockets for the four parts, regenerate the WiLLstudio shard with real geometry, merge, prove no coverage regression, and capture the real-vs-placeholder comparison.

**Files:**
- Modify: `public/catalog.json` (sockets for `alum-pole-12`, `sh1-shepherds-hook`; `origin` choices in converter runs)
- Regenerate: `public/renders/manifest-studio.json`, `public/renders/manifest.json`

**Interfaces:**
- Consumes: the four real GLBs + the wired rig (Tasks 1–4).
- Produces: an aligned, real-geometry composited assembly in the viewer + a comparison screenshot.

- [ ] **Step 1: Measure the real attachment points**

Run (reusing the Phase 0.6 measurement approach against the extracted STEP):
```bash
geometry-service/.venv/bin/python - <<'PY'
import build123d as b
for k,f in [("pole","RSAA-4040-12.STEP"),("hook","SH1-40F.STEP"),("base","CL2-4R.STEP")]:
    p=b.import_step(f"scripts/render-rig/real-assets/step/{f}")
    bb=p.bounding_box()
    print(k, "Y[",round(bb.min.Y,1),round(bb.max.Y,1),"] X[",round(bb.min.X,1),round(bb.max.X,1),"] Z[",round(bb.min.Z,1),round(bb.max.Z,1),"] mm")
PY
```
Expected (from Phase 0.6): pole top Y≈3657.6 mm; hook reaches along −Z to ≈−513 mm, rises to Y≈729 mm.

- [ ] **Step 2: Set corrected sockets in `public/catalog.json`**

For `alum-pole-12`, keep `top` = `[0, 3.6576, 0]` (matches real 3657.6 mm), `base` = `[0,0,0]`.
For `sh1-shepherds-hook`, set the fixture socket to the real hang offset (meters), reach along −Z:
```json
"sockets": { "fixture": { "type": "pendant", "position": [0, 0.729, -0.513] } }
```
(These are the measured real offsets replacing the placeholder `[0.63,0.45,0]`. Exact values from Step 1.)

- [ ] **Step 3: Choose per-part converter origins so joints line up**

Re-run the converters with origins matching the socket model, into the GLB dir:
- pole: `origin="base"` (already; base at Y=0, so pole sits on ground).
- base cover: `origin="base"` (sits on ground, coaxial).
- hook: `origin="base"` — its clamp/collar bottom at Y=0 so it sits on the pole top socket. If Step 1 shows the collar extends below the grip, re-run with a measured Y shift (adjust `_normalize` call) — verify visually in Step 6.
- fixture: `origin="top"` (mount at top-center at Y=0) so it hangs from the hook fixture socket.

Commands: same as Task 1 Step 9 / Task 2 Step 5 with the origins above.

- [ ] **Step 4: Regenerate the WiLLstudio shard (all studio parts; 4 real, rest placeholder)**

Run: `node scripts/render-rig/generate.mjs --line WiLLstudio`
Expected: all WiLLstudio parts rendered; the 4 mapped parts log "(real)"; writes `public/renders/manifest-studio.json` containing every studio part (4 real, others placeholder). No EMPTY/FAIL lines.

- [ ] **Step 5: Merge shards and run the coverage regression**

Run:
```bash
node scripts/render-rig/merge-manifests.mjs
npx vitest run src/lib/composite.coverage.test.ts
```
Expected: merge reports 105 parts, identical rig block accepted; coverage test PASS (every part × 5 finishes + every builder combo composites with 0 missing). Then full suite:
```bash
npm run test
```
Expected: all pass (unchanged count; compositor/viewer untouched).

- [ ] **Step 6: Visual verification — real assembly + comparison screenshot**

Run the app and drive the target assembly (round pole `alum-pole-12` + `bc-round` + `sh1-shepherds-hook` + `gvx-pendant`) in the WiLLstudio builder. Use the `verify` skill / `run` skill to launch the app and screenshot the viewer. Confirm:
- the four real layers composite into an aligned pole assembly (no floating fixture; base coaxial; hook on pole top);
- finish swap works across all 5 finishes (pole/base/hook fully recolor; fixture housing recolors while lens/LED keep authored color);
- capture a before/after: `git stash` the manifest to screenshot placeholders, then restore for the real version (or render two manifests to temp paths). Save both PNGs to `scripts/render-rig/real-assets/` for the write-up.

If the fixture floats or a joint is off, adjust the socket offset (Step 2) or the converter origin (Step 3) and re-run Steps 4–6. This nudge loop is expected.

- [ ] **Step 7: Commit the catalog + regenerated manifests**

```bash
git add public/catalog.json public/renders/manifest-studio.json public/renders/manifest.json public/renders/*.webp
git commit -m "feat: real-geometry layers for the WiLLstudio target assembly + corrected sockets"
```

- [ ] **Step 8: Write the PoC result note**

Create `docs/superpowers/plans/real-geometry-rig-results.md`: per-part conversion stats, WebP sizes (vs placeholder), whether the color-aware fixture path worked or fell back, alignment method + any residual joint error, the before/after screenshots, and a go/no-go recommendation for rolling real geometry across the catalog. Commit it.

---

## Self-review notes

- **Spec coverage:** converter (Tasks 1–2), rig branch (Task 3), driver + `realModel` mapping (Task 4), corrected sockets + regen + coverage + visual (Task 5), gitignore/offline-GLB (Task 0 + Global Constraints), fallback (Task 2 Step 4). Lighting kept unchanged (no task touches lights). All spec sections map to a task.
- **Rig-block invariant:** no task edits `PX_PER_M`, `AZIMUTH_DEG`, `ELEVATION_DEG`, or the camera; merge assertion therefore holds. ✓
- **Coverage invariant:** Task 5 regenerates the *whole* studio shard (not a 4-part shard), so no studio parts are dropped and real layers win the merge naturally. ✓
- **Type/name consistency:** `loadRealModel`, `instantiateRealModel`, `realModels`, material names `will-body` / `will-fixed-*` used identically across Tasks 2–4. ✓
- **Fallback path is explicit and non-blocking** (Task 2 Step 4). ✓
