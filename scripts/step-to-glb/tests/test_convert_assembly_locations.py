"""Phase 0.19: assembly instance locations in the color-aware reader.

Root cause of "weird lines on the TEX drum" (Nick, 8/24): _read_labeled_solids
iterated XCAFDoc_ShapeTool.GetShapes, which lists subassembly/component
PROTOTYPE labels alongside the free root — so every prototype's solids were
emitted a second time, in their LOCAL frame, on top of the correctly-located
set. TEX.STEP (219 solids) yielded 353; its dark drum-skin prototype landed
exactly 101.6 mm (4.000 in) high, poking through the render as a rod above
the housing and exposing mislocated fin duplicates as lines on the drum.

The reader must walk GetFreeShapes and compose component locations — the
canonical XDE traversal — so it emits each solid exactly once, where the
assembly places it.
"""
import pathlib

import pytest
from convert import _read_labeled_solids

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.gp import gp_Trsf, gp_Vec
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool
from OCP.Quantity import Quantity_Color, Quantity_TypeOfColor


def _write_two_instance_assembly(path: str) -> None:
    """One 10 mm box PROTOTYPE, placed twice: at origin and at y=+100 mm."""
    doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape()
    proto = st.AddShape(box, False)
    ct.SetColor(proto, Quantity_Color(0.2, 0.3, 0.4, Quantity_TypeOfColor.Quantity_TOC_RGB),
                XCAFDoc_ColorType.XCAFDoc_ColorGen)
    asm = st.NewShape()
    st.AddComponent(asm, proto, TopLoc_Location())
    moved = gp_Trsf()
    moved.SetTranslation(gp_Vec(0.0, 100.0, 0.0))
    st.AddComponent(asm, proto, TopLoc_Location(moved))
    st.UpdateAssemblies()
    writer = STEPCAFControl_Writer()
    writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs)
    assert writer.Write(path) == IFSelect_RetDone


def _bbox(solid):
    b = Bnd_Box()
    BRepBndLib.Add_s(solid, b)
    return b.Get()


def test_each_instance_emitted_once_where_the_assembly_places_it(tmp_path):
    step = tmp_path / "two-boxes.step"
    _write_two_instance_assembly(str(step))
    labeled = _read_labeled_solids(str(step))
    # Exactly the two placed instances — the prototype itself must NOT be
    # emitted as a third, unlocated copy (the GetShapes defect).
    assert len(labeled) == 2, f"expected 2 located solids, got {len(labeled)}"
    tops = sorted(round(_bbox(s)[4], 3) for s, _ in labeled)
    assert tops == [10.0, 110.0], f"instances not at their assembly locations: {tops}"
    # The prototype's color reaches both instances.
    for _s, rgb in labeled:
        assert rgb == pytest.approx((0.2, 0.3, 0.4), abs=0.02)


TEX = pathlib.Path(__file__).resolve().parents[2] / "render-rig" / "real-assets" / "step" / "TEX.STEP"


@pytest.mark.skipif(not TEX.exists(), reason="real TEX STEP not extracted")
def test_tex_master_yields_its_true_solid_set():
    """TEX.STEP holds 219 solids in y -393.70..177.80 (plain-reader ground
    truth, matching the spec sheet's 22.5 in). The old enumeration yielded 353
    with a duplicate drum skin topping out 101.6 mm above the fixture."""
    labeled = _read_labeled_solids(str(TEX))
    assert len(labeled) == 219, f"phantom prototype solids: got {len(labeled)}"
    top = max(_bbox(s)[4] for s, _ in labeled)
    assert top == pytest.approx(177.80, abs=0.2)


def test_paint_all_maps_every_solid_to_the_paintable_body(tmp_path):
    """paint_all: the finish system tints only will-body (page/main.ts), and
    the approved renders tint the whole fixture — so the six colour-mode
    render masters convert with every solid paintable, regardless of the
    authored STEP colours the location fix surfaced (Phase 0.19)."""
    import struct, json
    from convert import convert_color_aware

    step = tmp_path / "two-boxes.step"
    _write_two_instance_assembly(str(step))
    out = tmp_path / "painted.glb"
    stats = convert_color_aware(str(step), str(out), origin="base", tol_mm=1.0,
                                paint_all=True)
    assert stats["primitives"] == 1
    assert stats["body_primitives"] == 1
    blob = out.read_bytes()
    jl = struct.unpack("<I", blob[12:16])[0]
    g = json.loads(blob[20:20 + jl])
    assert [m["name"] for m in g["materials"]] == ["will-body"]
    # …and the colour path still honours the authored colour without it.
    out2 = tmp_path / "true-colors.glb"
    stats2 = convert_color_aware(str(step), str(out2), origin="base", tol_mm=1.0)
    blob2 = out2.read_bytes()
    jl2 = struct.unpack("<I", blob2[12:16])[0]
    g2 = json.loads(blob2[20:20 + jl2])
    assert any(m["name"].startswith("will-fixed-") for m in g2["materials"])
