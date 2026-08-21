"""Tests for the drawing projection — Phase 0.18.

The sheet draws ONE outline per component (fixture, arm, pole, base cover) and
nothing else: no internal feature lines, and nothing showing through a solid
part. Both properties are asserted geometrically rather than by counting
entities, because a count says nothing about WHERE the lines are.
"""

from __future__ import annotations

import uuid

import pytest
from shapely import Point, unary_union

from app.catalog import load_catalog
from app.drawing import (
    VIEWS,
    component_silhouettes,
    outlines_by_component,
    project_outlines,
    view_extents,
)
from app.models import PoleConfig
from app.shellgeom import shell_assembly

from .conftest import first_base_cover_for

#: The outline is simplified (0.01") and cut by a padded occluder (0.01"), so a
#: drawn midpoint can sit this far off the exact silhouette boundary. A
#: reinstated crease line would be a whole feature away, not a hair.
_ON_BOUNDARY_IN = 0.05

#: How deep inside a component a point has to be to count as covered by it.
_COVERED_IN = 0.05


@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="module")
def shells(cat):
    cfg = PoleConfig(
        configId=str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )
    assembly = shell_assembly(cat, cfg)
    assert assembly is not None, "default config must have full shell coverage"
    return cat, cfg, assembly


@pytest.fixture(scope="module", params=VIEWS)
def view(request) -> str:
    return request.param


def _midpoints(segs):
    return [Point((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) for s in segs]


class TestComponentOutlines:
    def test_components_are_the_parts_a_drafter_names(self, shells, view):
        """One silhouette per component, and the pole's base casting and hand
        hole belong to the pole rather than adding items of their own."""
        cat, cfg, assembly = shells
        filled, _ = component_silhouettes(assembly, view)
        assert set(filled) == {"pole", "baseCover", "arm", "fixture"}

    def test_no_segment_lies_inside_its_own_component(self, shells, view):
        """Every drawn segment is on a component's silhouette BOUNDARY.

        This is the "no inner guts" property. Silhouette+crease line work put
        thousands of segments across the middle of each casting — the cast
        base's steps, the cover's rings, every sharp edge inside the fixture —
        and each of those is far from any boundary.
        """
        cat, cfg, assembly = shells
        filled, _ = component_silhouettes(assembly, view)
        segs = project_outlines(assembly, view)
        assert segs, f"view {view!r} produced no line work"

        boundaries = unary_union([geom.boundary for geom in filled.values()])
        off = [
            (round(p.x, 3), round(p.y, 3), round(boundaries.distance(p), 3))
            for p in _midpoints(segs)
            if boundaries.distance(p) > _ON_BOUNDARY_IN
        ]
        assert not off, (
            f"{len(off)} of {len(segs)} segments in view {view!r} are not on any "
            f"component boundary (interior feature lines?): {off[:5]}"
        )

    def test_nothing_is_drawn_under_a_nearer_component(self, shells, view):
        """The opacity property: a component in front hides what is behind it.

        Asserted per component, which is exactly the contract the whole-part
        ordering can keep — drop the `difference()` and every component behind
        the first one lights this up. It deliberately does NOT assert that two
        interpenetrating components sort correctly: the arm's tip lives inside
        the fixture's socket, so on the isometric the arm is the nearer part as
        a whole and its tube crosses the dome. Fixing that needs per-face
        hidden-line removal on B-rep solids, noted in `app/drawing.py`.
        """
        cat, cfg, assembly = shells
        filled, depth = component_silhouettes(assembly, view)
        by_component = outlines_by_component(assembly, view)

        cores = {k: geom.buffer(-_COVERED_IN) for k, geom in filled.items()}
        buried = []
        for key, segs in by_component.items():
            for point in _midpoints(segs):
                for other, core in cores.items():
                    if other == key or depth[other] <= depth[key]:
                        continue
                    if not core.is_empty and core.contains(point):
                        buried.append((key, other, round(point.x, 3), round(point.y, 3)))
        assert not buried, (
            f"{len(buried)} segments in view {view!r} are drawn under a nearer "
            f"component: {buried[:5]}"
        )

    def test_outline_extents_match_the_assembly(self, shells, view):
        """Removing the interior line work must not move the envelope — the
        sheet scales and dimensions itself off these extents."""
        cat, cfg, assembly = shells
        filled, _ = component_silhouettes(assembly, view)
        segs = project_outlines(assembly, view)

        x0, y0, x1, y1 = view_extents(segs)
        fx0, fy0, fx1, fy1 = unary_union(list(filled.values())).bounds
        for drawn, expected, label in (
            (x0, fx0, "xmin"),
            (y0, fy0, "ymin"),
            (x1, fx1, "xmax"),
            (y1, fy1, "ymax"),
        ):
            assert abs(drawn - expected) <= _ON_BOUNDARY_IN, (
                f"view {view!r} {label}: outline {drawn:.3f} vs silhouette "
                f"{expected:.3f} in"
            )
