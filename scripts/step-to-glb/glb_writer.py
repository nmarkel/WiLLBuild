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
