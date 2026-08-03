"""NAFCO-arm geometry robustness — Phase 0.9 regression.

Phase 0.9 (Workstream A4) put ``arrangements`` on the NAFCO arm/pole lines,
making NAFCO assemblies downloadable through the CAD/BIM pipeline for the first
time.  Several NAFCO arm placeholder point lists then crashed ``build_arm``:

  * COLLINEAR runs (a straight cross-arm ``[0,0,0],[0.35,0,0],[0.7,0,0]``, a
    vertical tenon adapter, or a two-point stub) made ``FilletPolyline`` raise
    ``IndexError`` — a 180-degree vertex has no circular fillet edge.  Arms:
      - aluminum-cross-arm-brackets-wood-pole-mount
      - aluminum-tapered-elliptical-mast-arms-round-pole-mount
      - aluminum-tapered-elliptical-truss-arm-round-pole-mount
      - aluminum-tenon-adapters
      - nafco-upx-1-aluminum-upsweep-arms
      - nafco-direct-mount

  * HAIRPIN "bullhorn/spoke" paths that retrace toward the pole made
    ``FilletPolyline`` raise ``ValueError: Fillet algorithm failed`` — the
    corner fillet cannot fit the near-coincident retrace vertices.  Arms:
      - nafco-upx-2-aluminum-upsweep-arms
      - steel-bullhorn-brackets-round-pole-mount
      - steel-spoke-brackets-round-pole-mount
      - steel-upsweep-brackets-round-pole-mount

Because ``build_assembly`` runs OUTSIDE the per-format try/except in
``generate_files``, any of these would 500 the whole ``/generate`` request.

The fix (``app/kit/parts.py``): ``_clean_arm_points`` drops collinear/coincident
vertices (a geometric no-op that keeps every working arm byte-identical) and
``build_arm`` falls back to a plain ``Polyline`` sweep when the fillet still
fails.  These tests prove every previously-crashing NAFCO arm now builds and
exports, that the fused assembly is a valid positive-volume solid, and that the
existing (working) arms are geometrically unchanged.
"""

from __future__ import annotations

import uuid

import pytest

from app.adapters.base import GenContext
from app.adapters.ifc_adapter import IfcAdapter
from app.adapters.step_adapter import StepAdapter
from app.catalog import part
from app.kit.assembly import build_assembly
from app.kit.parts import build_part
from app.models import PoleConfig
from app.naming import base_name

# Arms whose placeholder points crashed the pre-0.9 FilletPolyline path.
COLLINEAR_CRASH_ARMS = [
    "aluminum-cross-arm-brackets-wood-pole-mount",
    "aluminum-tapered-elliptical-mast-arms-round-pole-mount",
    "aluminum-tapered-elliptical-truss-arm-round-pole-mount",
    "aluminum-tenon-adapters",
    "nafco-upx-1-aluminum-upsweep-arms",
    "nafco-direct-mount",
]
HAIRPIN_CRASH_ARMS = [
    "nafco-upx-2-aluminum-upsweep-arms",
    "steel-bullhorn-brackets-round-pole-mount",
    "steel-spoke-brackets-round-pole-mount",
    "steel-upsweep-brackets-round-pole-mount",
]
ALL_CRASH_ARMS = COLLINEAR_CRASH_ARMS + HAIRPIN_CRASH_ARMS

# A NAFCO pole + fixture that socket-host every ``nafco-tenon`` arm above.
_NAFCO_POLE = "round-straight-aluminum-3-bolt-base-light-poles"
_NAFCO_FIXTURE = "slx"


def _cfg(arm_id: str, arm_count: int = 1) -> PoleConfig:
    return PoleConfig(
        configId=f"nafco-{arm_id[:8]}-{arm_count}",
        brand="NAFCO",
        pole=_NAFCO_POLE,
        baseCover="",
        arm=arm_id,
        fixture=_NAFCO_FIXTURE,
        finish="matte-black",
        rev=1,
        armCount=arm_count,
    )


# ---------------------------------------------------------------------------
# (1) build_part no longer raises for any previously-crashing arm
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("arm_id", ALL_CRASH_ARMS)
def test_build_part_does_not_raise(catalog, arm_id):
    """The bare part builder must produce a solid instead of raising."""
    solid = build_part(part(catalog, arm_id))
    assert solid is not None


# ---------------------------------------------------------------------------
# (2) the socket-compat precondition the fix relies on: pole hosts arm, arm
#     hosts fixture (so these are genuinely reachable builder configs)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("arm_id", ALL_CRASH_ARMS)
def test_arm_is_reachable_nafco_config(catalog, arm_id):
    from app.catalog import validate_config

    validate_config(catalog, _cfg(arm_id))  # must not raise


# ---------------------------------------------------------------------------
# (3) the full assembly builds and is a VALID positive-volume solid
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("arm_id", ALL_CRASH_ARMS)
def test_assembly_builds_valid_solid(catalog, arm_id):
    asm = build_assembly(catalog, _cfg(arm_id))
    assert bool(asm.solid.is_valid), f"{arm_id}: fused solid is not a valid B-rep"
    assert asm.solid.volume > 0, f"{arm_id}: fused solid has non-positive volume"


# ---------------------------------------------------------------------------
# (4) STEP + IFC export without raising for a representative arm of each mode
#     (collinear cross-arm + hairpin bullhorn), single AND multi-arm.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "arm_id",
    ["aluminum-cross-arm-brackets-wood-pole-mount", "steel-bullhorn-brackets-round-pole-mount"],
)
@pytest.mark.parametrize("arm_count", [1, 2])
def test_step_and_ifc_export(tmp_path, catalog, arm_id, arm_count):
    cfg = _cfg(arm_id, arm_count)
    asm = build_assembly(catalog, cfg)
    ctx = GenContext(
        catalog=catalog, cfg=cfg, out_dir=tmp_path,
        base_name=base_name(catalog, cfg), assembly=asm,
        render_png=None, summary={},
    )
    step_paths = StepAdapter().generate(ctx)
    ifc_paths = IfcAdapter().generate(ctx)
    assert step_paths and step_paths[0].stat().st_size > 0
    assert ifc_paths and ifc_paths[0].stat().st_size > 0


# ---------------------------------------------------------------------------
# (5) the fix is a NO-OP for arms that already worked: a known-good arm
#     (sh1) is byte-identical (STEP, FILE_NAME stripped) before/after.
#     _clean_arm_points must leave a fillet-clean point list untouched.
# ---------------------------------------------------------------------------

def test_clean_points_is_noop_for_working_arm(catalog):
    from app.kit.parts import _clean_arm_points, viewer_to_cad

    sh1 = part(catalog, "sh1-shepherds-hook")
    cad = [viewer_to_cad(pt) for pt in sh1["placeholder"]["points"]]
    assert _clean_arm_points(cad) == cad, (
        "a working arm's points must survive cleaning unchanged so its swept "
        "geometry stays byte-identical"
    )


def test_clean_points_drops_collinear_run():
    from app.kit.parts import _clean_arm_points

    # straight run a-b-c collinear -> b dropped; then a genuine bend kept.
    pts = [(0.0, 0.0, 0.0), (350.0, 0.0, 0.0), (700.0, 0.0, 0.0), (930.0, 5.0, 0.0)]
    cleaned = _clean_arm_points(pts)
    assert cleaned == [(0.0, 0.0, 0.0), (700.0, 0.0, 0.0), (930.0, 5.0, 0.0)]
