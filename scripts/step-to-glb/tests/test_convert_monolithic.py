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
