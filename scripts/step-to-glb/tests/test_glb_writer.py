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
