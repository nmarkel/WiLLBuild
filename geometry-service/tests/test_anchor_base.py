"""Tests for the pole's anchor base — Phase 0.18 (Tyler 8/20).

The pole was the one component whose drawing fell short of its own spec sheet,
and not because of a drawing setting: the anchor base simply was not modelled.
The numbers here come from the pole sheet's "Designation & Dimensional
Information (Anchor Base)" table (`willstudio-rsax-deco-poles.pdf` page 5, Rev.
V08182026) — a 4 in pole carries a 9.25 in bolt circle, 6.54 in square on
centre, and 0.63 in bolts at wall C with a 2.75 in projection.
"""

from __future__ import annotations

import math
import uuid

import ezdxf
import numpy as np
import pytest

from app.adapters.base import GenContext
from app.adapters.dxf_adapter import DxfAdapter
from app.catalog import load_catalog
from app.drawing import bolt_centres, component_of, pole_features, subassembly
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import base_name
from app.shellgeom import has_anchor_base, shell_assembly

from .conftest import first_base_cover_for

IN = 0.0254
#: Bolt centres sit on the DIAGONALS: the sheet's 6.54 in square on centre and
#: its 9.25 in circle describe the same four holes (6.54 x sqrt(2) = 9.25).
SHEET_BOLT_CIRCLE_IN = 9.25
SHEET_BOLT_SQUARE_IN = 6.54
SHEET_BOLT_DIA_IN = 0.63  # wall C
SHEET_PROJECTION_IN = 2.75


@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


def config(cat: dict, **pole_options) -> PoleConfig:
    return PoleConfig(
        configId=str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
        specOptions={"pole": pole_options} if pole_options else None,
    )


def piece(shells, name):
    return next((p for p in shells.pieces if p.name == name), None)


class TestGating:
    def test_standard_anchor_base_ships_plate_and_bolts(self, cat):
        shells = shell_assembly(cat, config(cat))
        assert piece(shells, "Pole Base") is not None
        assert piece(shells, "Anchor Bolts") is not None

    def test_embedded_pole_has_no_anchor_base_at_all(self, cat):
        """RSAD is set in concrete — shipping the casting would draw hardware
        the customer is not buying."""
        shells = shell_assembly(cat, config(cat, design="RSAD"))
        assert piece(shells, "Pole Base") is None
        assert piece(shells, "Anchor Bolts") is None

    def test_custom_base_is_omitted_and_says_so(self, cat):
        cfg = config(cat, **{"base-type": "CB"})
        shells = shell_assembly(cat, cfg)
        assert piece(shells, "Anchor Bolts") is None
        assert any("custom base" in w.lower() for w in shells.warnings), shells.warnings

    def test_less_anchor_bolts_keeps_the_plate(self, cat):
        shells = shell_assembly(cat, config(cat, **{"anchor-bolts": "LAB"}))
        assert piece(shells, "Pole Base") is not None
        assert piece(shells, "Anchor Bolts") is None

    def test_has_anchor_base_matches_what_gets_built(self, cat):
        pole = next(p for p in cat["parts"] if p["id"] == "alum-pole-20")
        for options, expected in (
            ({}, True),
            ({"design": "RSAD"}, False),
            ({"base-type": "CB"}, False),
        ):
            cfg = config(cat, **options)
            assert has_anchor_base(cfg, pole) is expected
            built = piece(shell_assembly(cat, cfg), "Pole Base") is not None
            assert built is expected


class TestBoltGeometry:
    @pytest.fixture(scope="class")
    def bolts(self, cat):
        return piece(shell_assembly(cat, config(cat)), "Anchor Bolts")

    def test_four_bolts_on_the_sheet_s_square(self, bolts, cat):
        shells = shell_assembly(cat, config(cat))
        centres = bolt_centres(subassembly(shells, ("Anchor Bolts",)), "top")
        assert len(centres) == 4
        for x, z in centres:
            assert abs(abs(x) - SHEET_BOLT_SQUARE_IN / 2) < 0.05, (x, z)
            assert abs(abs(z) - SHEET_BOLT_SQUARE_IN / 2) < 0.05, (x, z)

    def test_bolt_circle_matches_the_sheet(self, cat):
        shells = shell_assembly(cat, config(cat))
        centres = bolt_centres(subassembly(shells, ("Anchor Bolts",)), "top")
        diameter = max(math.dist(a, b) for a in centres for b in centres)
        assert diameter == pytest.approx(SHEET_BOLT_CIRCLE_IN, abs=0.02)

    def test_bolt_diameter_and_projection_match_the_sheet(self, bolts):
        verts = bolts.verts
        # One bolt's own extent: split by quadrant, then measure it.
        quadrant = verts[(verts[:, 0] > 0) & (verts[:, 2] > 0)]
        width_in = (quadrant[:, 0].max() - quadrant[:, 0].min()) / IN
        assert width_in == pytest.approx(SHEET_BOLT_DIA_IN, abs=0.02)
        assert verts[:, 1].min() == pytest.approx(0.0, abs=1e-9)
        assert verts[:, 1].max() / IN == pytest.approx(SHEET_PROJECTION_IN, abs=0.02)

    def test_a_thicker_wall_takes_the_bigger_bolt(self, cat):
        """The sheet lists 0.63 in bolts at wall C and 0.75 in at D/E."""
        thick = piece(shell_assembly(cat, config(cat, **{"wall-thickness": "D"})), "Anchor Bolts")
        quadrant = thick.verts[(thick.verts[:, 0] > 0) & (thick.verts[:, 2] > 0)]
        assert (quadrant[:, 0].max() - quadrant[:, 0].min()) / IN == pytest.approx(0.75, abs=0.02)

    def test_bolts_pass_through_the_casting_footprint(self, cat):
        """A bolt outside the plate would be a modelling error, not hardware."""
        shells = shell_assembly(cat, config(cat))
        base = piece(shells, "Pole Base")
        bolts = piece(shells, "Anchor Bolts")
        for axis in (0, 2):
            assert bolts.verts[:, axis].max() <= base.verts[:, axis].max() + 1e-6
            assert bolts.verts[:, axis].min() >= base.verts[:, axis].min() - 1e-6


class TestDrawing:
    def test_bolts_belong_to_the_pole_and_get_no_height_callout(self, cat):
        assert component_of("Anchor Bolts") == "pole"
        shells = shell_assembly(cat, config(cat))
        labels = [label for label, *_ in pole_features(shells, "front")]
        assert "ANCHOR BOLTS" not in labels, labels

    def test_sheet_carries_an_anchor_base_detail_with_the_bolt_circle(self, cat, tmp_path):
        """The detail has to exist as its own view: a decorative base cover
        wraps the anchor base, so on the elevation the bolts are hidden."""
        cfg = config(cat)
        ctx = GenContext(
            catalog=cat,
            cfg=cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, cfg),
            assembly=build_assembly(cat, cfg),
            render_png=None,
            summary={},
        )
        doc = ezdxf.readfile(str(DxfAdapter().generate(ctx)[0]))
        msp = doc.modelspace()

        labels = [e.dxf.text for e in msp if e.dxftype() == "TEXT"]
        assert any("ANCHOR BASE DETAIL" in t for t in labels), labels

        bolt_dims = [
            e for e in msp if e.dxftype() == "DIMENSION" and "BOLT CIRCLE" in (e.dxf.text or "")
        ]
        assert len(bolt_dims) == 1, [e.dxf.text for e in msp if e.dxftype() == "DIMENSION"]
        dim = bolt_dims[0]
        # A detail at its own scale needs its own dimension style: DIMLFAC is a
        # per-style property, so it cannot share the sheet's 1:30.
        assert dim.dxf.dimstyle != "WILL-DIM"
        lfac = doc.dimstyles.get(dim.dxf.dimstyle).dxf.dimlfac
        assert dim.dxf.actual_measurement * lfac == pytest.approx(SHEET_BOLT_CIRCLE_IN, abs=0.02)

    def test_an_embedded_pole_draws_no_detail(self, cat, tmp_path):
        cfg = config(cat, design="RSAD")
        ctx = GenContext(
            catalog=cat,
            cfg=cfg,
            out_dir=tmp_path,
            base_name=base_name(cat, cfg),
            assembly=build_assembly(cat, cfg),
            render_png=None,
            summary={},
        )
        doc = ezdxf.readfile(str(DxfAdapter().generate(ctx)[0]))
        texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
        assert not any("ANCHOR BASE" in t for t in texts), texts
