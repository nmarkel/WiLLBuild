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


def test_tex_side_mount_mirrors_the_drx_precedent():
    """Phase 0.13: TEX-AREA serves BOTH side-mount codes, exactly as DRX does.

    TEX's mounting column offers 3T (post top), SMS (square pole/wall) and SMR
    (round pole), and Cole released ONE side-mount export on 8/11 — so both
    codes point at it, which is the rule already established for DRX.  Pinned
    because the alternative (mapping only SMR, the code the filename hints at)
    silently leaves SMS resolving to the post-top master.
    """
    for code in ("SMS", "SMR"):
        assert realgeom.CLUSTER_FILES[("tex-post-top", code)] == "TEX-AREA.STEP"
        assert realgeom.CLUSTER_FILES[("drx-post-top", code)] == "DRX-Area-4R-Side-Mount.STEP"
    # 3T is the post-top mounting: it must NOT resolve to the side-mount file.
    assert ("tex-post-top", "3T") not in realgeom.CLUSTER_FILES


def test_gvx_hss_variant_cannot_shadow_the_gvx_master():
    """Phase 0.13: the shield-installed GVX is keyed by its ACCESSORY code.

    GVX-HSS.STEP is the master WITH the House Side Shield fitted.  gvx-pendant's
    design code is plain GVX, which already resolves the 88 MB master through
    BASE_FILES, so keying the variant on a design code would have collided.
    HSS-GVX is the accessory code from the GVX ordering matrix, so it cannot.
    """
    assert realgeom.CLUSTER_FILES[("gvx-pendant", "HSS-GVX")] == "GVX-HSS.STEP"
    assert realgeom.BASE_FILES["gvx-pendant"] == "WD-GVX-PM"
    assert ("gvx-pendant", "GVX") not in realgeom.CLUSTER_FILES
    # Registering a cluster file must never open the customer download gate.
    assert "GVX-HSS.STEP" not in realgeom.CUSTOMER_STEP_FILES.values()
    assert "GVX-HSS.STEP" not in realgeom.CUSTOMER_STEP_FILES_BY_FIT.values()
    # Phase 0.19: the NAME TEX-AREA.STEP is now legitimately in the by-fit
    # allowlist — Cole REPLACED the 8/11 full-engineering file with his
    # simplified export (same name, new bytes, sha b4dc0888…).  The guard this
    # line used to provide by NAME now lives in the hash manifest: the retired
    # full-engineering bytes fail their pin and are never served (see
    # test_customer_manifest_pins_out_the_retired_full_engineering_file).
    assert realgeom.CUSTOMER_STEP_FILES_BY_FIT[("tex-post-top", "SMS")] == "TEX-AREA.STEP"


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


# ---------------------------------------------------------------------------
# Customer-step home + hash manifest (Phase 0.19, Workstream A/B)
# ---------------------------------------------------------------------------

def _manifest_files() -> dict:
    return realgeom._customer_manifest()


def test_every_allowlisted_name_is_pinned_in_the_manifest():
    """A table entry without a SHA pin can never serve — catch it at review time.

    customer_step_path refuses any file that does not hash to its manifest pin,
    so an allowlist entry missing from manifest.json is dead wiring: cleared on
    paper, unshippable in practice.  The two must grow together.
    """
    pins = _manifest_files()
    for name in {*realgeom.CUSTOMER_STEP_FILES.values(), *realgeom.CUSTOMER_STEP_FILES_BY_FIT.values()}:
        assert name in pins, f"{name} is allowlisted but has no manifest pin"
        assert pins[name].get("sha256"), f"{name}: manifest entry carries no sha256"


def test_customer_manifest_pins_out_the_retired_full_engineering_file():
    """Cole replaced TEX-AREA.STEP in place (8/24): same name, simplified bytes.

    The retired 8/11 full-engineering export (sha 3602e91b…, 208 solids) must
    never ship under its reused name — the pin is the simplified file's hash.
    """
    pin = _manifest_files()["TEX-AREA.STEP"]
    assert pin["sha256"] == "b4dc08885264fa291cb4b6790aca342070e0c9242d4d34738aa7b026224c39fd"
    assert pin["sha256"] != "3602e91b186ff1461f3400fd17192e39a707cf655b60a8d1402a0c0929e4e324"


def test_a_hash_mismatched_file_is_treated_as_missing(tmp_path, monkeypatch):
    """The fail-closed core: presence is not clearance — bytes must match the pin.

    Every search root is pointed away from the real staging directory, because
    CUSTOMER_STEP_DIR is a PREPEND and not a swap: leaving the baked-in home in
    the path would let this test pass on the genuine staged file rather than on
    the bad bytes it wrote.
    """
    (tmp_path / "GVX-Simple.STEP").write_bytes(b"NOT THE CLEARED FILE")
    monkeypatch.setenv("CUSTOMER_STEP_DIR", str(tmp_path))
    monkeypatch.setenv("REAL_STEP_DIR", str(tmp_path / "nowhere"))
    monkeypatch.setattr(realgeom, "_DEFAULT_CUSTOMER_STEP_DIR", tmp_path / "nowhere")
    assert realgeom.customer_step_path("gvx-pendant") is None


def test_customer_step_dir_falls_back_to_the_baked_in_home(tmp_path, monkeypatch):
    """A partial override must not hide files baked into the image.

    CUSTOMER_STEP_DIR is the documented S3 seam. When the sync has landed only
    part of the set — or none of it yet — the baked-in home is still searched,
    so pointing the variable at a half-filled mount cannot black out downloads
    that were working a deploy ago.
    """
    empty = tmp_path / "s3-mount"
    empty.mkdir()
    monkeypatch.setenv("CUSTOMER_STEP_DIR", str(empty))
    monkeypatch.setenv("REAL_STEP_DIR", str(tmp_path / "nowhere"))
    baked = realgeom._DEFAULT_CUSTOMER_STEP_DIR / "GVX-Simple.STEP"
    if not baked.is_file():
        pytest.skip("GVX-Simple.STEP not staged on this machine")
    found = realgeom.customer_step_path("gvx-pendant")
    assert found is not None, "an empty override blacked out a baked-in file"
    assert found == baked


def test_an_uncleared_pin_is_never_served(monkeypatch):
    """`cleared` is machine-checked, not prose (Phase 0.19 review).

    A file can be allowlisted, staged and hash-perfect and still not ship: the
    manifest pin has to say a human opened it. Before this gate existed, the
    two TEX pins read "PENDING Nick's Autodesk eyeball" and shipped anyway.
    Both the resolver and the declaration helper must honour it, or the bundle
    tells the customer their CAD is "missing" when it was never released.
    """
    pins = _manifest_files()
    uncleared = [n for n, pin in pins.items() if pin.get("cleared") is not True]
    if not uncleared:
        pytest.skip("every pinned file is cleared — nothing to hold back")
    for part_id, mounting in (("tex-post-top", None), ("tex-post-top", "3T"),
                              ("tex-post-top", "SMS"), ("tex-post-top", "SMR")):
        name = (realgeom.CUSTOMER_STEP_FILES_BY_FIT.get((part_id, mounting))
                or realgeom.CUSTOMER_STEP_FILES.get(part_id))
        if name not in uncleared:
            continue
        assert realgeom.customer_step_path(part_id, mounting) is None, name
        assert not realgeom.is_customer_cleared(part_id, mounting), name


def test_disable_real_geometry_also_hides_clearance(monkeypatch):
    """The kill switch must make the service look like it has no real CAD.

    customer_step_path always honoured it; is_customer_cleared did not, so the
    bundle still emitted a factory-cad/README-MISSING.txt naming the customer's
    own SKU — an announcement of CAD the switch was set to hide.
    """
    assert realgeom.is_customer_cleared("gvx-pendant")
    monkeypatch.setenv("DISABLE_REAL_GEOMETRY", "1")
    assert not realgeom.is_customer_cleared("gvx-pendant")
    assert realgeom.customer_step_path("gvx-pendant") is None


def test_mounting_code_selects_the_side_mount_file():
    """TEX: 3T (and no code) resolve the post top; SMS/SMR resolve the Area file.

    Table-level assertions run everywhere; path resolution is exercised only
    when the CAD is on this machine.
    """
    assert realgeom.CUSTOMER_STEP_FILES["tex-post-top"] == "TEX-Post-Top.STEP"
    for code in ("SMS", "SMR"):
        assert realgeom.CUSTOMER_STEP_FILES_BY_FIT[("tex-post-top", code)] == "TEX-AREA.STEP"
    # Path resolution below additionally requires TEX to be RELEASED; while its
    # pins say cleared=false the resolver correctly returns None for all four.
    base = realgeom.customer_step_path("tex-post-top")
    if base is not None:
        assert base.name == "TEX-Post-Top.STEP"
        assert realgeom.customer_step_path("tex-post-top", "3T").name == "TEX-Post-Top.STEP"
        assert realgeom.customer_step_path("tex-post-top", "SMS").name == "TEX-AREA.STEP"
        assert realgeom.customer_step_path("tex-post-top", "SMR").name == "TEX-AREA.STEP"


def test_is_customer_cleared_reads_declarations_not_disk(monkeypatch):
    """Allowlist + manifest clearance, with no CAD read.

    "Declared" is now two things, not one: the part must be allowlisted AND its
    file's pin must say cleared. TEX is allowlisted for all three of its codes
    and released for none of them, which is exactly the state this must report.
    """
    monkeypatch.setenv("CUSTOMER_STEP_DIR", "/nonexistent")
    monkeypatch.setenv("REAL_STEP_DIR", "/nonexistent")
    pins = _manifest_files()
    assert realgeom.is_customer_cleared("gvx-pendant") is (
        pins["GVX-Simple.STEP"].get("cleared") is True
    )
    assert realgeom.is_customer_cleared("tex-post-top", "SMS") is (
        pins["TEX-AREA.STEP"].get("cleared") is True
    )
    # Never allowlisted at all — no pin, no clearance, no download.
    assert not realgeom.is_customer_cleared("drx-post-top")
    assert not realgeom.is_customer_cleared("drx-post-top", "SMS")
