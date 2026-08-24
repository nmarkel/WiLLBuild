"""The 4-view drawing sheet, laid out to WiLL's own submittal template.

Phase 0.18 (Tyler 8/20). Template of record: the SolidWorks C-size sheet
`Tenon-Drilling-Adapter-Round-Approval-Rev A` — ANSI C (22 x 17 in) landscape,
A-D / 1-4 zone borders, fractional-inch dimensions, and a title block carrying
TITLE / DWG. NO. / REV / SIZE / SCALE / WEIGHT / SHEET, a sign-off table, the
company address block and the proprietary notice.

Two deliberate departures from that template, Tyler's call 8/20:
  * It reads CONCEPT DRAWING - DETAILED APPROVAL DRAWING AT ORDER ENTRY, not
    "SUBMITTAL DRAWING". A configurator sheet is a concept starter model; the
    word "submittal" beside a signature line invites approval of geometry we
    label conceptual.
  * No CUSTOMER APPROVAL signature block, for the same reason. It returns when
    an actual approval drawing does.
WEIGHT stays blank: no per-part weights exist yet (same gap as the structural
GO/NO-GO item), and an invented number on a drawing is worse than an empty
field.

Drafting decisions from Tyler's 8/20 review, enforced here rather than left to
chance:
  * Text is BLACK. Every layer this module draws on is colour 7.
  * Nothing overlaps. The title block, the view labels and every dimension go
    through one `_Occupancy` ledger, and a dimension whose text would land on
    something already placed is pushed further out until it stands alone.
  * Lengths of 12" and over read in feet and inches (`fmt_length`).
  * The isometric is furthest LEFT and carries no label; the elevations read
    FRONT (0 DEG) and SIDE (90 DEG); the plan reads TOP VIEW.
  * Callouts: overall height (bottom of the structure to the top), overall
    width, and the height of every feature added to the pole — hand hole,
    coupling, banner arm — measured from the bottom of the structure.
  * Feature callouts are NAMED and face-on (Tyler's 8/21 pole reference
    drawing): the dimension text carries the feature's name ("1'-3\" HAND
    HOLE"), the overall height reads "OVERALL HEIGHT", and each feature dims
    beside the elevation that shows it face-on rather than edge-on. The
    feature itself is drawn as deliberate loops with a centre cross
    (`feature_line_work` + WILL-CENTER) — the per-pixel HLR lost a flush
    feature like the hand hole at grazing angles.

The title block sizes ITSELF. Its content varies enormously — a four-part title
for an 18 ft assembly, a UUID drawing number, one finish per component, a note
from the shell builder — so rows wrap, shrink to a floor, and the band grows to
fit, while the layout order never changes. Views then take the space that is
left: standard scales are tried in order and the first that fits wins.

Views are projected from the SHELL assembly (app/drawing.py) — the same
geometry the IFC and STEP ship — so all three deliverables finally agree.
ezdxf is imported only in the adapters package (boundary rule).
"""

from __future__ import annotations

import ezdxf
from ezdxf.enums import TextEntityAlignment

from app.drawing import (
    SHEET_C_IN,
    VIEWS,
    bolt_centres,
    feature_line_work,
    fmt_length,
    outlines_by_component,
    pole_features,
    simplify,
    subassembly,
    view_extents,
    visible_features,
)
from app.naming import DISCLAIMER
from app.shellgeom import shell_assembly

# --- Determinism -----------------------------------------------------------
# The service's rule is byte-identical output for the same config, and a plain
# ezdxf document breaks it: it stamps $TDCREATE/$TDUPDATE, a random
# $FINGERPRINTGUID/$VERSIONGUID, and a "<version> @ <now>" marker written at
# SAVE time (so it cannot be pinned by editing the document first). ezdxf's own
# switch pins all of that — its name says "for testing", but a reproducible
# artifact needs exactly the same thing — and the fingerprint GUID it leaves
# alone is pinned per document by `pin_document`. Set at import so it also
# covers the two legacy routes, which build their own documents.
ezdxf.options.write_fixed_meta_data_for_testing = True

_FIXED_GUID = "{00000000-0000-0000-0000-000000000000}"


def pin_document(doc) -> None:
    """Remove the last wall-clock/random field from a DXF document."""
    doc.header["$FINGERPRINTGUID"] = _FIXED_GUID


# Layers: a CAD user must be able to control what plots (the pre-0.18 sheet put
# every entity on layer 0). Colour 7 plots BLACK — the sheet had green
# dimensions and grey title text, which is a plotting decision nobody asked
# for.
LAYERS = {
    "WILL-BORDER": 7,
    "WILL-OUTLINE": 7,
    "WILL-FEATURES": 7,
    "WILL-CENTER": 7,  # feature centre marks; CENTER linetype set in build_sheet
    "WILL-DIMS": 7,
    "WILL-TEXT": 7,
    "WILL-TITLE": 7,
}

_MARGIN_IN = 0.5
_STD_SCALES = (1, 2, 4, 5, 8, 10, 16, 20, 30, 40, 50, 75, 100)

#: The DXF TXT font runs about this fraction of its height per character. Used
#: for wrapping and for reserving space; erring generous is the safe direction.
_CHAR_W = 0.62

_VIEW_LABEL = {
    "front": "FRONT (0 DEG)",
    "side": "SIDE (90 DEG)",
    "top": "TOP VIEW",
    "iso": "",  # Tyler 8/20: an isometric needs no label
}

#: Left to right. The isometric leads (Tyler 8/20); the plan sits in the
#: remaining upper-right space because it is short and wide.
_COLUMN_ORDER = ("iso", "front", "side")

_DIMSTYLE = "WILL-DIM"
_DETAIL_DIMSTYLE = "WILL-DIM-DETAIL"

#: The pieces the anchor base detail draws, and what it is called. A decorative
#: base cover WRAPS the anchor base, so on a full elevation the bolts are
#: correctly hidden — the spec sheet answers that with its own anchor base
#: detail (poles sheet p7), and so does this.
_BASE_DETAIL_PIECES = ("Pole", "Pole Base", "Anchor Bolts")
_BASE_DETAIL_LABEL = "ANCHOR BASE DETAIL" 


# ---------------------------------------------------------------------------
# Text metrics, wrapping, and keeping things off each other
# ---------------------------------------------------------------------------


def _text_w(text: str, height: float) -> float:
    return len(text) * height * _CHAR_W


def _wrap(text: str, max_w: float, height: float) -> list[str]:
    """Greedy word wrap. A single word wider than the line is hard-split, so a
    UUID drawing number cannot run off the end of its cell."""
    lines: list[str] = []
    current = ""
    for word in str(text).split():
        trial = f"{current} {word}".strip()
        if _text_w(trial, height) <= max_w or not current:
            current = trial
        else:
            lines.append(current)
            current = word
        while _text_w(current, height) > max_w and len(current) > 1:
            cut = max(1, int(max_w / (height * _CHAR_W)))
            lines.append(current[:cut])
            current = current[cut:]
    if current:
        lines.append(current)
    return lines or [""]


def _fit(text: str, max_w: float, max_lines: int, heights) -> tuple[float, list[str]]:
    """The largest height in `heights` whose wrap fits inside `max_lines`."""
    for height in heights:
        lines = _wrap(text, max_w, height)
        if len(lines) <= max_lines:
            return height, lines
    return heights[-1], _wrap(text, max_w, heights[-1])[:max_lines]


class _Occupancy:
    """Rectangles already claimed on the sheet, so nothing is drawn twice over.

    Tyler 8/20: "There should never be multiple layers of text on top of each
    other. If there is, move dimension around to be stand alone."
    """

    def __init__(self) -> None:
        self._rects: list[tuple[float, float, float, float]] = []

    def add(self, rect) -> None:
        self._rects.append(rect)

    def free(self, rect, pad: float = 0.04) -> bool:
        x0, y0, x1, y1 = rect
        for bx0, by0, bx1, by1 in self._rects:
            if x0 - pad < bx1 and bx0 - pad < x1 and y0 - pad < by1 and by0 - pad < y1:
                return False
        return True


# ---------------------------------------------------------------------------
# Entry point shared by both DXF routes
# ---------------------------------------------------------------------------


def try_shell_sheet(ctx):
    """The 0.18 sheet, or None when this config has no full shell coverage.

    BOTH DXF routes call this first (Phase 0.18). The route flag selects how a
    part SILHOUETTE is produced, and on this sheet the line work comes from the
    shell assembly instead — so the routes have nothing left to disagree about,
    and letting only `direct` return the new sheet would ship a different
    drawing down each route (`docs/adapter-swap-note.md`). The flag still picks
    the legacy fallback for configs the shells do not cover.
    """
    shells = shell_assembly(ctx.catalog, ctx.cfg)
    if shells is None:
        return None
    doc = ezdxf.new(dxfversion="R2010", setup=True)
    pin_document(doc)
    build_sheet(doc, shells, ctx)
    out_path = ctx.out_dir / f"{ctx.base_name}.dxf"
    doc.saveas(str(out_path))
    ctx.warnings.extend(f"dxf: {w}" for w in shells.warnings)
    return out_path


def build_sheet(doc, shells, ctx) -> None:
    """Draw the whole C-size sheet into `doc` (inches, model space)."""
    msp = doc.modelspace()
    # Inches, imperial — the pre-0.18 sheet declared METRES while drawing
    # millimetres, so any CAD honouring the header imported it 1000x oversize.
    doc.header["$INSUNITS"] = 1
    doc.header["$MEASUREMENT"] = 0
    for name, color in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    # Centre marks read as centrelines, not object lines. setup=True loads the
    # standard linetypes; a doc built without them just draws these continuous.
    if "CENTER" in doc.linetypes:
        doc.layers.get("WILL-CENTER").dxf.linetype = "CENTER"

    sheet_w, sheet_h = SHEET_C_IN
    occ = _Occupancy()

    # The title block sizes itself from its content, and the border needs to
    # know how tall it came out: a full-width block covers the bottom edge, so
    # the zone numbers along it would print inside the block's own cells.
    title_rows = _title_rows(ctx, shells)
    title_h = _title_block_height(title_rows, sheet_w)
    _draw_border(msp, sheet_w, sheet_h, occ, band_top=_MARGIN_IN + title_h)
    occ.add((_MARGIN_IN, _MARGIN_IN, sheet_w - _MARGIN_IN, _MARGIN_IN + title_h))

    # --- Line work: component outlines plus visible surface features ---
    # A pole feature's loops are drawn DELIBERATELY on its face-on elevation
    # (feature_line_work) — the raster pass loses a flush feature like the
    # hand hole at grazing angles — and that view then skips the same pieces
    # in the raster pass so fragments cannot double over the drafted loops.
    line_work = {}
    centre_boxes = {}
    for view in VIEWS:
        by_component = outlines_by_component(shells, view)
        outlines = [seg for segs in by_component.values() for seg in segs]
        loops: list = []
        claimed: frozenset[str] = frozenset()
        if view in ("front", "side"):
            loops, centre_boxes[view], claimed = feature_line_work(shells, view)
        features = simplify(visible_features(shells, view, skip=claimed) + loops)
        line_work[view] = (outlines, features, view_extents(outlines + features))

    features_on_pole = pole_features(shells, "front")

    scale, placed = _layout(line_work, features_on_pole, sheet_w, sheet_h, title_h)

    for view in (*_COLUMN_ORDER, "top"):
        x0, y0, w, _h = placed[view]
        outlines, features, ext = line_work[view]
        _draw_view(msp, outlines, features, ext, scale, x0, y0)
        for box in centre_boxes.get(view, ()):
            _draw_centre_marks(msp, box, ext, scale, x0, y0)
        if _VIEW_LABEL[view]:
            _draw_label(msp, occ, _VIEW_LABEL[view], x0, y0, w)

    _ensure_dimstyle(doc, scale)
    _dimension(
        msp,
        occ,
        line_work,
        placed,
        features_on_pole,
        scale,
        floor=_MARGIN_IN + title_h + 0.2,
        right_edge=sheet_w - _MARGIN_IN - 0.35,
    )
    _draw_base_detail(msp, doc, occ, shells, sheet_w, sheet_h, title_h)
    _draw_title_block(msp, title_rows, sheet_w, title_h, scale)


# ---------------------------------------------------------------------------
# Border and views
# ---------------------------------------------------------------------------


def _draw_border(msp, w: float, h: float, occ: _Occupancy, band_top: float = 0.0) -> None:
    m = _MARGIN_IN
    msp.add_lwpolyline(
        [(m, m), (w - m, m), (w - m, h - m), (m, h - m), (m, m)],
        dxfattribs={"layer": "WILL-BORDER"},
    )
    # Zone letters/numbers, as on the template (A-D up the side, 1-4 across).
    # A letter whose row falls inside the full-width title block would print
    # inside the block's own cells — the same reason the bottom-edge numbers
    # are dropped (zone A sat on the address row until 8/21).
    for i, letter in enumerate("ABCD"):
        y = m + (h - 2 * m) * (i + 0.5) / 4
        if y < band_top + 0.1:
            continue
        for x in (m + 0.16, w - m - 0.16):
            msp.add_text(
                letter, height=0.12, dxfattribs={"layer": "WILL-BORDER"}
            ).set_placement((x, y))
            occ.add((x - 0.12, y - 0.12, x + 0.12, y + 0.22))
    for i, num in enumerate("4321"):
        x = m + (w - 2 * m) * (i + 0.5) / 4
        edges = [h - m - 0.16] if band_top > m + 0.3 else [m + 0.16, h - m - 0.16]
        for y in edges:
            msp.add_text(
                num, height=0.12, dxfattribs={"layer": "WILL-BORDER"}
            ).set_placement((x, y))
            occ.add((x - 0.12, y - 0.12, x + 0.12, y + 0.22))


def _draw_view(msp, outlines, features, ext, scale: float, x0: float, y0: float) -> None:
    """Draw one view's line work at `scale`, its lower-left at (x0, y0)."""
    ox, oy = ext[0], ext[1]
    for layer, segs in (("WILL-OUTLINE", outlines), ("WILL-FEATURES", features)):
        for ax, ay, bx, by in segs:
            msp.add_line(
                (x0 + (ax - ox) / scale, y0 + (ay - oy) / scale),
                (x0 + (bx - ox) / scale, y0 + (by - oy) / scale),
                dxfattribs={"layer": layer},
            )


#: How far a centre mark runs past the feature it marks, in PAPER inches.
_CENTRE_EXT_IN = 0.08


def _draw_centre_marks(msp, box, ext, scale: float, vx0: float, vy0: float) -> None:
    """A drafting centre cross through one pole feature (reference sheet
    convention: the hand hole and festoon carry centrelines)."""
    _label, x0, y0, x1, y1 = box
    cx = vx0 + ((x0 + x1) / 2 - ext[0]) / scale
    cy = vy0 + ((y0 + y1) / 2 - ext[1]) / scale
    half_w = (x1 - x0) / 2 / scale + _CENTRE_EXT_IN
    half_h = (y1 - y0) / 2 / scale + _CENTRE_EXT_IN
    attribs = {"layer": "WILL-CENTER", "ltscale": 0.25}
    msp.add_line((cx - half_w, cy), (cx + half_w, cy), dxfattribs=attribs)
    msp.add_line((cx, cy - half_h), (cx, cy + half_h), dxfattribs=attribs)


def _draw_label(msp, occ: _Occupancy, label: str, x0: float, y0: float, w: float) -> None:
    height = 0.13
    cx = x0 + max(w, 1.2) / 2
    half = _text_w(label, height) / 2
    for step in range(8):
        y = y0 - 0.30 - step * 0.24
        rect = (cx - half, y - 0.08, cx + half, y + height + 0.04)
        if occ.free(rect):
            msp.add_text(
                label, height=height, dxfattribs={"layer": "WILL-TEXT"}
            ).set_placement((cx, y), align=TextEntityAlignment.MIDDLE_CENTER)
            occ.add(rect)
            return


def _layout(line_work, features_on_pole, sheet_w: float, sheet_h: float, title_h: float):
    """(scale, {view: (x0, y0, w, h)}) — the first standard scale that fits.

    Trying scales in order and keeping the first that fits replaces a heuristic
    that chose the scale from the tallest view alone and then hoped the columns
    and their dimension gutters fitted across the sheet.
    """
    area_x0 = _MARGIN_IN + 0.35
    area_x1 = sheet_w - _MARGIN_IN - 0.35
    area_y0 = _MARGIN_IN + title_h + 1.05  # labels and the width dimensions
    area_y1 = sheet_h - _MARGIN_IN - 0.45

    left_gutter = 1.25  # the overall-height dimension (label runs along the line)
    # One dimension gutter per elevation that carries feature callouts — a
    # callout dims beside the feature's FACE-ON view, so the side view can
    # need lanes too (the hand hole faces it).
    counts = {"front": 0, "side": 0}
    for row in features_on_pole:
        counts[row[4]] = counts.get(row[4], 0) + 1
    gutters = {v: (0.6 + 0.5 * n) if n else 0.0 for v, n in counts.items()}
    column_gap = 1.5

    for scale in _STD_SCALES:
        sizes = {
            view: ((ext[2] - ext[0]) / scale, (ext[3] - ext[1]) / scale)
            for view, (_o, _f, ext) in line_work.items()
        }
        if max(h for _w, h in sizes.values()) > area_y1 - area_y0:
            continue
        needed = left_gutter + sum(gutters.values()) + column_gap * len(_COLUMN_ORDER)
        needed += sum(max(sizes[v][0], 0.6) for v in _COLUMN_ORDER) + sizes["top"][0]
        if needed > area_x1 - area_x0:
            continue

        # Spread the slack evenly instead of crowding everything left: the
        # elevations are narrow and a C sheet is wide, so leftover width goes
        # into the gaps between columns.
        top_w, top_h = sizes["top"]
        slack = max(0.0, (area_x1 - area_x0) - needed)
        gap = column_gap + slack / (len(_COLUMN_ORDER) + 1)

        placed = {}
        cursor = area_x0 + left_gutter
        for view in _COLUMN_ORDER:
            w, h = sizes[view]
            placed[view] = (cursor, area_y0, w, h)
            cursor += max(w, 0.6) + gap
            cursor += gutters.get(view, 0.0)
        placed["top"] = (
            min(cursor, area_x1 - top_w),
            area_y1 - top_h - 0.55,
            top_w,
            top_h,
        )
        return scale, placed

    # Nothing fitted: draw at the coarsest scale rather than not at all.
    scale = _STD_SCALES[-1]
    placed = {}
    cursor = area_x0 + left_gutter
    for view in (*_COLUMN_ORDER, "top"):
        _o, _f, ext = line_work[view]
        w, h = (ext[2] - ext[0]) / scale, (ext[3] - ext[1]) / scale
        placed[view] = (cursor, area_y0, w, h)
        cursor += max(w, 0.6) + column_gap
    return scale, placed


# ---------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------


def _ensure_dimstyle(doc, scale: float, name: str = _DIMSTYLE) -> str:
    """The sheet's one dimension style.

    The views are drawn REDUCED 1:scale in model space, so DIMLFAC carries the
    scale: a CAD program multiplies the distance it measures on paper by it and
    recovers the true size. That is the ordinary convention for dimensioning a
    scaled model-space drawing — without it every dimension reads paper length.
    """
    style = doc.dimstyles.get(name) if name in doc.dimstyles else doc.dimstyles.new(name)
    style.dxf.dimlfac = float(scale)  # measured x DIMLFAC = true size
    style.dxf.dimtxt = 0.13  # text height, matching the view labels
    style.dxf.dimasz = 0.12  # arrow size
    style.dxf.dimexe = 0.06  # extension line past the dimension line
    style.dxf.dimexo = 0.05  # extension line offset from the geometry
    style.dxf.dimgap = 0.05
    style.dxf.dimtad = 1  # text above the dimension line
    style.dxf.dimscale = 1.0
    style.dxf.dimclrd = 7  # dimension line
    style.dxf.dimclre = 7  # extension lines
    style.dxf.dimclrt = 7  # text: black, like everything else on the sheet
    return name


def _dim_text(true_in: float, label: str = "") -> str:
    """Dimension text: the length, plus the feature's NAME when it has one.

    Tyler's pole reference drawing (8/21) names every feature callout inline —
    "15.0 ±1.0 HANDHOLE" — because a bare number beside a shaft with two
    features on it identifies neither.
    """
    text = fmt_length(true_in)
    return f"{text} {label}" if label else text


def _add_dim(
    msp, p1, p2, base, angle: float, true_in: float, scale: float,
    dimstyle: str = _DIMSTYLE, label: str = "", text_location=None,
):
    """One real DIMENSION entity, text in feet and inches at TRUE size.

    Pre-0.18 this sheet drew dimensions as plain TEXT plus witness lines, which
    LOOK right and measure nothing.

    `text_location` places the text explicitly — used when a labeled callout's
    text is LONGER than its dimension segment, where ezdxf's default centres
    it on the segment and the overflow lands on whatever sits past the
    extension lines (Tyler, 8/21: the hand-hole callout ran through the SIDE
    view's label and width dimension).
    """
    dim = msp.add_linear_dim(
        base=base,
        p1=p1,
        p2=p2,
        angle=angle,
        dimstyle=dimstyle,
        text=_dim_text(true_in, label),
        dxfattribs={"layer": "WILL-DIMS"},
    )
    if text_location is not None:
        dim.set_location(text_location, leader=False, relative=False)
    dim.render()
    ent = dim.dimension
    # ezdxf leaves code 42 unwritten. It holds the DRAWN distance — the number
    # DIMLFAC scales back up — so write paper length, not true size.
    ent.dxf.actual_measurement = true_in / scale
    return ent


def _dim_vertical(
    msp, occ, x_ref, y_bot, y_top, true_in, scale, side=-1, lanes=(0.8, 1.22, 1.64),
    limit=None, label="",
):
    """A height dimension beside a view, in the first clear lane.

    Lanes are BOUNDED and clamped inside the drawing area. An earlier version
    walked outward until it found space, which on a blocked side walked the
    dimension clean off the sheet and dragged its extension lines down through
    the title block.
    """
    text_len = _text_w(_dim_text(true_in, label), 0.13)
    mid = (y_bot + y_top) / 2
    # Text longer than its segment overflows the extension lines onto whatever
    # is past them, so it moves ABOVE the top extension line, running upward —
    # the reference sheet's own convention for short feature callouts.
    outside = text_len > (y_top - y_bot) - 0.24
    if outside:
        text_y0, text_y1 = y_top + 0.1, y_top + 0.1 + text_len
    else:
        text_y0, text_y1 = mid - text_len / 2, mid + text_len / 2
    location = lambda x: (x, (text_y0 + text_y1) / 2) if outside else None  # noqa: E731
    fallback = None
    for gap in lanes:
        x = x_ref + side * gap
        if limit is not None and ((side < 0 and x < limit) or (side > 0 and x > limit)):
            break
        rect = (x - 0.24, text_y0, x + 0.24, text_y1)
        if fallback is None:
            fallback = (x, rect)
        if occ.free(rect):
            occ.add(rect)
            return _add_dim(
                msp, (x_ref, y_bot), (x_ref, y_top), (x, y_bot), 90.0, true_in, scale,
                label=label, text_location=location(x),
            )
    if fallback is None:
        return None
    x, rect = fallback  # crowded, but on the sheet and measuring the right thing
    occ.add(rect)
    return _add_dim(
        msp, (x_ref, y_bot), (x_ref, y_top), (x, y_bot), 90.0, true_in, scale,
        label=label, text_location=location(x),
    )


def _dim_horizontal(
    msp, occ, x_left, x_right, y_ref, true_in, scale, lanes=(0.66, 0.99), floor=None
):
    """A width dimension under a view, in the first clear lane above `floor`."""
    half = _text_w(fmt_length(true_in), 0.13) / 2
    cx = (x_left + x_right) / 2
    fallback = None
    for gap in lanes:
        y = y_ref - gap
        if floor is not None and y < floor:
            break
        rect = (cx - half, y - 0.06, cx + half, y + 0.3)
        if fallback is None:
            fallback = (y, rect)
        if occ.free(rect):
            occ.add(rect)
            return _add_dim(
                msp, (x_left, y_ref), (x_right, y_ref), (x_left, y), 0.0, true_in, scale
            )
    if fallback is None:
        return None
    y, rect = fallback
    occ.add(rect)
    return _add_dim(
        msp, (x_left, y_ref), (x_right, y_ref), (x_left, y), 0.0, true_in, scale
    )


def _dimension(
    msp, occ, line_work, placed, features_on_pole, scale: float, floor: float, right_edge: float
) -> None:
    """Overall height, overall width, and each added pole feature's height.

    Feature heights are measured from the BOTTOM of the structure (Tyler 8/20)
    — the datum the shells are built on — so a callout is the number an
    installer reads off a tape from the base. Each feature's callout sits
    beside its FACE-ON elevation (Tyler's 8/21 reference), named inline, so
    the dimension points at a drawn feature rather than an edge-on sliver.
    """
    fx0, fy0, fw, fh = placed["front"]
    _fo, _ff, fext = line_work["front"]
    _dim_vertical(
        msp, occ, fx0, fy0, fy0 + fh, fext[3] - fext[1], scale, side=-1,
        label="OVERALL HEIGHT",
    )
    _dim_horizontal(
        msp, occ, fx0, fx0 + fw, fy0, fext[2] - fext[0], scale, floor=floor
    )

    lane_base = 0.6
    for view in ("front", "side"):
        rows = [row for row in features_on_pole if row[4] == view]
        if not rows:
            continue
        vx0, vy0, vw, _vh = placed[view]
        _vo, _vf, vext = line_work[view]
        datum = vext[1]
        for i, (label, y_centre, _y0, _y1, _face) in enumerate(rows):
            height_in = y_centre - datum
            start = lane_base + 0.5 * i
            _dim_vertical(
                msp,
                occ,
                vx0 + vw,
                vy0,
                vy0 + height_in / scale,
                height_in,
                scale,
                side=+1,
                lanes=(start, start + 0.42),
                limit=right_edge,
                label=label,
            )

    sx0, sy0, sw, _sh = placed["side"]
    _so, _sf, sext = line_work["side"]
    _dim_horizontal(
        msp, occ, sx0, sx0 + sw, sy0, sext[2] - sext[0], scale, floor=floor
    )

    tx0, ty0, tw, th = placed["top"]
    _to, _tf, text_ = line_work["top"]
    _dim_horizontal(msp, occ, tx0, tx0 + tw, ty0, text_[2] - text_[0], scale)
    _dim_vertical(msp, occ, tx0, ty0, ty0 + th, text_[3] - text_[1], scale, side=-1)


def _draw_base_detail(msp, doc, occ, shells, sheet_w: float, sheet_h: float, title_h: float) -> None:
    """The anchor base, drawn large in plan with its bolt circle called out.

    Tyler 8/20 — the pole should carry the detail its own spec sheet carries,
    and the sheet's pole pages give the anchor base a dedicated view. It has to
    be its own view: a decorative base cover wraps the base, so on the
    elevation the bolts are (correctly) hidden behind it.

    Drawn at its OWN scale, which needs its own dimension style — DIMLFAC is a
    per-style property, so a detail at 1:4 on a 1:30 sheet cannot share the
    sheet's.
    """
    names = [p.name for p in shells.pieces]
    if "Anchor Bolts" not in names and "Pole Base" not in names:
        return  # an embedded pole, or a custom base: nothing standard to detail

    detail = subassembly(shells, _BASE_DETAIL_PIECES)
    outlines = [seg for segs in outlines_by_component(detail, "top").values() for seg in segs]
    features = simplify(visible_features(detail, "top"))
    ext = view_extents(outlines + features)
    span = max(ext[2] - ext[0], ext[3] - ext[1])
    if span <= 0:
        return

    # Big enough to read, small enough to sit in the sheet's spare upper middle.
    budget = 2.6
    scale = next((n for n in _STD_SCALES if span / n <= budget), _STD_SCALES[-1])
    w, h = (ext[2] - ext[0]) / scale, (ext[3] - ext[1]) / scale

    x0 = _MARGIN_IN + 1.6
    y0 = sheet_h - _MARGIN_IN - h - 1.0
    for step in range(8):  # slide right until it is clear of the views
        rect = (x0 - 0.9, y0 - 0.9, x0 + w + 0.9, y0 + h + 0.5)
        if occ.free(rect):
            break
        x0 += 1.2
    occ.add((x0 - 0.9, y0 - 0.9, x0 + w + 0.9, y0 + h + 0.5))

    _draw_view(msp, outlines, features, ext, scale, x0, y0)
    _ensure_dimstyle(doc, scale, _DETAIL_DIMSTYLE)

    # The bolt circle, measured off the geometry rather than off the table: two
    # opposite bolt centres ARE the circle's diameter.
    centres = bolt_centres(detail, "top")
    if len(centres) >= 2:
        pairs = [
            (a, b)
            for i, a in enumerate(centres)
            for b in centres[i + 1 :]
            if abs(a[0] + b[0]) < 0.05 and abs(a[1] + b[1]) < 0.05
        ]
        if pairs:
            a, b = pairs[0]
            true_in = ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
            ax = x0 + (a[0] - ext[0]) / scale
            ay = y0 + (a[1] - ext[1]) / scale
            bx = x0 + (b[0] - ext[0]) / scale
            by = y0 + (b[1] - ext[1]) / scale
            dim = msp.add_linear_dim(
                base=(ax, y0 - 0.5),
                p1=(ax, ay),
                p2=(bx, by),
                angle=0.0,
                dimstyle=_DETAIL_DIMSTYLE,
                text=f"BOLT CIRCLE {fmt_length(true_in)}",
                dxfattribs={"layer": "WILL-DIMS"},
            )
            dim.render()
            dim.dimension.dxf.actual_measurement = true_in / scale

    label = f"{_BASE_DETAIL_LABEL} - SCALE 1:{scale}"
    height = 0.13
    msp.add_text(label, height=height, dxfattribs={"layer": "WILL-TEXT"}).set_placement(
        (x0 + max(w, 1.2) / 2, y0 + h + 0.22), align=TextEntityAlignment.MIDDLE_CENTER
    )
    occ.add(
        (
            x0 + max(w, 1.2) / 2 - _text_w(label, height) / 2,
            y0 + h + 0.12,
            x0 + max(w, 1.2) / 2 + _text_w(label, height) / 2,
            y0 + h + 0.4,
        )
    )


# ---------------------------------------------------------------------------
# Title block — fixed layout, content-driven size
# ---------------------------------------------------------------------------

_ADDRESS = "WISCONSIN LIGHTING LAB   |   206 W. McWilliams Street, Fond du Lac, WI 54935"
_SLOT_LABEL = {
    "fixture": "FIXTURE",
    "arm": "ARM",
    "pole": "POLE",
    "baseCover": "BASE COVER",
}


def _title_rows(ctx, shells) -> list[dict]:
    """The block's content in fixed order, as row descriptors.

    A row is {kind, cells}, a cell is (label, value, width share). Nothing here
    knows about sizes — that is `_row_metrics`' job, which is what lets one
    layout absorb a one-line title or a four-part one.
    """
    parts = ctx.summary.get("parts", []) or []
    title = " / ".join(p["name"] for p in parts) or "WiLL assembly"
    finishes = "   ".join(
        f"{_SLOT_LABEL.get(p['slot'], str(p['slot']).upper())}: {p.get('finish', '-')}"
        for p in parts
    ) or str(ctx.summary.get("finish", "-"))
    note = next(iter(shells.warnings), "")

    rows = [
        {
            "kind": "banner",
            "cells": [("", _ADDRESS, 0.62), ("", "CONCEPT DRAWING", 0.38)],
        },
        {"kind": "wrap", "cells": [("TITLE:", title, 1.0)], "max_lines": 3, "big": True},
        {
            "kind": "grid",
            "cells": [
                ("DWG. NO.:", str(ctx.cfg.configId), 0.34),
                ("REV:", str(ctx.cfg.rev), 0.10),
                ("SIZE:", "C", 0.10),
                ("SCALE:", "{scale}", 0.16),
                ("SHEET:", "1 OF 1", 0.15),
                ("WEIGHT:", "-", 0.15),
            ],
        },
        {"kind": "wrap", "cells": [("FINISH:", finishes, 1.0)], "max_lines": 2},
        {
            "kind": "wrap",
            "cells": [("", DISCLAIMER, 1.0)],
            "max_lines": 2,
            "small": True,
        },
    ]
    if note:
        rows.append(
            {
                "kind": "wrap",
                "cells": [("NOTE:", note, 1.0)],
                "max_lines": 2,
                "small": True,
            }
        )
    return rows


_PAD = 0.12


def _row_metrics(row: dict, width: float):
    """(row height, [(cell, text height, lines)]) for one row at `width`."""
    if row["kind"] == "banner":
        return 0.5, [
            (cell, 0.105 if i == 0 else 0.19, [cell[1]])
            for i, cell in enumerate(row["cells"])
        ]
    if row["kind"] == "grid":
        return 0.46, [(cell, 0.115, [cell[1]]) for cell in row["cells"]]

    label, value, _share = row["cells"][0]
    if row.get("big"):
        heights = (0.19, 0.165, 0.14, 0.12, 0.10)
    elif row.get("small"):
        heights = (0.10, 0.09, 0.08)
    else:
        heights = (0.125, 0.11, 0.095)
    label_w = _text_w(label, min(heights[0], 0.125)) + _PAD if label else 0.0
    text_h, lines = _fit(value, width - label_w - 2 * _PAD, row["max_lines"], heights)
    return max(0.32, len(lines) * (text_h + 0.08) + 0.16), [(row["cells"][0], text_h, lines)]


def _title_block_height(rows: list[dict], sheet_w: float) -> float:
    width = sheet_w - 2 * _MARGIN_IN
    return sum(_row_metrics(row, width)[0] for row in rows)


def _draw_title_block(msp, rows: list[dict], sheet_w: float, title_h: float, scale: int) -> None:
    """Draw the block top-down, one bordered row per descriptor."""
    layer = {"layer": "WILL-TITLE"}
    x0 = _MARGIN_IN
    x1 = sheet_w - _MARGIN_IN
    width = x1 - x0

    msp.add_lwpolyline(
        [
            (x0, _MARGIN_IN),
            (x1, _MARGIN_IN),
            (x1, _MARGIN_IN + title_h),
            (x0, _MARGIN_IN + title_h),
            (x0, _MARGIN_IN),
        ],
        dxfattribs=layer,
    )

    y_top = _MARGIN_IN + title_h
    for index, row in enumerate(rows):
        height, cells = _row_metrics(row, width)
        y_bot = y_top - height
        if index:  # a rule between rows, never a second outer border
            msp.add_line((x0, y_top), (x1, y_top), dxfattribs=layer)

        if row["kind"] == "grid":
            cursor = x0
            for (label, value, share), text_h, _lines in cells:
                if cursor > x0:
                    msp.add_line((cursor, y_bot), (cursor, y_top), dxfattribs=layer)
                text = value.format(scale=f"1:{scale}") if "{scale}" in value else value
                cell_w = width * share
                fitted, lines = _fit(text, cell_w - 2 * _PAD, 1, (text_h, 0.1, 0.085, 0.07))
                msp.add_text(label, height=0.095, dxfattribs=layer).set_placement(
                    (cursor + _PAD, y_top - 0.16)
                )
                msp.add_text(lines[0], height=fitted, dxfattribs=layer).set_placement(
                    (cursor + _PAD, y_bot + 0.1)
                )
                cursor += cell_w
        elif row["kind"] == "banner":
            (_l0, address, share0), h0, _ = cells[0]
            (_l1, banner, _s1), h1, _ = cells[1]
            split = x0 + width * share0
            msp.add_line((split, y_bot), (split, y_top), dxfattribs=layer)
            msp.add_text(address, height=h0, dxfattribs=layer).set_placement(
                (x0 + _PAD, y_bot + (height - h0) / 2)
            )
            msp.add_text(banner, height=h1, dxfattribs=layer).set_placement(
                (split + _PAD, y_bot + height - h1 - 0.1)
            )
            msp.add_text(
                "DETAILED APPROVAL DRAWING AT ORDER ENTRY",
                height=0.085,
                dxfattribs=layer,
            ).set_placement((split + _PAD, y_bot + 0.1))
        else:
            (label, _value, _share), text_h, lines = cells[0]
            label_h = min(text_h, 0.125)
            label_w = _text_w(label, label_h) + _PAD if label else 0.0
            if label:
                msp.add_text(label, height=label_h, dxfattribs=layer).set_placement(
                    (x0 + _PAD, y_top - label_h - 0.1)
                )
            y = y_top - text_h - 0.1
            for line in lines:
                msp.add_text(line, height=text_h, dxfattribs=layer).set_placement(
                    (x0 + _PAD + label_w, y)
                )
                y -= text_h + 0.08

        y_top = y_bot
