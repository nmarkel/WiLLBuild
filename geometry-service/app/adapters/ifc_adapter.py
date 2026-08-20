"""IFC format adapter — Revit deliverable, Option B (IfcOpenShell).

Exports the fused assembly solid as an IFC4 file containing exactly one
``IfcLightFixture`` (Revit maps this class to its *Lighting Fixtures*
category) under the canonical spatial chain project → site → building →
storey.  Geometry is the fused build123d solid tessellated at 0.5 mm and
written as an ``IfcPolygonalFaceSet``.  Length unit: millimetres.

Property set ``Pset_WiLLConcept`` on the fixture carries ConfigId,
Revision, Disclaimer (naming.DISCLAIMER), OverallHeight_mm, Finish.

Determinism
-----------
Two runs over the same config must be byte-identical:

* FILE_NAME header: ``time_stamp`` pinned to the epoch, ``name`` set to the
  output filename (ifcopenshell 0.8.5 creates no IfcOwnerHistory via the
  api calls used here, so no timestamps exist in the DATA section).
* GUIDs: every IfcRoot subtype gets its GlobalId rewritten after the model
  is assembled, derived via ``uuid5(namespace, config_hash:Class:index)``
  compressed to IFC base64 — entity creation order is deterministic, so
  the index is stable.

ifcopenshell is imported ONLY in this module (adapter boundary rule).
"""

from __future__ import annotations

import uuid
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid

from app.naming import DISCLAIMER, config_hash
from app.shellgeom import shell_assembly

from .base import Adapter, GenContext

_TESSELLATION_TOLERANCE_MM = 0.5

# Fixed namespace for deterministic IFC GUIDs (uuid5).
_GUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://willbrands.com/willbuild/ifc")

# Fixed header timestamp (ISO 8601) — neutralizes the only wall-clock value.
_EPOCH_TIMESTAMP = "1970-01-01T00:00:00"


def _det_guid(cfg_hash: str, role: str) -> str:
    """Return a deterministic IFC GlobalId for (config hash, entity role)."""
    return ifcopenshell.guid.compress(uuid.uuid5(_GUID_NAMESPACE, f"{cfg_hash}:{role}").hex)


class IfcAdapter:
    """Adapter that produces a deterministic IFC4 file with one IfcLightFixture."""

    format: str = "ifc"

    def available(self) -> bool:
        """ifcopenshell imported at module top — reaching here means it loaded."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        if ctx.assembly is None:
            raise RuntimeError("IfcAdapter requires a built assembly (ctx.assembly is None)")

        out_path = ctx.out_dir / f"{ctx.base_name}.ifc"
        cfg_hash = config_hash(ctx.cfg)

        f = ifcopenshell.file(schema="IFC4")

        # --- Header: neutralize timestamp, label the file ---
        f.header.file_name.name = out_path.name
        f.header.file_name.time_stamp = _EPOCH_TIMESTAMP

        # --- Project + units (mm) + geometric contexts ---
        project = f.createIfcProject(
            _det_guid(cfg_hash, "project"), None, "WiLL Concept Model"
        )
        ifcopenshell.api.run(
            "unit.assign_unit", f, length={"is_metric": True, "raw": "MILLIMETERS"}
        )
        model_ctx = ifcopenshell.api.run("context.add_context", f, context_type="Model")
        body_ctx = ifcopenshell.api.run(
            "context.add_context",
            f,
            context_type="Model",
            context_identifier="Body",
            target_view="MODEL_VIEW",
            parent=model_ctx,
        )

        # --- Spatial chain: site → building → storey ---
        site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
        building = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBuilding", name="Building"
        )
        storey = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBuildingStorey", name="Ground Level"
        )
        ifcopenshell.api.run("aggregate.assign_object", f, relating_object=project, products=[site])
        ifcopenshell.api.run("aggregate.assign_object", f, relating_object=site, products=[building])
        ifcopenshell.api.run(
            "aggregate.assign_object", f, relating_object=building, products=[storey]
        )

        # --- The one IfcLightFixture (Revit: Lighting Fixtures category) ---
        fixture = ifcopenshell.api.run(
            "root.create_entity",
            f,
            ifc_class="IfcLightFixture",
            name=f"WiLL Pole Assembly {ctx.cfg.configId}",
        )
        ifcopenshell.api.run(
            "spatial.assign_container", f, relating_structure=storey, products=[fixture]
        )

        # --- Geometry (Phase 0.17): the gated EXTERIOR SHELLS of the real CAD
        # when every core part has one — one named IfcPolygonalFaceSet per
        # component, so Revit shows the actual products instead of the
        # parametric concept solids. Falls back to the fused kit solid whole
        # (never a hybrid) when any core shell is missing.
        shells = shell_assembly(ctx.catalog, ctx.cfg)
        if shells is not None:
            fixture.Representation = self._shell_shape(f, body_ctx, shells)
            ctx.warnings.extend(f"ifc: {w}" for w in shells.warnings)
        else:
            fixture.Representation = self._tessellated_shape(f, body_ctx, ctx)
            ctx.warnings.append(
                "ifc: concept solids used - a configured part has no gated shell yet"
            )

        # --- Pset_WiLLConcept ---
        pset = ifcopenshell.api.run("pset.add_pset", f, product=fixture, name="Pset_WiLLConcept")
        ifcopenshell.api.run(
            "pset.edit_pset",
            f,
            pset=pset,
            properties={
                "ConfigId": ctx.cfg.configId,
                "Revision": ctx.cfg.rev,
                "Disclaimer": DISCLAIMER,
                "OverallHeight_mm": ctx.assembly.dims.overall_height,
                "Finish": ctx.cfg.finish,
            },
        )

        # --- Determinism: rewrite every IfcRoot GlobalId from the config hash ---
        _assign_deterministic_guids(f, cfg_hash)

        f.write(str(out_path))
        return [out_path]

    @staticmethod
    def _shell_shape(f, body_ctx, shells):
        """One named IfcPolygonalFaceSet per shell piece (meters, +Y up →
        millimetres, +Z up: x→x, y→z, z→−y — matching the kit's IFC frame)."""
        items = []
        for piece in shells.pieces:
            v = piece.verts
            coord_list = [
                [float(x * 1000.0), float(-z * 1000.0), float(y * 1000.0)] for x, y, z in v
            ]
            point_list = f.createIfcCartesianPointList3D(coord_list)
            faces = [
                f.createIfcIndexedPolygonalFace([int(a) + 1, int(b) + 1, int(c) + 1])
                for a, b, c in piece.tris
            ]
            items.append(f.createIfcPolygonalFaceSet(point_list, None, faces))
        shape_rep = f.createIfcShapeRepresentation(body_ctx, "Body", "Tessellation", items)
        return f.createIfcProductDefinitionShape(None, None, [shape_rep])

    @staticmethod
    def _tessellated_shape(f, body_ctx, ctx: GenContext):
        """Mesh ctx.assembly.solid and wrap it as an IfcProductDefinitionShape."""
        vertices, triangles = ctx.assembly.solid.tessellate(_TESSELLATION_TOLERANCE_MM)
        coord_list = [[float(v.X), float(v.Y), float(v.Z)] for v in vertices]
        point_list = f.createIfcCartesianPointList3D(coord_list)
        # IFC face indices are 1-based; build123d triangles are 0-based.
        faces = [
            f.createIfcIndexedPolygonalFace([a + 1, b + 1, c + 1]) for a, b, c in triangles
        ]
        face_set = f.createIfcPolygonalFaceSet(point_list, None, faces)
        shape_rep = f.createIfcShapeRepresentation(body_ctx, "Body", "Tessellation", [face_set])
        return f.createIfcProductDefinitionShape(None, None, [shape_rep])


def _assign_deterministic_guids(f, cfg_hash: str) -> None:
    """Rewrite all IfcRoot GlobalIds deterministically.

    ifcopenshell.api assigns random GUIDs at creation.  The model is built in
    a fixed sequence, so file order (entity id) is stable; keying each GUID on
    config hash + class + ordinal makes two runs byte-identical.
    """
    for i, entity in enumerate(f.by_type("IfcRoot")):
        entity.GlobalId = _det_guid(cfg_hash, f"{entity.is_a()}:{i}")
