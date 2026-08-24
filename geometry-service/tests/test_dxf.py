"""Tests for DXF adapter — Task 4 (Phase 0.3).

TDD order: tests written before implementation.  Watch each fail first.

Covered behaviours
------------------
1. Loads with ezdxf.readfile (valid DXF)
2. Modelspace contains ≥4 DIMENSION entities
3. A text entity contains the DISCLAIMER
4. A text entity contains the config ID
5. Overall-height dimension measures the drawing's own geometry, and stays
   within 1% of the parametric assembly height (Phase 0.18: the sheet is
   dimensioned off the SHELL assembly, `dims` is still the placeholder)
6. Parametrize over both DXF_ROUTE values; dimension measurements must match
   (boundary-proof: adapter swap only, identical output dims)
"""

from __future__ import annotations

import importlib
import os
import uuid
from pathlib import Path

import ezdxf
import pytest

from app.adapters._drawing_sheet import _CHAR_W
from app.adapters._drawing_sheet import _DIMSTYLE as SHEET_DIMSTYLE
from app.adapters.base import GenContext
from app.catalog import load_catalog
from app.drawing import project_outlines, view_extents
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name
from app.shellgeom import shell_assembly

from .conftest import first_base_cover_for


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg(cat: dict, config_id: str | None = None) -> PoleConfig:
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


def _make_ctx(cat, cfg, out_dir) -> GenContext:
    asm = build_assembly(cat, cfg)
    finish_map = {f["id"]: f.get("name", f["id"]) for f in cat.get("finishes", [])}
    return GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=out_dir,
        base_name=base_name(cat, cfg),
        assembly=asm,
        render_png=None,
        summary={"finish": finish_map.get(cfg.finish, cfg.finish)},
    )


def _build_dxf(cat, cfg, out_dir, route: str) -> Path:
    """Generate a DXF using the specified route; returns the .dxf Path."""
    old = os.environ.get("DXF_ROUTE")
    os.environ["DXF_ROUTE"] = route

    # Re-import fresh so DXF_ROUTE is picked up (adapters module caches at
    # import time — we do a direct adapter instantiation instead to avoid
    # re-importing the registry module in tests).
    if route == "direct":
        from app.adapters.dxf_adapter import DxfAdapter
        adapter = DxfAdapter()
    else:
        from app.adapters.dxf_projection_adapter import DxfProjectionAdapter
        adapter = DxfProjectionAdapter()

    ctx = _make_ctx(cat, cfg, out_dir)
    paths = adapter.generate(ctx)

    if old is None:
        os.environ.pop("DXF_ROUTE", None)
    else:
        os.environ["DXF_ROUTE"] = old

    dxf_paths = [p for p in paths if p.suffix == ".dxf"]
    assert dxf_paths, "No .dxf file in adapter output"
    return dxf_paths[0]


def _dim_measurements_mm(doc) -> list[float]:
    """Every DIMENSION's measurement in mm, sorted.

    The 0.18 sheet draws its views REDUCED 1:N in inches, so a dimension's
    stored measurement (DXF code 42) is the PAPER distance and DIMLFAC carries
    the scale back to true size — the ordinary convention for dimensioning a
    scaled model-space drawing.  $INSUNITS is deliberately not consulted: the
    pre-0.18 sheet declared METRES while drawing millimetres.
    """
    lfac = doc.dimstyles.get(SHEET_DIMSTYLE).dxf.dimlfac
    out = []
    for e in doc.modelspace():
        if e.dxftype() != "DIMENSION":
            continue
        measured = abs(e.dxf.get("actual_measurement", 0.0) or 0.0)
        if measured:
            out.append(measured * lfac * 25.4)
    return sorted(out)


def _front_view_height_mm(cat, cfg) -> float:
    """Overall height of the shell assembly as the front elevation shows it."""
    shells = shell_assembly(cat, cfg)
    assert shells is not None, (
        "This config has no full shell coverage, so it does not exercise the "
        "0.18 sheet these assertions describe"
    )
    ext = view_extents(project_outlines(shells, "front"))
    return (ext[3] - ext[1]) * 25.4


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="session")
def default_cfg(cat) -> PoleConfig:
    return _default_cfg(cat, "test-dxf-abc12345")


# ---------------------------------------------------------------------------
# Per-route parametrised fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(
    scope="module",
    params=["direct", "projection"],
    ids=["route-direct", "route-projection"],
)
def route(request):
    return request.param


@pytest.fixture(scope="module")
def dxf_doc_and_ctx(request, cat, default_cfg, tmp_path_factory, route):
    """Generate a DXF for the given route; return (ezdxf.doc, GenContext)."""
    out = tmp_path_factory.mktemp(f"dxf_{route}")
    dxf_path = _build_dxf(cat, default_cfg, out, route)
    doc = ezdxf.readfile(str(dxf_path))
    ctx = _make_ctx(cat, default_cfg, out)
    return doc, ctx


# ---------------------------------------------------------------------------
# Test: DXF is readable
# ---------------------------------------------------------------------------

class TestDxfLoads:
    def test_ezdxf_readfile_does_not_raise(self, cat, default_cfg, tmp_path, route):
        """ezdxf.readfile must succeed without error."""
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        assert doc is not None


# ---------------------------------------------------------------------------
# Test: dimension entities
# ---------------------------------------------------------------------------

class TestDxfDimensions:
    def test_at_least_four_dimension_entities(self, cat, default_cfg, tmp_path, route):
        """Modelspace must contain ≥4 DIMENSION entities."""
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        msp = doc.modelspace()
        dims = [e for e in msp if e.dxftype() == "DIMENSION"]
        assert len(dims) >= 4, f"Expected ≥4 DIMENSION entities, got {len(dims)}"

    def test_overall_height_dimension_matches_assembly(self, cat, default_cfg, tmp_path, route):
        """The tallest dimension must measure the drawing's own geometry exactly,
        and the parametric assembly height to within 1%.

        Phase 0.18 moved the source of truth: the sheet is dimensioned off the
        SHELL assembly — the geometry the STEP and IFC ship — while
        ``asm.dims`` is still the parametric placeholder.  On the default config
        the two differ by ~40 mm over 6.9 m (0.6%), and the shell is the more
        accurate of the pair, so exactness is asserted against the drawing's own
        geometry and the placeholder only loosely.  That still catches what this
        test was written to catch: a unit error moves the number by 25.4x and a
        scale error by the sheet scale, both far outside 1%.
        """
        asm = build_assembly(cat, default_cfg)
        target = _front_view_height_mm(cat, default_cfg)
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        measurements = _dim_measurements_mm(doc)
        assert measurements, "No DIMENSION entity carries a measurement"

        tallest = max(measurements)
        assert abs(tallest - target) <= 0.5, (
            f"Tallest dimension {tallest:.1f}mm does not match the front "
            f"elevation's own height {target:.1f}mm. "
            f"Found measurements: {[f'{m:.1f}' for m in measurements]}"
        )
        drift = abs(tallest - asm.dims.overall_height) / asm.dims.overall_height
        assert drift <= 0.01, (
            f"Dimension {tallest:.1f}mm is {drift:.1%} off the parametric "
            f"overall_height={asm.dims.overall_height:.1f}mm — too far to be "
            f"the shell/placeholder gap; suspect units or sheet scale"
        )
# ---------------------------------------------------------------------------
# Test: title-block text entities
# ---------------------------------------------------------------------------

class TestDxfTitleBlock:
    def _all_text(self, doc) -> list[str]:
        msp = doc.modelspace()
        return [
            e.dxf.text
            for e in msp
            if e.dxftype() in ("TEXT", "MTEXT")
            and hasattr(e.dxf, "text")
        ]

    def test_disclaimer_text_entity_present(self, cat, default_cfg, tmp_path, route):
        """A TEXT/MTEXT entity must contain the DISCLAIMER string."""
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        texts = self._all_text(doc)
        assert any(DISCLAIMER in t for t in texts), (
            f"DISCLAIMER not found in any text entity. Texts: {texts[:5]}"
        )

    def test_config_id_text_entity_present(self, cat, default_cfg, tmp_path, route):
        """A TEXT/MTEXT entity must contain the config ID."""
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        texts = self._all_text(doc)
        assert any(default_cfg.configId in t for t in texts), (
            f"configId={default_cfg.configId!r} not found in text entities. "
            f"Texts: {texts[:5]}"
        )

    def test_border_encloses_all_elevation_entities(self, cat, default_cfg, tmp_path, route):
        """The outer border must enclose every other entity on the sheet.

        Views, dimensions, labels and the title block all have to land inside
        the border — that is what proves the title block is placed at the same
        scale as the geometry (the pre-0.18 sheet drew the two 50x apart).
        Anchor points are checked, not glyph boxes, and the tolerance is a
        fraction of the border so it reads the same whether the sheet is drawn
        in inches (0.18) or millimetres (the legacy fallback).
        """
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        msp = doc.modelspace()

        # The border is the largest closed LWPOLYLINE.
        border_rect = None
        border_area = 0.0
        for poly in (e for e in msp if e.dxftype() == "LWPOLYLINE"):
            pts = list(poly.get_points())
            if len(pts) < 4:
                continue
            xs = [pt[0] for pt in pts]
            ys = [pt[1] for pt in pts]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if area > border_area:
                border_area = area
                border_rect = (min(xs), min(ys), max(xs), max(ys))

        assert border_rect is not None, "No border rectangle found in DXF"
        bx0, by0, bx1, by1 = border_rect

        pts: list[tuple[str, float, float]] = []
        for e in msp:
            if e.dxf.layer == "WILL-BORDER":
                continue  # the border and its zone letters ARE the frame
            kind = e.dxftype()
            if kind == "LINE":
                pts.append((kind, e.dxf.start.x, e.dxf.start.y))
                pts.append((kind, e.dxf.end.x, e.dxf.end.y))
            elif kind == "LWPOLYLINE":
                pts.extend((kind, pt[0], pt[1]) for pt in e.get_points())
            elif kind == "TEXT":
                # Aligned text carries its real position in align_point.
                anchor = e.dxf.get("align_point", None) or e.dxf.insert
                pts.append((kind, anchor.x, anchor.y))
            elif kind == "DIMENSION":
                for attr in ("defpoint", "defpoint2", "defpoint3", "text_midpoint"):
                    point = e.dxf.get(attr, None)
                    if point is not None:
                        pts.append((f"{kind}.{attr}", point.x, point.y))

        assert pts, "No sheet entities found to test against the border"

        tol = 0.002 * max(bx1 - bx0, by1 - by0)
        for kind, x, y in pts:
            assert bx0 - tol <= x <= bx1 + tol, (
                f"{kind} X={x:.3f} is outside the border "
                f"[{bx0:.3f}, {bx1:.3f}]"
            )
            assert by0 - tol <= y <= by1 + tol, (
                f"{kind} Y={y:.3f} is outside the border "
                f"[{by0:.3f}, {by1:.3f}]"
            )
# ---------------------------------------------------------------------------
# Test: route parity (boundary proof — DoD 8)
# ---------------------------------------------------------------------------

class TestDxfRouteParity:
    """Both DXF routes must produce identical dimension measurements.

    This is the adapter-swap boundary proof: swapping DXF_ROUTE must not change
    the dimension values.  Pre-0.18 only the silhouette geometry differed
    between routes; on a config with full shell coverage the two now return the
    same shell sheet, and the flag chooses the legacy fallback only for configs
    the shells do not cover.
    """

    def test_dimension_measurements_identical_across_routes(
        self, cat, default_cfg, tmp_path_factory
    ):
        """Both routes produce the same dimension measurements (±0.1 mm).

        Phase 0.18: for a config with full shell coverage both routes return the
        SAME shell sheet, because the route flag chooses how a part silhouette
        is produced and this sheet takes its line work from the shells.  That
        would make the parity assertion vacuous if one route quietly fell back
        to the legacy drawing, so the sheet is identified first.
        """
        out_direct = tmp_path_factory.mktemp("parity_direct")
        out_proj = tmp_path_factory.mktemp("parity_proj")

        path_direct = _build_dxf(cat, default_cfg, out_direct, "direct")
        path_proj = _build_dxf(cat, default_cfg, out_proj, "projection")

        doc_direct = ezdxf.readfile(str(path_direct))
        doc_proj = ezdxf.readfile(str(path_proj))
        for route, doc in (("direct", doc_direct), ("projection", doc_proj)):
            assert SHEET_DIMSTYLE in doc.dimstyles, (
                f"Route {route!r} did not produce the 0.18 shell sheet "
                f"(no {SHEET_DIMSTYLE} dimension style), so this parity check "
                f"would compare two different drawings"
            )

        m_direct = _dim_measurements_mm(doc_direct)
        m_proj = _dim_measurements_mm(doc_proj)

        assert m_direct, "Route 'direct' produced no dimension measurements"
        assert len(m_direct) == len(m_proj), (
            f"Route 'direct' has {len(m_direct)} dims, "
            f"'projection' has {len(m_proj)}"
        )
        for i, (a, b) in enumerate(zip(m_direct, m_proj)):
            assert abs(a - b) <= 0.1, (
                f"Dimension[{i}] mismatch: direct={a:.3f}, projection={b:.3f}"
            )
# ---------------------------------------------------------------------------
# Test: registry
# ---------------------------------------------------------------------------

class TestDxfRegistry:
    def test_dxf_in_registry_for_direct_route(self, monkeypatch):
        """With DXF_ROUTE=direct, 'dxf' must appear in the adapter REGISTRY."""
        monkeypatch.setenv("DXF_ROUTE", "direct")
        # Direct adapter import (registry cached — test the adapter itself)
        from app.adapters.dxf_adapter import DxfAdapter
        a = DxfAdapter()
        assert a.available() is True
        assert a.format == "dxf"

    def test_dxf_in_registry_for_projection_route(self, monkeypatch):
        """DxfProjectionAdapter.available() must return True."""
        monkeypatch.setenv("DXF_ROUTE", "projection")
        from app.adapters.dxf_projection_adapter import DxfProjectionAdapter
        a = DxfProjectionAdapter()
        assert a.available() is True
        assert a.format == "dxf"

    def test_registry_route_swap_via_reload(self, monkeypatch):
        """REGISTRY["dxf"] class must match DXF_ROUTE after importlib.reload.

        DXF_ROUTE=direct (or unset) → DxfAdapter
        DXF_ROUTE=projection        → DxfProjectionAdapter
        Module state is restored after the test via a second reload with no env var.
        """
        import app.adapters as adapters_mod
        from app.adapters.dxf_adapter import DxfAdapter
        from app.adapters.dxf_projection_adapter import DxfProjectionAdapter

        # --- direct route ---
        monkeypatch.setenv("DXF_ROUTE", "direct")
        importlib.reload(adapters_mod)
        assert "dxf" in adapters_mod.REGISTRY
        assert isinstance(adapters_mod.REGISTRY["dxf"], DxfAdapter), (
            f"Expected DxfAdapter for DXF_ROUTE=direct, "
            f"got {adapters_mod.REGISTRY['dxf'].__class__.__name__}"
        )

        # --- projection route ---
        monkeypatch.setenv("DXF_ROUTE", "projection")
        importlib.reload(adapters_mod)
        assert "dxf" in adapters_mod.REGISTRY
        assert isinstance(adapters_mod.REGISTRY["dxf"], DxfProjectionAdapter), (
            f"Expected DxfProjectionAdapter for DXF_ROUTE=projection, "
            f"got {adapters_mod.REGISTRY['dxf'].__class__.__name__}"
        )

        # --- restore module state (unset env, reload) ---
        monkeypatch.delenv("DXF_ROUTE", raising=False)
        importlib.reload(adapters_mod)

    def test_dwg_adapter_not_available_without_oda(self):
        """DwgAdapter.available() must return False when ODA not installed."""
        import shutil
        oda_path = "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter"
        has_oda = (
            shutil.which("ODAFileConverter") is not None
            or Path(oda_path).exists()
        )
        from app.adapters.dwg_adapter import DwgAdapter
        adapter = DwgAdapter()
        if not has_oda:
            assert adapter.available() is False
        else:
            assert adapter.available() is True


# ---------------------------------------------------------------------------
# Test: determinism (same config -> byte-identical DXF)
# ---------------------------------------------------------------------------

class TestDxfDeterminism:
    """Same config must produce byte-identical DXF, on either route.

    A plain ezdxf document carries $TDCREATE/$TDUPDATE, random
    $FINGERPRINTGUID/$VERSIONGUID and a save-time "written by" marker, so this
    held for the STEP/IFC/zip/PDF outputs long before it held for DXF
    (`pin_document` in `app/adapters/_drawing_sheet.py`).
    """

    def _sha256(self, path: Path) -> str:
        import hashlib

        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_same_config_twice_is_byte_identical(self, cat, default_cfg, tmp_path_factory, route):
        first = _build_dxf(cat, default_cfg, tmp_path_factory.mktemp("det_a"), route)
        second = _build_dxf(cat, default_cfg, tmp_path_factory.mktemp("det_b"), route)
        assert self._sha256(first) == self._sha256(second), (
            f"Route {route!r} produced two different files for one config — "
            f"something in the DXF still carries a wall clock or a random GUID"
        )

    def test_routes_are_byte_identical(self, cat, default_cfg, tmp_path_factory):
        """Stronger than the dimension parity above: for a config with full
        shell coverage both routes return the SAME sheet, so the files match to
        the byte."""
        direct = _build_dxf(cat, default_cfg, tmp_path_factory.mktemp("det_direct"), "direct")
        proj = _build_dxf(cat, default_cfg, tmp_path_factory.mktemp("det_proj"), "projection")
        assert self._sha256(direct) == self._sha256(proj)


# ---------------------------------------------------------------------------
# Test: nothing overlaps (the drawing contract's layout rule)
# ---------------------------------------------------------------------------

class TestNoTextOverlap:
    """No two text boxes on the sheet may intersect — Tyler 8/20 ("There
    should never be multiple layers of text on top of each other"), promoted
    from a review comment to a pinned property after his 8/21 screenshot
    caught the hand-hole callout running through the SIDE view's label: a
    labeled callout can be LONGER than its dimension segment, so ezdxf's
    default segment-centred text overflowed onto neighbours the occupancy
    lanes could never escape (they only move sideways). Before the fix this
    audit reported two clashing pairs on the default config; after, none.

    Boxes use the sheet's own character-width model (`_CHAR_W`) with ZERO
    padding, so only true glyph-box intersections fail — the deliberately
    tight two-line concept notice (0.025" clear) must keep passing. Rendered
    dimension text lives as MTEXT inside the dimension's geometry block, so
    it is audited from there.
    """

    @staticmethod
    def _rects(doc):
        rects = []

        def rotated(x, y, text, h, rot):
            w = len(text) * h * _CHAR_W
            if abs((rot % 180.0) - 90.0) < 1.0:
                return (x - h / 2, y - w / 2, x + h / 2, y + w / 2, text)
            return (x - w / 2, y - h / 2, x + w / 2, y + h / 2, text)

        for e in doc.modelspace():
            kind = e.dxftype()
            if kind == "TEXT":
                p = e.dxf.get("align_point", None) or e.dxf.insert
                text, h = e.dxf.text, e.dxf.height
                rot = e.dxf.get("rotation", 0.0) or 0.0
                if e.dxf.get("halign", 0):
                    rects.append(rotated(p.x, p.y, text, h, rot))
                else:  # left-aligned TEXT: insert is the baseline start
                    w = len(text) * h * _CHAR_W
                    rects.append((p.x, p.y, p.x + w, p.y + h, text))
            elif kind == "DIMENSION":
                block = doc.blocks.get(e.dxf.get("geometry", None))
                for be in block or []:
                    if be.dxftype() == "MTEXT":
                        p = be.dxf.insert
                        rects.append(
                            rotated(
                                p.x,
                                p.y,
                                be.text,
                                be.dxf.char_height,
                                be.dxf.get("rotation", 0.0) or 0.0,
                            )
                        )
        return rects

    def test_no_two_text_boxes_intersect(self, dxf_doc_and_ctx):
        doc, _ctx = dxf_doc_and_ctx
        rects = self._rects(doc)
        assert len(rects) > 20, "audit found implausibly little text - extraction broke"
        clashes = [
            (a[4], b[4])
            for i, a in enumerate(rects)
            for b in rects[i + 1 :]
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
        ]
        assert not clashes, f"text boxes overlap: {clashes}"
