"""STEP format adapter.

Exports the fused assembly solid as a STEP file, then post-processes the
header to label the file with the WiLL config identity and DISCLAIMER.

Header rewriting
----------------
The raw FILE_DESCRIPTION line produced by build123d looks like:

    FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');

This adapter replaces that with:

    FILE_DESCRIPTION(('WiLL concept model config <configId> rev <rev>',
        '<DISCLAIMER>'),'2;1');

STEP strings use single-quoted (apostrophe) delimiters.  The DISCLAIMER
uses a plain ASCII hyphen so no escaping is needed.  configId values are
UUIDs — no apostrophes — so the substitution is safe without escaping.

Determinism
-----------
build123d's export_step embeds the current timestamp in FILE_NAME.  That
line is the *only* non-deterministic element; callers that need to compare
two exports for identity should strip lines starting with FILE_NAME before
comparing.
"""

from __future__ import annotations

import re
import threading
from pathlib import Path

from build123d import export_step

from app.naming import DISCLAIMER
from app.shellgeom import shell_assembly

from .base import Adapter, GenContext

# OCC's Interface_Static is PROCESS-GLOBAL state, and jobs run on a thread
# pool — serialize shell-STEP writes and restore the params afterwards so a
# concurrent (or later) build123d export never inherits AP242/tessellated.
_WRITE_LOCK = threading.Lock()


class StepAdapter:
    """Adapter that produces a labeled, deterministic STEP file."""

    format: str = "step"

    def available(self) -> bool:
        """build123d is a hard dependency of the service; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        """Export the config to STEP, patch the header, return [path].

        Phase 0.17 (Tyler 8/19, "improve the STEP file export"): when every
        core part has a gated exterior shell, the file is AP242 TESSELLATED
        STEP assembled from the real products' shells — the same geometry the
        shell-accurate IFC ships, compact because AP242 stores triangle
        indices rather than faceted B-rep. Anything without full shell
        coverage falls back to the parametric kit solid whole (never a
        hybrid), exactly like the IFC.
        """
        out_path = ctx.out_dir / f"{ctx.base_name}.step"

        shells = shell_assembly(ctx.catalog, ctx.cfg)
        if shells is not None:
            _write_tessellated_step(shells, out_path)
            ctx.warnings.extend(f"step: {w}" for w in shells.warnings)
        else:
            if ctx.assembly is None:
                raise RuntimeError("StepAdapter requires a built assembly (ctx.assembly is None)")
            export_step(ctx.assembly.solid, out_path)
            ctx.warnings.append(
                "step: concept solids used - a configured part has no gated shell yet"
            )

        # --- Post-process header ---
        _label_step_header(out_path, ctx.cfg.configId, ctx.cfg.rev)
        _pin_step_timestamp(out_path)

        return [out_path]


def _write_tessellated_step(shells, out_path: Path) -> None:
    """Write the shell assembly as AP242 tessellated STEP (OCP).

    Each SHELL piece becomes ONE mesh-only TopoDS_Face (a face carrying only
    its Poly_Triangulation, no surface): under schema AP242 with
    write.step.tessellated = OnNoBRep, OCC emits TRIANGULATED_FACE entities
    for exactly those faces.

    The POLE is different and better (Tyler 8/20): a straight pole is a
    constant-profile extrusion, so it ships as a TRUE B-rep hollow cylinder in
    the same compound — exact surfaces at any length, no per-length source
    file and no stacked-section seams to boolean away. OnNoBRep leaves it as
    real geometry precisely because it HAS a B-rep. Frame conversion matches the kit's
    STEP output: viewer meters +Y up → millimetres +Z up (x, −z, y)·1000.

    A piece carrying an analytic ``cylinder`` (the pole shaft, Phase 0.17.5)
    becomes a real B-rep cylinder solid instead — the decimated 121-triangle
    shell prism flat-shades into visible facets on import, while an analytic
    CYLINDRICAL_SURFACE imports smooth, matching Cole's CAD exports.
    OnNoBRep leaves faces WITH surfaces as ordinary B-rep, so the mix is safe;
    note OCC then encodes the mesh pieces as TRIANGULATED_SURFACE_SET rather
    than the all-mesh compound's TRIANGULATED_FACE (measured, both AP242).

    OCP is imported here, inside the adapter (boundary rule).
    """
    from OCP.BRep import BRep_Builder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    from OCP.Interface import Interface_Static
    from OCP.Poly import Poly_Triangle, Poly_Triangulation
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
    from OCP.TopoDS import TopoDS_Compound, TopoDS_Face

    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    for piece in shells.pieces:
        if piece.cylinder is not None:
            c = piece.cylinder
            axis = gp_Ax2(gp_Pnt(0.0, 0.0, c.y0_m * 1000.0), gp_Dir(0.0, 0.0, 1.0))
            r_out = c.radius_m * 1000.0
            height = (c.y1_m - c.y0_m) * 1000.0
            solid = BRepPrimAPI_MakeCylinder(axis, r_out, height).Shape()
            # A pole is a TUBE, not a rod: subtract the bore. Its radius comes
            # from the piece's own generated mesh (whose inner wall is built
            # from the config's wall-thickness code), so the solid and the mesh
            # describe the same part. A mesh with no measurable bore — or a
            # degenerate cut — ships the plain cylinder rather than nothing.
            rad = (piece.verts[:, 0] ** 2 + piece.verts[:, 2] ** 2) ** 0.5
            r_in = float(rad.min()) * 1000.0
            if 0.0 < r_in < r_out - 1e-6:
                bore = BRepPrimAPI_MakeCylinder(axis, r_in, height).Shape()
                cut = BRepAlgoAPI_Cut(solid, bore)
                if cut.IsDone():
                    solid = cut.Shape()
            builder.Add(compound, solid)
            continue
        tri = Poly_Triangulation(len(piece.verts), len(piece.tris), False)
        for i, (x, y, z) in enumerate(piece.verts, start=1):
            tri.SetNode(i, gp_Pnt(float(x) * 1000.0, float(-z) * 1000.0, float(y) * 1000.0))
        for i, (a, b, c) in enumerate(piece.tris, start=1):
            tri.SetTriangle(i, Poly_Triangle(int(a) + 1, int(b) + 1, int(c) + 1))
        face = TopoDS_Face()
        builder.MakeFace(face)
        builder.UpdateFace(face, tri, True)
        builder.Add(compound, face)

    with _WRITE_LOCK:
        # Constructing a writer registers the STEP Interface_Static params
        # (querying before that returns empty and Set* fails — measured).
        STEPControl_Writer()
        prev_schema = Interface_Static.CVal_s("write.step.schema")
        prev_tess = Interface_Static.CVal_s("write.step.tessellated")
        try:
            Interface_Static.SetCVal_s("write.step.schema", "AP242DIS")
            Interface_Static.SetCVal_s("write.step.tessellated", "OnNoBRep")
            writer = STEPControl_Writer()
            writer.Transfer(compound, STEPControl_AsIs)
            writer.Write(str(out_path))
        finally:
            Interface_Static.SetCVal_s("write.step.schema", prev_schema or "AP214IS")
            Interface_Static.SetCVal_s("write.step.tessellated", prev_tess or "OnNoBRep")


# FILE_NAME's second field is the wall-clock timestamp OCC stamps at write
# time; PRODUCT names carry OCC's PROCESS-GLOBAL model counter ("Open CASCADE
# STEP translator 7.9 1" → "… 2" on the next write in the same process —
# caught by the bundle's byte-determinism test). Pin both so two runs are
# byte-identical regardless of how many writes preceded them.
_FN_TIMESTAMP = re.compile(r"^(FILE_NAME\s*\('[^']*',\s*)'[^']*'", re.MULTILINE)
_OCC_MODEL_NAME = re.compile(r"'Open CASCADE STEP translator [0-9. ]*'")
# NEXT_ASSEMBLY_USAGE_OCCURRENCE ids come from the same process-global
# counter — renumber them 1..N in file order.
_OCC_NAUO_ID = re.compile(r"(NEXT_ASSEMBLY_USAGE_OCCURRENCE\(')[0-9]+(')")


def _pin_step_timestamp(path: Path) -> None:
    text = path.read_text(encoding="ascii")
    text = _FN_TIMESTAMP.sub(r"\1'1970-01-01T00:00:00'", text, count=1)
    text = _OCC_MODEL_NAME.sub("'WiLL shell model'", text)
    counter = iter(range(1, 10_000))
    text = _OCC_NAUO_ID.sub(lambda m: f"{m.group(1)}{next(counter)}{m.group(2)}", text)
    path.write_text(text, encoding="ascii")


# ---------------------------------------------------------------------------
# Header patching
# ---------------------------------------------------------------------------

# Pattern: FILE_DESCRIPTION((<any quoted strings>),'<level>');
#
# This must tolerate BOTH the OpenCASCADE/build123d form —
#
#     FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');
#
# and the SolidWorks AP214 form, which adds whitespace after the keyword and
# around tokens, splits across lines, and uses implementation level '1':
#
#     FILE_DESCRIPTION (( 'STEP AP214' ),
#         '1' );
#
# We capture the implementation level so it can be PRESERVED verbatim in the
# rewritten header — forcing '2;1' onto a SolidWorks '1' file would be an
# invalid implementation-level swap.
_FD_PATTERN = re.compile(
    r"^FILE_DESCRIPTION\s*\(.*?\),\s*'(?P<level>2;1|1)'\s*\)\s*;",
    re.MULTILINE | re.DOTALL,
)


def _label_step_header(path: Path, config_id: str, rev: int) -> None:
    """Rewrite FILE_DESCRIPTION in ``path`` in-place to carry WiLL metadata.

    The DISCLAIMER contains only ASCII hyphens and alphanumerics — no
    apostrophes — so it embeds safely in a STEP single-quoted string.
    configId values are UUIDs (hex + hyphens) and also need no escaping.

    The original implementation level (``'2;1'`` for OpenCASCADE/build123d,
    ``'1'`` for SolidWorks) is captured and re-emitted unchanged.
    """
    text = path.read_text(encoding="ascii")

    def _replace(m: re.Match) -> str:
        level = m.group("level")
        return (
            f"FILE_DESCRIPTION("
            f"('WiLL concept model config {config_id} rev {rev}',"
            f"'{DISCLAIMER}'),"
            f"'{level}');"
        )

    # Replace only the first occurrence (the STEP header always has exactly one).
    # MULTILINE | DOTALL let the pattern span the multi-line SolidWorks form.
    new_text = _FD_PATTERN.sub(_replace, text, count=1)

    path.write_text(new_text, encoding="ascii")
