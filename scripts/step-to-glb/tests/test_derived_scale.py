"""Regression guard for the actual axial-scale math used to derive the other
pole heights from the one real 12 ft pole export (Phase 0.10.5, D10).

`test_derived_poles.py` (one directory up) only asserts on `ingest.DERIVED`'s
metadata dict -- it never calls the real transform. This test exercises
`convert_monolithic(..., scale_y=...)` against the real STEP and checks the
resulting geometry directly, so a future change that scales the wrong axis,
applies the scale before re-basing (which would lift the pole off the floor),
or inverts the factor would be caught here.

Gated like `test_convert_monolithic.py`: only runs on machines that have the
gitignored real-CAD input checked out.
"""
import pathlib

import pytest

from convert import convert_monolithic

STEP = pathlib.Path(__file__).resolve().parents[2] / "render-rig" / "real-assets" / "step" / "RSAA-4040-12.STEP"

SOURCE_HEIGHT_FT = 12.0
TARGET_HEIGHT_FT = 20.0
SCALE_Y = TARGET_HEIGHT_FT / SOURCE_HEIGHT_FT  # 20/12 ~= 1.6667
FT_TO_M = 0.3048
EXPECTED_HEIGHT_M = TARGET_HEIGHT_FT * FT_TO_M  # 6.096 m
EXPECTED_OD_M = 0.1016  # 4 in


@pytest.mark.skipif(not STEP.exists(), reason="real STEP not extracted (offline input)")
def test_derived_pole_scale_lengthens_without_floating_or_fattening(tmp_path):
    out = tmp_path / "alum-pole-20.glb"
    stats = convert_monolithic(str(STEP), str(out), origin="base", scale_y=SCALE_Y)

    dx, dy, dz = stats["bbox_m"]

    # The pole grew to the target catalog height (within ~1 cm).
    assert abs(dy - EXPECTED_HEIGHT_M) < 0.01, (
        f"scaled height {dy} m not within 1 cm of {EXPECTED_HEIGHT_M} m (20 ft)"
    )

    # The base still sits at y ~ 0 -- proves the scale is applied AFTER
    # re-basing, not before (which would lift the pole off the floor).
    blob = out.read_bytes()
    import json
    import struct

    json_len = struct.unpack("<I", blob[12:16])[0]
    gltf = json.loads(blob[20:20 + json_len])
    ymin = gltf["accessors"][0]["min"][1]
    assert abs(ymin) < 0.01, f"base not at Y=0 after scaling (ymin={ymin})"

    # X/Z cross-section is unchanged (~4 in OD) -- proves only the Y axis
    # scaled, not the whole solid uniformly (which would also fatten it).
    assert abs(dx - EXPECTED_OD_M) < 0.005, f"X extent {dx} m drifted from {EXPECTED_OD_M} m OD"
    assert abs(dz - EXPECTED_OD_M) < 0.005, f"Z extent {dz} m drifted from {EXPECTED_OD_M} m OD"
