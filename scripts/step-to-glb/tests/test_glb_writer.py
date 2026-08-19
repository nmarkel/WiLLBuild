import struct
import numpy as np
from glb_writer import pack_glb

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

def test_pack_glb_optional_normals_accessor():
    # Phase 0.16: a primitive may carry per-vertex normals; when present they
    # ship as a NORMAL accessor so three.js shades smooth instead of being
    # FORCED to flatShading (three r185 WebGLPrograms: normal attribute absent
    # on a Standard/Physical material => flatShading, whatever the material says).
    import json as _json
    tri = _triangle()
    tri["normals"] = np.array([[0,0,1],[0,0,1],[0,0,1]], dtype=np.float32)
    blob = pack_glb([tri, _triangle()])  # second prim has none
    json_len = struct.unpack("<I", blob[12:16])[0]
    gltf = _json.loads(blob[20:20+json_len].decode("utf-8"))
    p0, p1 = gltf["meshes"][0]["primitives"]
    assert "NORMAL" in p0["attributes"]
    assert "NORMAL" not in p1["attributes"]
    nacc = gltf["accessors"][p0["attributes"]["NORMAL"]]
    assert nacc["type"] == "VEC3" and nacc["componentType"] == 5126
    assert nacc["count"] == gltf["accessors"][p0["attributes"]["POSITION"]]["count"]
    # normals bytes really are in the buffer
    bv = gltf["bufferViews"][nacc["bufferView"]]
    bin_start = 20 + json_len + 8
    off = bin_start + bv.get("byteOffset", 0)
    got = np.frombuffer(blob[off:off + bv["byteLength"]], dtype=np.float32).reshape(-1, 3)
    assert np.allclose(got, [[0, 0, 1]] * 3)
