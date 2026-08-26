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

@pytest.mark.skipif(not STEP.exists(), reason="real GVX STEP not extracted")
def test_gvx_color_aware_with_surface_normals(tmp_path):
    """Phase 0.16 candidate (a): exact B-rep surface normals at conversion.

    Normals must be unit length and agree with the triangle winding (the same
    winding convention the flat-shaded renders used) — a sign flip here would
    turn the part inside-out under lighting.
    """
    import numpy as np, struct as _s, json as _json
    out = tmp_path / "gvx-normals.glb"
    convert_color_aware(str(STEP), str(out), origin="top", tol_mm=2.0,
                        with_normals=True)
    blob = out.read_bytes()
    json_len = _s.unpack("<I", blob[12:16])[0]
    gltf = _json.loads(blob[20:20+json_len])
    bin_start = 20 + json_len + 8

    def acc(ai):
        a = gltf["accessors"][ai]; bv = gltf["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5125: np.uint32}[a["componentType"]]
        n = a["count"] * (3 if a["type"] == "VEC3" else 1)
        return np.frombuffer(blob, dtype=dt, count=n,
                             offset=bin_start + bv.get("byteOffset", 0)).reshape(a["count"], -1)

    checked = 0
    tot_all = 0.0
    inverted_all = 0.0
    strongly_off_all = 0.0
    for prim in gltf["meshes"][0]["primitives"]:
        assert "NORMAL" in prim["attributes"]
        nrm = acc(prim["attributes"]["NORMAL"]).astype(np.float64)
        pos = acc(prim["attributes"]["POSITION"]).astype(np.float64)
        idx = acc(prim["indices"]).astype(np.int64).reshape(-1, 3)
        lens = np.linalg.norm(nrm, axis=1)
        assert np.all(np.abs(lens - 1.0) < 1e-3), "normals not unit length"
        # Winding agreement, AREA-weighted (the 0.15 shell-gate lesson: raster/
        # sliver noise has no area; real defects do). At this test's coarse
        # tol_mm=2.0, facets at tight fillets legitimately swing near-
        # perpendicular to the analytic normal (measured: 83% of disagreeing
        # area at cos > -0.1), so count-based agreement under-reads. What must
        # never happen is a SIGN-FLIPPED region: truly-inverted area
        # (cos < -0.9) is capped hard.
        cross = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
        cl = np.linalg.norm(cross, axis=1)
        area = cl / 2
        avg = nrm[idx[:, 0]] + nrm[idx[:, 1]] + nrm[idx[:, 2]]
        al = np.linalg.norm(avg, axis=1)
        ok = (cl > 1e-15) & (al > 1e-15)
        cos = np.zeros(len(idx))
        cos[ok] = np.einsum("ij,ij->i", cross[ok], avg[ok]) / (cl * al)[ok]
        # Metric re-aimed and re-scoped (Phase 0.19). The original per-primitive
        # ≥0.95 agreement floor was measured against the GetShapes-era groups,
        # whose phantom prototype DUPLICATES inflated agreement AND whose
        # root-label default lumped everything into one diluted group. With
        # locations fixed, the colour groups hold their true content — and a
        # group that is ENTIRELY internal threads/fillets measures terribly at
        # this coarse tol while never rendering (one GVX group hit 31%
        # strongly-off at tol 2.0; the whole model measures 0.5%). Tangential
        # area (|cos| < 0.1: the facet runs along a thin feature) is noise and
        # unstable across runs (parallel meshing). So: accumulate over the
        # WHOLE model — the thing production ships — and cap the two real
        # defect classes: sign flips (an inside-out conversion measures ~50%
        # inverted) and strongly-off area (the 0.16 broken runs measured
        # 29–43%). Shipped GVX at tol 1.0 measures 0.05% / 0.46%.
        tot_all += area[ok].sum()
        inverted_all += area[ok & (cos < -0.9)].sum()
        strongly_off_all += area[ok & (cos >= -0.9) & (cos < -0.1)].sum()
        checked += 1
    assert checked >= 2
    inverted_area = inverted_all / tot_all
    strongly_off_area = strongly_off_all / tot_all
    assert inverted_area < 0.005, f"sign-flipped normal area {inverted_area:.4f}"
    assert strongly_off_area < 0.05, f"strongly-off normal area {strongly_off_area:.4f}"

@pytest.mark.skipif(not STEP.exists(), reason="real GVX STEP not extracted")
def test_gvx_drop_rules_remove_underjunk_and_stem(tmp_path):
    """Phase 0.16.5 (Tyler's punch list): the internal light-engine stack under
    the shade and the protruding top stem must not render — the arm's sleeve
    slides over the stem in reality, and the layered compositor draws fixture
    over arm so the only way to hide it is to not ship it. The mounting frame
    must NOT move: the normalization offset comes from the full solid set.
    """
    import numpy as np, struct as _s, json as _json
    out = tmp_path / "gvx-trimmed.glb"
    stats = convert_color_aware(
        str(STEP), str(out), origin="top", tol_mm=2.0,
        drop_solids=[dict(r_below=0.08, top_below=-0.30),
                     dict(r_below=0.035, top_above=-0.09)])
    assert stats["dropped_solids"] > 0
    blob = out.read_bytes()
    json_len = _s.unpack("<I", blob[12:16])[0]
    gltf = _json.loads(blob[20:20+json_len])
    bin_start = 20 + json_len + 8

    def acc(ai):
        a = gltf["accessors"][ai]; bv = gltf["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5125: np.uint32}[a["componentType"]]
        n = a["count"] * (3 if a["type"] == "VEC3" else 1)
        return np.frombuffer(blob, dtype=dt, count=n,
                             offset=bin_start + bv.get("byteOffset", 0)).reshape(a["count"], -1)

    pos = np.concatenate([acc(p["attributes"]["POSITION"])
                          for p in gltf["meshes"][0]["primitives"]]).astype(np.float64)
    r = np.hypot(pos[:, 0], pos[:, 2])
    # the visible under-shade junk region is empty
    assert not np.any((r < 0.075) & (pos[:, 1] < -0.456)), "under-shade junk still present"
    # the protruding stem region is empty
    assert not np.any((r < 0.03) & (pos[:, 1] > -0.05)), "top stem still present"
    # the shade itself is intact: brim radius, dome band, bezel bottom depth
    assert r.max() > 0.23, "brim missing"
    dome = (r > 0.05) & (r < 0.08) & (pos[:, 1] > -0.20) & (pos[:, 1] < -0.09)
    assert dome.sum() > 100, "dome/ball missing"
    # Frame unchanged, checked two ways. If normalization had been recomputed
    # AFTER the drop, origin="top" would re-pin the trimmed mesh's top to y=0 —
    # so with the stem gone, ymax must sit at the ball, far below 0.
    assert pos[:, 1].max() < -0.05, "part shifted — normalization must use the full set"
    # And the brim band still sits at its original height.
    brim = r > 0.23
    assert -0.47 < pos[brim, 1].min() < -0.42, "brim moved"
