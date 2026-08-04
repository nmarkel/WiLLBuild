"""Real-CAD ingest wiring — Phase 0.10.

Engineering's WiLLstudio STEP drop is gitignored (large, and not in a deploy), so
these tests are written to pass BOTH ways:

* the parts that must hold everywhere — resolution rules, the default-off kit
  switch, graceful degradation — always run;
* the parts that need the actual CAD are skipped when it is not on this machine.

The most important guarantee here is the default: with real geometry present but
the kit switch off, downloads still build from the parametric kit, because fusing
real B-reps is minutes-slow (see realgeom.kit_uses_real_geometry).
"""

from __future__ import annotations

import os
import zipfile

import pytest

from app import realgeom
from app.adapters import REGISTRY
from app.adapters.base import GenContext
from app.catalog import part
from app.kit.parts import build_part
from app.models import PoleConfig
from app.naming import base_name

SS = "willstudio-side-shepherds-hook-pole-top-brackets"

_HAS_CAD = realgeom.real_step_path(SS) is not None
needs_cad = pytest.mark.skipif(not _HAS_CAD, reason="real WiLLstudio CAD not present locally")


def _cfg(**overrides) -> PoleConfig:
    base = dict(
        configId="realgeom-0001",
        pole="alum-pole-12",
        baseCover="bc-fluted",
        arm=SS,
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        armCount=3,
    )
    base.update(overrides)
    return PoleConfig(**base)


# ---------------------------------------------------------------------------
# Resolution rules (no CAD needed)
# ---------------------------------------------------------------------------

def test_unknown_part_has_no_real_geometry():
    assert realgeom.real_step_path("totally-not-a-part") is None
    assert realgeom.has_real_geometry("totally-not-a-part") is False


def test_every_mapped_file_name_is_unique():
    names = list(realgeom.BASE_FILES.values())
    assert len(names) == len(set(names))


def test_cluster_files_are_never_kit_geometry():
    """A cluster file already contains N arms; the kit would repeat it N times."""
    for (part_id, design) in realgeom.CLUSTER_FILES:
        assert (part_id, design) not in realgeom.DESIGN_FILES


def test_design_codes_cover_every_arm_count_of_the_mapped_families():
    for family, prefix in ((SS, "SS"), ("willstudio-suspension-arm-pole-top-brackets", "AR")):
        codes = {d for (p, d) in {**realgeom.DESIGN_FILES, **realgeom.CLUSTER_FILES} if p == family}
        assert codes == {f"{prefix}{n}" for n in (1, 2, 3, 4)}


def test_disable_switch_wins(monkeypatch):
    monkeypatch.setenv("DISABLE_REAL_GEOMETRY", "1")
    assert realgeom.real_step_path(SS) is None
    assert realgeom.cluster_step_path(SS, "SS3") is None


def test_kit_real_geometry_is_off_by_default(monkeypatch):
    monkeypatch.delenv("REAL_GEOMETRY_IN_KIT", raising=False)
    assert realgeom.kit_uses_real_geometry() is False
    monkeypatch.setenv("REAL_GEOMETRY_IN_KIT", "1")
    assert realgeom.kit_uses_real_geometry() is True


def test_parametric_geometry_is_what_downloads_use(catalog, monkeypatch):
    """The 0.9 behaviour is preserved by default even with real CAD on disk."""
    monkeypatch.delenv("REAL_GEOMETRY_IN_KIT", raising=False)
    realgeom.load_real_solid.cache_clear()
    solid = build_part(part(catalog, "alum-pole-12"))
    # The parametric pole is a single tapered loft: far fewer faces than real CAD.
    assert len(solid.faces()) <= 8


# ---------------------------------------------------------------------------
# With the real CAD present
# ---------------------------------------------------------------------------

@needs_cad
def test_design_code_selects_the_right_file():
    assert realgeom.real_step_path(SS, "SS1").name == "SS1-40F.STEP"
    # SS3 is a cluster: not kit geometry, so resolution falls back to the base file.
    assert realgeom.real_step_path(SS, "SS3").name == "SS1-40F.STEP"
    assert realgeom.cluster_step_path(SS, "SS3").name == "SS3-40F.STEP"


@needs_cad
def test_available_parts_lists_the_ingested_components():
    parts = realgeom.available_parts()
    assert SS in parts
    assert "alum-pole-12" in parts
    assert len(parts) >= 10


@needs_cad
def test_real_pole_imports_at_true_size_in_the_kit_frame(catalog, monkeypatch):
    """RSAA-4040-12 is a 4 in OD, 12 ft pole standing on Z=0."""
    monkeypatch.setenv("REAL_GEOMETRY_IN_KIT", "1")
    realgeom.load_real_solid.cache_clear()
    solid = build_part(part(catalog, "alum-pole-12"))
    bb = solid.bounding_box()
    assert bb.min.Z == pytest.approx(0.0, abs=0.5)
    assert bb.size.Z == pytest.approx(12 * 304.8, abs=2.0)   # 12 ft
    assert bb.size.X == pytest.approx(4 * 25.4, abs=2.0)     # 4 in OD
    realgeom.load_real_solid.cache_clear()


@needs_cad
def test_real_arm_reaches_along_plus_x(catalog, monkeypatch):
    """Arms must reach on +X, the axis the assembly rotates about the pole."""
    monkeypatch.setenv("REAL_GEOMETRY_IN_KIT", "1")
    realgeom.load_real_solid.cache_clear()
    solid = build_part(part(catalog, SS))
    bb = solid.bounding_box()
    assert bb.max.X > 0.6 * 1000 * 0.6  # reaches out (mm)
    assert abs(bb.min.X) < 100          # collar stays on the pole axis
    assert bb.min.Z == pytest.approx(0.0, abs=0.5)
    realgeom.load_real_solid.cache_clear()


@needs_cad
def test_bundle_ships_factory_cad_named_by_part_number(tmp_path, catalog):
    """The zip carries Engineering's own STEP for the configured SKU."""
    if "bundle" not in REGISTRY:
        pytest.skip("bundle adapter unavailable")
    from app.kit.assembly import build_assembly

    cfg = _cfg()
    os.environ.pop("REAL_GEOMETRY_IN_KIT", None)
    realgeom.load_real_solid.cache_clear()
    assembly = build_assembly(catalog, cfg)
    ctx = GenContext(
        catalog=catalog, cfg=cfg, out_dir=tmp_path,
        base_name=base_name(catalog, cfg), assembly=assembly,
        render_png=None, summary={"parts": [], "dims": {}},
    )
    paths = REGISTRY["bundle"].generate(ctx)
    with zipfile.ZipFile(paths[0]) as zf:
        names = zf.namelist()
        factory = [n for n in names if n.startswith("factory-cad/")]
        # SS3 is the configured design → Engineering's 3-arm assembly ships as-is.
        assert "factory-cad/WP-SS3-40F-BK.step" in factory
        assert all(n.endswith(".step") for n in factory)
        # Deterministic ordering + fixed timestamps.
        assert factory == sorted(factory)
        for info in zf.infolist():
            assert info.date_time == (1980, 1, 1, 0, 0, 0)
