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

@pytest.mark.skipif(not STEP.exists(), reason="real STEP not extracted (offline input)")
def test_default_conversion_emits_normals(tmp_path):
    """Phase 0.16 Workstream B: exact B-rep normals are the conversion DEFAULT.

    Without a NORMAL accessor three.js forces flatShading and every curved
    surface bands (the 0.16 diagnosis) — a regression that silently drops the
    attribute would re-ship the defect fleet-wide on the next re-ingest.
    """
    import numpy as np
    out = tmp_path / "pole-default.glb"
    convert_monolithic(str(STEP), str(out), origin="base")
    blob = out.read_bytes()
    json_len = struct.unpack("<I", blob[12:16])[0]
    gltf = json.loads(blob[20:20+json_len])
    prim = gltf["meshes"][0]["primitives"][0]
    assert "NORMAL" in prim["attributes"], "default conversion must ship normals"
    nacc = gltf["accessors"][prim["attributes"]["NORMAL"]]
    assert nacc["count"] == gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
    bv = gltf["bufferViews"][nacc["bufferView"]]
    off = 20 + json_len + 8 + bv.get("byteOffset", 0)
    nrm = np.frombuffer(blob[off:off + bv["byteLength"]], dtype=np.float32).reshape(-1, 3)
    lens = np.linalg.norm(nrm.astype(np.float64), axis=1)
    assert np.all(np.abs(lens - 1.0) < 1e-3)
