"""Tests for the IFC adapter — Task 5 (Phase 0.3, Workstream D).

TDD order: tests written before implementation. Watch each fail first.

Covered behaviours
------------------
1. Generating a default config produces WiLL_<hash>_<id8>.ifc
2. The file opens with ifcopenshell.open and reports schema IFC4
3. Exactly one IfcLightFixture (maps to Revit's Lighting Fixtures category)
4. Pset_WiLLConcept carries ConfigId, Revision, Disclaimer, OverallHeight_mm, Finish
5. The fixture has a non-empty tessellated shape representation (face set > 0 faces)
6. Determinism: two runs produce byte-identical files
7. Registry: 'ifc' key present; /health reports it; POST /generate returns the file
"""

from __future__ import annotations

from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element
import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name
from app.shellgeom import has_shell, shell_assembly

from .conftest import first_base_cover_for


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="module")
def default_cfg(cat) -> PoleConfig:
    return PoleConfig(
        configId="test-cfg-abc12345",
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


@pytest.fixture(scope="module")
def built_assembly(cat, default_cfg):
    return build_assembly(cat, default_cfg)


def _make_ctx(out_dir: Path, cat: dict, cfg: PoleConfig, assembly):
    from app.adapters.base import GenContext
    return GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=out_dir,
        base_name=base_name(cat, cfg),
        assembly=assembly,
        render_png=None,
        summary={},
    )


# ---------------------------------------------------------------------------
# Import the adapter under test — fails until implementation exists
# ---------------------------------------------------------------------------

from app.adapters.ifc_adapter import IfcAdapter  # noqa: E402


@pytest.fixture(scope="module")
def generated_ifc(tmp_path_factory, cat, default_cfg, built_assembly) -> Path:
    """Generate one IFC file shared by the content tests."""
    out = tmp_path_factory.mktemp("ifc_content")
    ctx = _make_ctx(out, cat, default_cfg, built_assembly)
    paths = IfcAdapter().generate(ctx)
    assert len(paths) == 1
    return paths[0]


@pytest.fixture(scope="module")
def ifc_model(generated_ifc):
    return ifcopenshell.open(str(generated_ifc))


# ---------------------------------------------------------------------------
# Filename / file validity
# ---------------------------------------------------------------------------

class TestIfcFile:
    def test_output_filename(self, generated_ifc, cat, default_cfg):
        """Filename must be WiLL_<config_hash>_<first-8-of-configId>.ifc"""
        assert generated_ifc.name == f"{base_name(cat, default_cfg)}.ifc"

    def test_output_file_exists(self, generated_ifc):
        assert generated_ifc.exists()

    def test_opens_with_ifcopenshell(self, ifc_model):
        assert ifc_model is not None

    def test_schema_is_ifc4(self, ifc_model):
        assert ifc_model.schema == "IFC4"


# ---------------------------------------------------------------------------
# Structure: exactly one IfcLightFixture under project→site→building→storey
# ---------------------------------------------------------------------------

class TestIfcStructure:
    def test_exactly_one_light_fixture(self, ifc_model):
        fixtures = ifc_model.by_type("IfcLightFixture")
        assert len(fixtures) == 1

    def test_spatial_hierarchy_exists(self, ifc_model):
        assert len(ifc_model.by_type("IfcProject")) == 1
        assert len(ifc_model.by_type("IfcSite")) == 1
        assert len(ifc_model.by_type("IfcBuilding")) == 1
        assert len(ifc_model.by_type("IfcBuildingStorey")) == 1

    def test_fixture_contained_in_storey(self, ifc_model):
        fixture = ifc_model.by_type("IfcLightFixture")[0]
        storey = ifcopenshell.util.element.get_container(fixture)
        assert storey is not None
        assert storey.is_a("IfcBuildingStorey")

    def test_units_are_millimetres(self, ifc_model):
        project = ifc_model.by_type("IfcProject")[0]
        length_units = [
            u for u in project.UnitsInContext.Units
            if getattr(u, "UnitType", None) == "LENGTHUNIT"
        ]
        assert len(length_units) == 1
        assert length_units[0].Prefix == "MILLI"
        assert length_units[0].Name == "METRE"


# ---------------------------------------------------------------------------
# Property set
# ---------------------------------------------------------------------------

class TestIfcPset:
    @pytest.fixture(scope="class")
    def pset(self, ifc_model) -> dict:
        fixture = ifc_model.by_type("IfcLightFixture")[0]
        psets = ifcopenshell.util.element.get_psets(fixture)
        assert "Pset_WiLLConcept" in psets
        return psets["Pset_WiLLConcept"]

    def test_config_id(self, pset, default_cfg):
        assert pset["ConfigId"] == default_cfg.configId

    def test_revision(self, pset, default_cfg):
        assert pset["Revision"] == default_cfg.rev

    def test_disclaimer(self, pset):
        assert pset["Disclaimer"] == DISCLAIMER

    def test_overall_height_mm(self, pset, built_assembly):
        assert pset["OverallHeight_mm"] == pytest.approx(
            built_assembly.dims.overall_height, rel=1e-6
        )

    def test_finish(self, pset, default_cfg):
        assert pset["Finish"] == default_cfg.finish


# ---------------------------------------------------------------------------
# Geometry: non-empty tessellated representation
# ---------------------------------------------------------------------------

class TestIfcGeometry:
    def test_fixture_has_an_object_placement(self, ifc_model):
        """IfcProduct WR1: a product WITH a shape representation must carry an
        ObjectPlacement (flagged by ifcopenshell.validate, Phase 0.17.5) —
        without one, importers are free to refuse or misplace the geometry."""
        fixture = ifc_model.by_type("IfcLightFixture")[0]
        placement = fixture.ObjectPlacement
        assert placement is not None
        assert placement.is_a("IfcLocalPlacement")
        origin = placement.RelativePlacement.Location.Coordinates
        assert tuple(origin) == (0.0, 0.0, 0.0)

    def test_fixture_has_shape_representation(self, ifc_model):
        fixture = ifc_model.by_type("IfcLightFixture")[0]
        assert fixture.Representation is not None
        reps = fixture.Representation.Representations
        assert len(reps) >= 1
        assert any(r.Items for r in reps)

    def test_face_set_has_faces(self, ifc_model):
        face_sets = ifc_model.by_type("IfcPolygonalFaceSet")
        assert len(face_sets) >= 1
        assert len(face_sets[0].Faces) > 0
        assert len(face_sets[0].Coordinates.CoordList) > 0


# ---------------------------------------------------------------------------
# Analytic pole (Phase 0.17.5): the shaft ships as a real cylinder, not a mesh
# ---------------------------------------------------------------------------

class TestIfcAnalyticPole:
    """The decimated pole shell (121-triangle prism) flat-shades into visible
    facets in Autodesk viewers — IfcPolygonalFaceSet has no normals. The shaft
    must ship as an IfcExtrudedAreaSolid circle instead, which viewers shade
    smooth at any zoom, exactly like the analytic cylinder in a STEP import.
    Requires the committed shells (the shell path is what embeds the mesh)."""

    pytestmark = pytest.mark.skipif(
        not has_shell("gvx-pendant"), reason="service shells not exported on this machine"
    )

    def test_pole_shaft_is_an_extruded_circle(self, ifc_model):
        solids = ifc_model.by_type("IfcExtrudedAreaSolid")
        assert len(solids) == 1
        s = solids[0]
        assert s.SweptArea.is_a("IfcCircleProfileDef")
        assert s.SweptArea.Radius == pytest.approx(50.8)
        # extruded up the pole axis from the 80 mm base-crop line to the top
        assert tuple(s.ExtrudedDirection.DirectionRatios) == (0.0, 0.0, 1.0)
        assert tuple(s.Position.Location.Coordinates) == pytest.approx((0.0, 0.0, 80.0))
        assert s.Depth == pytest.approx(20 * 304.8 - 80.0)

    def test_pole_mesh_is_not_also_shipped(self, ifc_model, cat, default_cfg):
        # one geometry per piece: face sets cover every piece EXCEPT the pole
        asm = shell_assembly(cat, default_cfg)
        face_sets = ifc_model.by_type("IfcPolygonalFaceSet")
        assert len(face_sets) == len(asm.pieces) - 1

    def test_body_representation_type_covers_mixed_items(self, ifc_model):
        fixture = ifc_model.by_type("IfcLightFixture")[0]
        body = fixture.Representation.Representations[0]
        # the IFC4 type whose WHERE rule admits tessellated items AND solids
        assert body.RepresentationType == "SurfaceOrSolidModel"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestIfcDeterminism:
    def test_two_runs_byte_identical(
        self, tmp_path_factory, cat, default_cfg, built_assembly
    ):
        """Generate twice into different dirs; bytes must be identical."""
        adapter = IfcAdapter()
        out1 = tmp_path_factory.mktemp("ifc_det_a")
        out2 = tmp_path_factory.mktemp("ifc_det_b")
        p1 = adapter.generate(_make_ctx(out1, cat, default_cfg, built_assembly))[0]
        p2 = adapter.generate(_make_ctx(out2, cat, default_cfg, built_assembly))[0]
        assert p1.read_bytes() == p2.read_bytes(), "IFC output is not byte-deterministic"


# ---------------------------------------------------------------------------
# Registry + API integration
# ---------------------------------------------------------------------------

class TestIfcRegistry:
    def test_ifc_in_registry(self):
        from app.adapters import REGISTRY
        assert "ifc" in REGISTRY

    def test_ifc_adapter_available(self):
        assert IfcAdapter().available() is True

    def test_health_reports_ifc(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["adapters"].get("ifc") is True


class TestGenerateIfcIntegration:
    def test_generate_ifc_returns_file(self, cat):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "integ-ifc-12345678",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["ifc"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["warnings"] == []
        assert len(body["files"]) == 1
        assert body["files"][0]["format"] == "ifc"
        assert body["files"][0]["filename"].endswith(".ifc")
