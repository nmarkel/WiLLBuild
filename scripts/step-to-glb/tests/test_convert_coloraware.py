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
