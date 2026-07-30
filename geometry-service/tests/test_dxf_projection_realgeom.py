"""Regression test — DXF projection silhouette must NOT be blank on real B-reps.

Phase 0.6 spike bug: build123d ``project()`` returns an *empty* ShapeList on
Cole's real imported STEP B-reps without raising, so the old
``DxfProjectionAdapter`` silently wrote zero silhouette geometry (only the
title block + dimensions rendered).  The fix detects the empty projection and
falls back to an OCP HLR hidden-line outline.

This test drives the real spike driver (Cole's STEP under the spike working
dir) and asserts the produced DXF modelspace contains a non-trivial number of
LINE entities in the drawing area (silhouette NOT empty) plus the dimension
entities.  It skips cleanly when the STEP files / spike driver are absent so CI
without the real geometry still passes.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import ezdxf
import pytest

# The spike driver + real STEP files live outside the repo, under the agent
# working directory.  Locate them; skip the whole module if unavailable.
_WD = Path(
    "/private/tmp/claude-502/-Users-nickmarkel-Documents-WiLLBuild/"
    "66193612-2148-47b1-91c3-876294f82493/scratchpad/spike06"
)
_DRIVER = _WD / "spike_driver.py"
_STEP_DIR = _WD / "step"

_have_realgeom = (
    _DRIVER.exists()
    and _STEP_DIR.exists()
    and any(_STEP_DIR.glob("*.STEP"))
)

pytestmark = pytest.mark.skipif(
    not _have_realgeom,
    reason="real STEP files / spike driver not present (CI without geometry)",
)


def _load_driver():
    import sys

    sys.path.insert(0, str(_WD))
    spec = importlib.util.spec_from_file_location("spike_driver", _DRIVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_real_geometry_silhouette_not_blank(tmp_path):
    """Real-geometry DXF must have a real silhouette + the dimensions."""
    driver = _load_driver()
    from app.adapters.dxf_projection_adapter import DxfProjectionAdapter

    ctx = driver.build_ctx(tmp_path / "realgeom", include_fixture=False)
    paths = DxfProjectionAdapter().generate(ctx)
    dxf_path = [p for p in paths if p.suffix == ".dxf"][0]

    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    lines = [e for e in msp if e.dxftype() == "LINE"]
    dims = [e for e in msp if e.dxftype() == "DIMENSION"]

    # Silhouette points sit near the assembly (title block is far to the right).
    sil_pts = []
    for e in lines:
        for pt in (e.dxf.start, e.dxf.end):
            if abs(pt.x) < 2000 and -200 < pt.y < 5000:
                sil_pts.append((pt.x, pt.y))

    # 1. Non-blank silhouette: many LINEs, not just the handful of title-block
    #    rules.  The HLR outline of the real assembly writes thousands.
    assert len(sil_pts) > 100, (
        f"Silhouette looks blank: only {len(sil_pts)} elevation line points "
        f"(total LINEs={len(lines)}). The empty-projection fallback did not fire."
    )

    # 2. The silhouette spans the real overall height (~4386 mm).
    ys = [y for _, y in sil_pts]
    span = max(ys) - min(ys)
    assert span > 4000.0, (
        f"Silhouette height span {span:.1f}mm does not reach the real "
        f"overall height (~{ctx.assembly.dims.overall_height:.0f}mm)."
    )

    # 3. Dimension callouts are still present (>=4).
    assert len(dims) >= 4, f"Expected >=4 DIMENSION entities, got {len(dims)}"

    # 4. The four spec dimensions appear as callouts.
    measured = [
        abs(d.dxf.actual_measurement)
        for d in dims
        if hasattr(d.dxf, "actual_measurement") and d.dxf.actual_measurement
    ]
    for target in (3657.6, 4386.3, 512.8, 432.3):
        assert any(abs(m - target) <= 5.0 for m in measured), (
            f"Spec dimension {target}mm missing from callouts {measured}"
        )
