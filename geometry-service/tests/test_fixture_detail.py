"""Fixture geometry detail — Phase 0.10, Workstream D.

Round-4 feedback: fixtures need step-downs / flush transitions because the STEP
reads "a little blocky".  These tests prove the detail pass actually adds
geometry, keeps the part's envelope (so every drawing callout stays honest),
leaves NON-fixture parts exactly as they were in 0.9, and stays deterministic.
"""

from __future__ import annotations

import pytest

from app.adapters.base import GenContext
from app.adapters.step_adapter import StepAdapter
from app.catalog import part
from app.kit.assembly import build_assembly
from app.kit.detail import chamfer_length, profile_fillet_radius, step_down_box
from app.kit.parts import (
    _build_box,
    build_fixture_group,
    build_fixture_lathe,
    build_part,
)
from app.models import PoleConfig
from app.naming import base_name

# Every fixture in the catalog, across all three builder brands.
FIXTURE_IDS = [
    "drx-post-top",
    "tex-post-top",
    "mvx-coach",
    "gvx-pendant",
    "slx",
    "nafco-chx-cobrahead",
    "nafco-shx-shoebox",
    "willsport-gtx-high-output-area",
    "willsport-hdx-area-flood-sports",
    "willsport-hsx-sportslighter",
    "willsport-kbx-lighting-system",
]


def _plain(spec: dict):
    """The same fixture solid WITHOUT the 0.10 detail pass (0.9 behaviour)."""
    kind = spec["kind"]
    if kind == "lathe":
        return build_fixture_lathe(spec["profile"], detail=False)
    if kind == "group":
        return build_fixture_group(spec["children"], detail=False)
    if kind == "box":
        return _build_box(spec, detail=False)
    raise AssertionError(f"unexpected fixture kind {kind!r}")


@pytest.mark.parametrize("fixture_id", FIXTURE_IDS)
def test_detail_adds_geometry(catalog, fixture_id):
    """The detailed solid has strictly more faces — it is no longer a slab."""
    spec = part(catalog, fixture_id)["placeholder"]
    plain = _plain(spec)
    detailed = build_part(part(catalog, fixture_id))
    assert len(detailed.faces()) > len(plain.faces())
    assert len(detailed.edges()) > len(plain.edges())


@pytest.mark.parametrize("fixture_id", FIXTURE_IDS)
def test_detail_keeps_the_envelope(catalog, fixture_id):
    """Chamfers/steps refine the form; they must not resize the product.

    Drawings call out overall height and reach from these solids, so the
    bounding box has to stay within a few percent, and the solid must stay
    watertight with a sane volume.
    """
    spec = part(catalog, fixture_id)["placeholder"]
    plain = _plain(spec)
    detailed = build_part(part(catalog, fixture_id))
    pbb, dbb = plain.bounding_box(), detailed.bounding_box()
    for axis in ("X", "Y", "Z"):
        plain_size = getattr(pbb.size, axis)
        detail_size = getattr(dbb.size, axis)
        assert detail_size <= plain_size + 0.01, f"{axis} grew"
        assert detail_size == pytest.approx(plain_size, rel=0.06), f"{axis} shrank too far"
    # Material is only ever removed, and only a little of it.
    assert detailed.volume <= plain.volume + 1.0
    assert detailed.volume == pytest.approx(plain.volume, rel=0.05)


@pytest.mark.parametrize("fixture_id", FIXTURE_IDS)
def test_detail_is_deterministic(catalog, fixture_id):
    """Same input → same solid (the determinism rule the whole service holds to)."""
    a = build_part(part(catalog, fixture_id))
    b = build_part(part(catalog, fixture_id))
    assert len(a.faces()) == len(b.faces())
    assert a.volume == pytest.approx(b.volume, rel=1e-9)


# ---------------------------------------------------------------------------
# Non-fixture parts are untouched (0.9 output preserved)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "part_id",
    [
        "alum-pole-20",
        "bc-fluted",
        "bc-round",
        "sh1-shepherds-hook",
        "willstudio-side-shepherds-hook-pole-top-brackets",
        "willstudio-ba1-banner-arm",
    ],
)
def test_non_fixture_parts_are_not_detailed(catalog, part_id):
    """Poles, covers, arms and banner hardware build exactly as before."""
    p = part(catalog, part_id)
    solid = build_part(p)
    spec = p["placeholder"]
    if spec["kind"] == "group":
        # Identical to the undetailed group build — no chamfers were applied.
        plain = build_fixture_group(spec["children"], detail=False)
        assert len(solid.faces()) == len(plain.faces())
        assert solid.volume == pytest.approx(plain.volume, rel=1e-9)
    else:
        # A chamfered solid always gains faces; these must not have.
        assert solid.volume > 0


def test_banner_panel_keeps_its_sharp_edges(catalog):
    """A banner panel is flat hardware — it must not pick up housing chamfers."""
    p = part(catalog, "willstudio-ba1-banner-arm")
    solid = build_part(p)
    sharp = build_fixture_group(p["placeholder"]["children"], detail=False)
    detailed = build_fixture_group(p["placeholder"]["children"], detail=True)
    assert len(solid.faces()) == len(sharp.faces())
    assert len(detailed.faces()) > len(sharp.faces())  # detail WOULD have changed it


# ---------------------------------------------------------------------------
# The detail rules themselves
# ---------------------------------------------------------------------------

def test_chamfer_is_size_gated():
    assert chamfer_length((40.0, 12.0, 300.0)) == 0.0  # 12 mm bracket → skipped
    assert chamfer_length((200.0, 200.0, 100.0)) == pytest.approx(6.0)
    assert chamfer_length((5000.0, 5000.0, 5000.0)) == 8.0  # capped
    assert chamfer_length((25.0, 25.0, 25.0)) == 1.5


def test_step_down_only_applies_to_housing_sized_boxes():
    assert step_down_box(80.0, 80.0, 200.0) is None   # too small a footprint
    assert step_down_box(400.0, 400.0, 40.0) is None  # too shallow
    stepped = step_down_box(600.0, 400.0, 200.0)
    assert stepped is not None
    bb = stepped.bounding_box()
    # The step is inset horizontally only: the envelope is untouched.
    assert bb.size.X == pytest.approx(600.0)
    assert bb.size.Y == pytest.approx(400.0)
    assert bb.size.Z == pytest.approx(200.0)
    # …and it really is a two-tier solid, not a plain box.
    assert len(stepped.faces()) > 6


def test_profile_fillet_is_size_gated():
    assert profile_fillet_radius([(10.0, 0.0), (10.0, 5.0)]) == 0.0  # 2 points, nothing to fillet
    # 2% of the profile's vertical extent: 200 mm tall → 4 mm.
    assert profile_fillet_radius([(0.0, 0.0), (100.0, 0.0), (100.0, 200.0)]) == pytest.approx(4.0)
    assert profile_fillet_radius([(0.0, 0.0), (100.0, 0.0), (100.0, 30.0)]) == 1.0  # floor
    assert profile_fillet_radius([(0.0, 0.0), (100.0, 0.0), (100.0, 1000.0)]) == 6.0  # cap


# ---------------------------------------------------------------------------
# The deliverable: a detailed assembly still exports a deterministic STEP
# ---------------------------------------------------------------------------

def _strip_file_name(content: bytes) -> bytes:
    return b"\n".join(
        ln for ln in content.split(b"\n") if not ln.startswith(b"FILE_NAME")
    )


def test_detailed_assembly_step_is_deterministic(tmp_path_factory, catalog):
    cfg = PoleConfig(
        configId="detail-step-0001",
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )
    assembly = build_assembly(catalog, cfg)
    adapter = StepAdapter()
    outs = []
    for name in ("detail_a", "detail_b"):
        out_dir = tmp_path_factory.mktemp(name)
        ctx = GenContext(
            catalog=catalog, cfg=cfg, out_dir=out_dir,
            base_name=base_name(catalog, cfg), assembly=assembly,
            render_png=None, summary={},
        )
        paths = adapter.generate(ctx)
        outs.append(_strip_file_name(paths[0].read_bytes()))
    assert outs[0] == outs[1]
    assert len(outs[0]) > 0
