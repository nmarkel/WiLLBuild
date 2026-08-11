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

import pytest

from app import realgeom
from app.catalog import part
from app.kit.parts import build_part

SS = "willstudio-side-shepherds-hook-pole-top-brackets"

_HAS_CAD = realgeom.real_step_path(SS) is not None
needs_cad = pytest.mark.skipif(not _HAS_CAD, reason="real WiLLstudio CAD not present locally")


# ---------------------------------------------------------------------------
# Resolution rules (no CAD needed)
# ---------------------------------------------------------------------------

def test_unknown_part_has_no_real_geometry():
    assert realgeom.real_step_path("totally-not-a-part") is None
    assert realgeom.has_real_geometry("totally-not-a-part") is False


def test_every_mapped_file_name_is_unique():
    names = list(realgeom.BASE_FILES.values())
    assert len(names) == len(set(names))


def test_every_selectable_base_cover_resolves_its_own_real_cad():
    """Phase 0.12 (A3) — the base-cover download mapping.

    BASE_FILES carried the pre-spec-sheet GUESS (bc-round->CL1,
    aluminum-light-pole-base-covers->CL2, bc-fluted->CL3).  Those three are
    SUPERSEDED standalone catalog entries with no real CAD of their own, while
    the five base covers a customer can actually select resolved to nothing and
    downloaded parametric placeholders.  The renders were corrected in 0.10.5;
    this table never was.

    The correct mapping is the ingest record's (scripts/step-to-glb/ingest.py):
    CL1/CL2/CL3 = small/medium/large clamshell, SC1/SC2 = spun collars.
    """
    expected = {
        "bc-cl1-small-clamshell": "CL1-4R.STEP",
        "bc-cl2-medium-clamshell": "CL2-4R.STEP",
        "bc-cl3-large-clamshell": "CL3-4R.STEP",
        "bc-sc1-spun-collar": "SC1-4R.STEP",
        "bc-sc2-spun-collar-split": "SC2-4R.STEP",
    }
    for part_id, filename in expected.items():
        assert realgeom.BASE_FILES.get(part_id) == filename, (
            f"{part_id} must resolve its own real CAD, not a placeholder"
        )


def test_superseded_base_cover_entries_claim_no_real_cad():
    """The three retired entries have no CAD on Synology — awaiting Cole.

    Leaving them mapped is worse than leaving them empty: it hands a customer
    another base cover's geometry under this product's name.
    """
    for part_id in ("bc-round", "bc-fluted", "aluminum-light-pole-base-covers"):
        assert part_id not in realgeom.BASE_FILES
        assert not any(p == part_id for (p, _d) in realgeom.DESIGN_FILES)


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
    from app.kit.parts import build_pole

    monkeypatch.delenv("REAL_GEOMETRY_IN_KIT", raising=False)
    realgeom.load_real_solid.cache_clear()
    p = part(catalog, "alum-pole-12")
    solid = build_part(p)
    # Same shape as the explicit parametric builder — i.e. the real STEP on disk
    # was NOT used, confirming the kit-switch default (Phase 0.10.5's catalog gave
    # alum-pole-12 a richer group placeholder, so a bare face-count ceiling no
    # longer distinguishes parametric from real; comparing to the known-parametric
    # build does).
    parametric = build_pole(p)
    assert len(solid.faces()) == len(parametric.faces())
    assert solid.volume == pytest.approx(parametric.volume, rel=1e-9)


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
