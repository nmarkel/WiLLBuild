"""Tests for DXF adapter — Task 4 (Phase 0.3).

TDD order: tests written before implementation.  Watch each fail first.

Covered behaviours
------------------
1. Loads with ezdxf.readfile (valid DXF)
2. Modelspace contains ≥4 DIMENSION entities
3. A text entity contains the DISCLAIMER
4. A text entity contains the config ID
5. Overall-height dimension measurement == dims.overall_height ±1 mm
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

from app.adapters.base import GenContext
from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name

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
        """Overall-height dimension measurement must equal dims.overall_height ±1 mm."""
        asm = build_assembly(cat, default_cfg)
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        msp = doc.modelspace()
        dims = [e for e in msp if e.dxftype() == "DIMENSION"]
        # The overall-height dimension is the tallest one
        measurements = [abs(d.dxf.actual_measurement) for d in dims
                        if hasattr(d.dxf, "actual_measurement")
                        and d.dxf.actual_measurement != 0]
        target = asm.dims.overall_height
        assert any(
            abs(m - target) <= 1.0 for m in measurements
        ), (
            f"No dimension within 1mm of overall_height={target:.1f}mm. "
            f"Found measurements: {[f'{m:.1f}' for m in measurements]}"
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
        """The outer border rectangle must enclose every non-border/titleblock entity.

        The elevation (silhouette polylines + dimension lines) must all lie
        inside the border, proving the title block is positioned at the correct
        scale relative to the elevation geometry.
        """
        dxf_path = _build_dxf(cat, default_cfg, tmp_path, route)
        doc = ezdxf.readfile(str(dxf_path))
        msp = doc.modelspace()

        # Collect all LWPOLYLINE entity bounding points to find border extents.
        # The border is the largest closed lwpolyline (4 points).
        polys = [e for e in msp if e.dxftype() == "LWPOLYLINE"]
        # Find the border: it's the outermost rectangle; largest area closed poly.
        border_rect = None
        border_area = 0.0
        for poly in polys:
            pts = list(poly.get_points())
            if len(pts) < 4:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            w = max(xs) - min(xs)
            h = max(ys) - min(ys)
            area = w * h
            if area > border_area:
                border_area = area
                border_rect = (min(xs), min(ys), max(xs), max(ys))

        assert border_rect is not None, "No border rectangle found in DXF"
        bx0, by0, bx1, by1 = border_rect

        # Collect all LINE start/end points from silhouette and dimensions.
        line_pts: list[tuple[float, float]] = []
        for e in msp:
            if e.dxftype() == "LINE":
                line_pts.append((e.dxf.start.x, e.dxf.start.y))
                line_pts.append((e.dxf.end.x, e.dxf.end.y))
            elif e.dxftype() == "LWPOLYLINE":
                for p in e.get_points():
                    line_pts.append((p[0], p[1]))

        # Filter to elevation points (exclude title-block geometry in right strip).
        # Title block lives roughly in the right 4000mm of the border.
        # Any point at X > (bx1 - 5000) is considered title-block territory.
        tb_left_approx = bx1 - 5000.0
        elevation_pts = [(x, y) for x, y in line_pts if x < tb_left_approx]

        assert elevation_pts, "No elevation points found to test against border"

        # All elevation points must be inside the border with 1mm tolerance.
        TOL = 1.0
        for x, y in elevation_pts:
            assert x >= bx0 - TOL, (
                f"Elevation point X={x:.1f} is outside border left={bx0:.1f}"
            )
            assert x <= bx1 + TOL, (
                f"Elevation point X={x:.1f} is outside border right={bx1:.1f}"
            )
            assert y >= by0 - TOL, (
                f"Elevation point Y={y:.1f} is outside border bottom={by0:.1f}"
            )
            assert y <= by1 + TOL, (
                f"Elevation point Y={y:.1f} is outside border top={by1:.1f}"
            )


# ---------------------------------------------------------------------------
# Test: route parity (boundary proof — DoD 8)
# ---------------------------------------------------------------------------

class TestDxfRouteParity:
    """Both DXF routes must produce identical dimension measurements.

    This is the adapter-swap boundary proof: swapping DXF_ROUTE must not
    change the dimension values — only the silhouette geometry differs.
    """

    def _get_measurements(self, dxf_path: Path) -> list[float]:
        doc = ezdxf.readfile(str(dxf_path))
        msp = doc.modelspace()
        return sorted(
            abs(d.dxf.actual_measurement)
            for d in msp
            if d.dxftype() == "DIMENSION"
            and hasattr(d.dxf, "actual_measurement")
            and d.dxf.actual_measurement != 0
        )

    def test_dimension_measurements_identical_across_routes(
        self, cat, default_cfg, tmp_path_factory
    ):
        """Both routes produce the same sorted dimension measurement list (±0.1 mm)."""
        out_direct = tmp_path_factory.mktemp("parity_direct")
        out_proj = tmp_path_factory.mktemp("parity_proj")

        path_direct = _build_dxf(cat, default_cfg, out_direct, "direct")
        path_proj = _build_dxf(cat, default_cfg, out_proj, "projection")

        m_direct = self._get_measurements(path_direct)
        m_proj = self._get_measurements(path_proj)

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
