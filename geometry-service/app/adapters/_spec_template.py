"""WiLL spec-sheet / concept-card PDF template (fpdf2).

``render_spec(ctx, mode)`` is the single public entry point.  Mode only
changes the title text:

  mode='spec'          → "Configuration Card" (Phase 0.17: NOT a spec sheet —
                          high-level stack + links to each element's real spec)
  mode='concept-card'  → "Concept Card"

Brand colours
-------------
Gunmetal Gray  #42413D  (header band, text, table borders)
Yellow Light   #FFCF2E  (rule under header title)
Silver         #E6E7E8  (render placeholder box background)
White          #FFFFFF  (header title text, table backgrounds)

No blue anywhere (prohibited by brand guidelines).

Fonts
-----
Helvetica (fpdf2 core — a stand-in for Roboto until a TTF is embedded).
This is noted here and in geometry-service/README.md.

Determinism
-----------
fpdf2 injects the current timestamp into the PDF's /CreationDate metadata
by default.  We suppress this by pinning it to ``datetime(2000, 1, 1,
tzinfo=timezone.utc)`` via ``pdf.set_creation_date(…)``.  We also pin
``/Producer`` and ``/Creator`` to fixed strings so that two runs with
identical input always produce byte-identical output.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from typing import Literal

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.adapters.base import GenContext
from app.naming import DISCLAIMER

# ---------------------------------------------------------------------------
# Brand constants
# ---------------------------------------------------------------------------

_GUNMETAL = (0x42, 0x41, 0x3D)      # #42413D
_YELLOW = (0xFF, 0xCF, 0x2E)        # #FFCF2E
_SILVER = (0xE6, 0xE7, 0xE8)        # #E6E7E8
_WHITE = (0xFF, 0xFF, 0xFF)          # #FFFFFF
_LIGHT_GRAY = (0xF5, 0xF5, 0xF5)    # table row alternation
_PANEL = (0xF7, 0xF7, 0xF8)         # render panel background (Phase 0.17)
_HAIRLINE = (0xD2, 0xD4, 0xD6)      # rules/frames — lighter than gunmetal
_MUTED = (0x8A, 0x8D, 0x92)         # secondary text

# PDF page size (A4 landscape)
_PAGE_W = 297.0   # mm
_PAGE_H = 210.0   # mm

# Layout constants (all mm)
_MARGIN = 12.0
_HEADER_H = 22.0
_RULE_H = 2.5
_COL_SPLIT = 0.55  # left column fraction of usable width
_QUOTE_URL = "willbrands.com/pages/request-a-quote"
# Hero-card (design-library) constants — Phase 0.17.
_FIELD = (0xC9, 0xCA, 0xCC)   # the light grey drawing field their cards use
_PHONE = "(866) 308-9455"
_SITE = "WiLLBrands.com"

# Fixed epoch for deterministic /CreationDate
_FIXED_EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Unit conversion helpers
# ---------------------------------------------------------------------------

def _mm_to_ft_in(mm: float) -> str:
    """Convert millimetres to a ft-in string like \"20'-0\"\" or \"6'-2\"\"."""
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = round(total_inches % 12)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


# ---------------------------------------------------------------------------
# Latin-1 sanitiser — Helvetica core font cannot encode chars > U+00FF
# ---------------------------------------------------------------------------

# Transliteration table: common non-latin-1 chars → safe ASCII equivalents.
_LATIN1_MAP: dict[str, str] = {
    "—": "-",   # em dash        → hyphen
    "–": "-",   # en dash        → hyphen
    "‘": "'",   # left single quotation mark
    "’": "'",   # right single quotation mark
    "“": '"',   # left double quotation mark
    "”": '"',   # right double quotation mark
    "…": "...", # horizontal ellipsis
    "°": " deg",# degree sign
    # ® (0xAE) and © (0xA9) ARE latin-1 — they need no transliteration, and
    # "WILLSTUDIO(R)" on a customer-facing card reads as a defect (0.17).
}


def _latin1(text: str) -> str:
    """Transliterate known non-latin-1 chars; drop any remaining outliers.

    Helvetica (fpdf2 built-in core font) only supports latin-1 (U+0000–U+00FF).
    Common Unicode punctuation is mapped to ASCII equivalents; anything else
    is dropped.  This is the documented approach until a TTF Roboto embed
    is added (Phase 1 improvement noted in README and spec_template module
    docstring).
    """
    for src, dst in _LATIN1_MAP.items():
        text = text.replace(src, dst)
    # Final safety net: encode to latin-1, replacing any remaining outliers
    return text.encode("latin-1", errors="replace").decode("latin-1")


# ---------------------------------------------------------------------------
# Display names (Phase 0.17, Tyler 8/19 concept-card review)
# ---------------------------------------------------------------------------

_BRAND_PREFIX = re.compile(r"^(WiLLstudio|WiLLsport|WiLLev|WiLLcloud|NAFCO)[\u00ae\u2122()R]*\s+", re.IGNORECASE)


def _display_name(part: dict) -> str:
    """The builder's display cleanup, mirrored for the PDFs' component tables:
    strip the redundant brand prefix, and for arms the leading model code
    ("WiLLstudio(R) HSX Decorative Upsweep Arms" → "Decorative Upsweep Arms").
    Data records (summary.txt, config.json) keep the official full names."""
    name = _BRAND_PREFIX.sub("", str(part.get("name", "")))
    if part.get("slot") == "arm":
        first, _, rest = name.partition(" ")
        if rest and re.fullmatch(r"[A-Z]{2,3}\d*X?\d*", first):
            name = rest
    return name


# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

def _set_fill(pdf: FPDF, rgb: tuple[int, int, int]) -> None:
    pdf.set_fill_color(*rgb)


def _set_draw(pdf: FPDF, rgb: tuple[int, int, int]) -> None:
    pdf.set_draw_color(*rgb)


def _set_text(pdf: FPDF, rgb: tuple[int, int, int]) -> None:
    pdf.set_text_color(*rgb)


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _draw_header(pdf: FPDF, title: str) -> None:
    """Draw gunmetal header band with white title + yellow rule."""
    # Gunmetal band
    _set_fill(pdf, _GUNMETAL)
    _set_draw(pdf, _GUNMETAL)
    pdf.set_xy(0, 0)
    pdf.rect(0, 0, _PAGE_W, _HEADER_H, style="F")

    # White title
    _set_text(pdf, _WHITE)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_xy(_MARGIN, 4)
    pdf.cell(120, 8, "WiLL Lighting Systems", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "", 13)
    pdf.set_xy(_MARGIN + 120, 4)
    pdf.cell(0, 8, f"| {title}", new_x=XPos.RIGHT, new_y=YPos.TOP)

    # Yellow rule below band
    _set_fill(pdf, _YELLOW)
    pdf.rect(0, _HEADER_H, _PAGE_W, _RULE_H, style="F")

    # Reset colours
    _set_text(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)
    _set_draw(pdf, _GUNMETAL)


def _draw_placeholder_box(
    pdf: FPDF,
    left: float,
    top: float,
    width: float,
    height: float,
) -> None:
    """Draw silver placeholder box with 'Render not supplied' text."""
    _set_fill(pdf, _SILVER)
    _set_draw(pdf, _GUNMETAL)
    pdf.rect(left, top, width, height, style="FD")
    _set_text(pdf, _GUNMETAL)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_xy(left, top + height / 2 - 4)
    pdf.cell(width, 8, "Render not supplied", align="C")
    _set_text(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)


def _draw_render_column(
    pdf: FPDF,
    render_png: bytes | None,
    left: float,
    top: float,
    width: float,
    height: float,
) -> None:
    """Draw the render inside a framed panel, ASPECT-PRESERVED (Phase 0.17).

    Tyler 8/19: the old embed forced both w and h, stretching the 16:9
    snapshot to whatever box the layout had. `keep_aspect_ratio=True` fits
    the image inside the box and centres it; the light panel behind makes
    the letterboxing read as a deliberate frame rather than dead space.
    """
    _set_fill(pdf, _PANEL)
    _set_draw(pdf, _HAIRLINE)
    pdf.rect(left, top, width, height, style="FD")
    if render_png is not None:
        try:
            buf = io.BytesIO(render_png)
            inset = 2.0
            pdf.image(
                buf,
                x=left + inset,
                y=top + inset,
                w=width - 2 * inset,
                h=height - 2 * inset,
                keep_aspect_ratio=True,
            )
        except Exception:
            # On corrupt image, fall back to placeholder
            _draw_placeholder_box(pdf, left, top, width, height)
    else:
        # No image provided — draw placeholder
        _draw_placeholder_box(pdf, left, top, width, height)
    _set_draw(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)


def _draw_section_heading(pdf: FPDF, label: str, left: float, top: float, width: float) -> float:
    """Uniform section heading: yellow accent tick + bold label + hairline rule.

    Phase 0.17 formatting pass — every block (Components, Dimensions, Finish)
    opens with this, so the sheet reads as one system instead of ad-hoc bold
    lines at drifting sizes. Returns the Y where content should start.
    """
    _set_fill(pdf, _YELLOW)
    pdf.rect(left, top + 1.1, 6.0, 2.6, style="F")
    _set_text(pdf, _GUNMETAL)
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_xy(left + 8.5, top)
    pdf.cell(width - 8.5, 5.0, _latin1(label), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    _set_draw(pdf, _HAIRLINE)
    pdf.line(left, top + 5.6, left + width, top + 5.6)
    _set_draw(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)
    return top + 7.4


def _draw_components_table(
    pdf: FPDF,
    parts: list[dict],
    left: float,
    top: float,
    width: float,
) -> float:
    """Draw component table; return Y position after the table.

    Phase 0.11 (Workstream Z1): the WiLL part number is the configurator's
    primary output, so it is a first-class column here — right after the slot,
    ahead of the product name, and set bold because it is the string a designer
    copies into a project spec.  A component with no published ordering matrix
    prints '-' rather than a fabricated code (docs/part-numbers.md).
    """
    # Phase 0.17 (Tyler 8/19, formatting pass): the URL column is gone — full
    # product URLs crammed into 24% of the table were the single worst
    # offender ("all over the place"); the spec layout lists product pages in
    # their own wrapped block instead. Three columns, horizontal rules only.
    top = _draw_section_heading(pdf, "Components", left, top, width)
    col_w = [width * 0.16, width * 0.34, width * 0.50]
    row_h = 6.2

    _set_text(pdf, _MUTED)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_xy(left, top)
    for i, label in enumerate(["SLOT", "PART NUMBER", "PRODUCT"]):
        pdf.cell(col_w[i], 4.6, label, new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.ln()

    # Data rows
    _set_text(pdf, _GUNMETAL)
    _set_draw(pdf, _HAIRLINE)
    slot_labels = {
        "fixture": "Fixture",
        "arm": "Arm",
        "pole": "Pole",
        "baseCover": "Base Cover",
    }
    for part in parts:
        slot_label = slot_labels.get(part["slot"], part["slot"].title())
        number = part.get("partNumber") or "-"
        pdf.set_xy(left, pdf.get_y())
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_w[0], row_h, _latin1(slot_label), border="B", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.cell(col_w[1], row_h, _latin1(number), border="B", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_w[2], row_h, _latin1(part["name"]), border="B", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.ln()

    _set_draw(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)
    y = pdf.get_y() + 1.0

    # Flag any number still carrying an unanswered ordering column, so an
    # incomplete spec is obvious rather than looking orderable.
    incomplete = [
        p for p in parts if p.get("partNumber") and not p.get("partNumberComplete")
    ]
    if incomplete:
        pdf.set_xy(left, y)
        pdf.set_font("Helvetica", "I", 7)
        pdf.cell(
            width,
            4.5,
            _latin1("'_' in a part number marks an ordering column still to be specified."),
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        y = pdf.get_y()
    return y


def _draw_product_pages(
    pdf: FPDF,
    parts: list[dict],
    left: float,
    top: float,
    width: float,
) -> float:
    """Each element's REAL spec lives on its product page — this block is the
    configuration card's whole point (Tyler 8/19): a shortcut to the full
    specifications, one wrapped line per component.
    """
    rows = [p for p in parts if p.get("productUrl")]
    if not rows:
        return top
    top = _draw_section_heading(pdf, "Full Specifications", left, top, width)
    _set_text(pdf, _MUTED)
    pdf.set_font("Helvetica", "", 6.8)
    y = top
    for part in rows:
        pdf.set_xy(left, y)
        pdf.multi_cell(width, 3.6, _latin1(f"{part['name']}  -  {part['productUrl']}"))
        y = pdf.get_y()
    _set_text(pdf, _GUNMETAL)
    return y + 1.0


def _draw_labeled_line(
    pdf: FPDF,
    label: str,
    value: str,
    left: float,
    top: float,
    width: float,
) -> float:
    """Draw one 'label: value' row (bold label + regular value); return Y after."""
    pdf.set_xy(left, top)
    pdf.set_font("Helvetica", "B", 8)
    _set_text(pdf, _GUNMETAL)
    pdf.cell(28.0, 5.5, _latin1(label), new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(width - 28.0, 5.5, _latin1(value), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln()
    return pdf.get_y()


def _draw_arm_arrangement(
    pdf: FPDF,
    summary: dict,
    left: float,
    top: float,
    width: float,
) -> float:
    """Draw 'Arm arrangement' and/or 'Banner arm' rows when present; else no-op.

    Returns the Y after the last line drawn (== ``top`` when nothing is drawn,
    so single-arm, no-banner layouts are byte-identical to pre-0.8 output).
    """
    y = top
    arrangement = summary.get("arm_arrangement")
    if arrangement:
        y = _draw_labeled_line(pdf, "Arm arrangement:", str(arrangement), left, y, width)
    banner = summary.get("banner")
    if banner:
        y = _draw_labeled_line(pdf, "Banner arm:", str(banner), left, y, width)
    return y


def _draw_dims_block(
    pdf: FPDF,
    dims: dict,
    left: float,
    top: float,
    width: float,
) -> float:
    """Draw dimensions block; return Y after block."""
    y = _draw_section_heading(pdf, "Dimensions", left, top, width)
    pdf.set_xy(left, y)

    dim_rows = [
        ("Overall Height", "overall_height_mm"),
        ("Pole Height", "pole_height_mm"),
        ("Mounting Height", "mounting_height_mm"),
        ("Arm Reach", "arm_reach_mm"),
        ("Base Diameter", "base_diameter_mm"),
    ]

    # Phase 0.17 (Tyler 8/19): imperial only — metric is never used with
    # these products and customers, so the mm column is gone.
    pdf.set_font("Helvetica", "", 8.5)
    _set_draw(pdf, _HAIRLINE)
    col_label = width * 0.62
    col_ftin = width * 0.38

    for label, key in dim_rows:
        val_mm = dims.get(key)
        if val_mm is None:
            continue
        val_ftin = _mm_to_ft_in(val_mm)
        pdf.set_x(left)
        pdf.cell(col_label, 5.8, label, border="B", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(col_ftin, 5.8, val_ftin, border="B", align="R", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.ln()

    _set_draw(pdf, _GUNMETAL)
    return pdf.get_y()


def _draw_finish_block(
    pdf: FPDF,
    summary: dict,
    catalog: dict,
    left: float,
    top: float,
    width: float,
) -> float:
    """Draw finish block; return Y after block."""
    y = _draw_section_heading(pdf, "Finish", left, top, width)
    pdf.set_xy(left, y)

    finish_name = _latin1(summary.get("finish", "-"))
    # RAL from summary (pre-populated by the adapter from catalog)
    finish_ral = summary.get("finish_ral", "")
    finishes_provisional = catalog.get("finishesProvisional", False)

    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_x(left)
    ral_text = f"  ({finish_ral})" if finish_ral else ""
    pdf.cell(width, 5.5, _latin1(f"{finish_name}{ral_text}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln()

    # Phase 0.11 (Workstream A): when the components are NOT all one colour, a
    # single assembly-wide finish line is actively misleading — break it out per
    # component.  An all-one-finish assembly is byte-identical to before.
    if summary.get("per_slot_finish"):
        slot_labels = {
            "fixture": "Fixture",
            "arm": "Arm",
            "pole": "Pole",
            "baseCover": "Base Cover",
        }
        for part in summary.get("parts", []):
            pdf.set_x(left)
            label = slot_labels.get(part["slot"], part["slot"].title())
            pdf.cell(
                width,
                4.8,
                _latin1(f"  {label}: {part.get('finish', '-')}"),
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
        pdf.ln()
    if finishes_provisional:
        pdf.set_x(left)
        pdf.set_font("Helvetica", "I", 7)
        pdf.cell(width, 4.5, "Note: provisional palette - WiLLcoat colour unconfirmed", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln()
    return pdf.get_y()


def _draw_footer(pdf: FPDF, cfg, top: float) -> None:
    """Draw footer band with disclaimer + config ID + quote URL."""
    footer_h = _PAGE_H - top - 2
    _set_fill(pdf, _SILVER)
    pdf.rect(0, top, _PAGE_W, footer_h + 2, style="F")
    # Yellow hairline caps the band — same accent language as the header rule.
    _set_fill(pdf, _YELLOW)
    pdf.rect(0, top, _PAGE_W, 0.8, style="F")

    pdf.set_xy(_MARGIN, top + 2.6)
    _set_text(pdf, _GUNMETAL)
    pdf.set_font("Helvetica", "I", 6.5)
    pdf.multi_cell(_PAGE_W - 2 * _MARGIN, 3.6, DISCLAIMER)

    pdf.set_x(_MARGIN)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(
        _PAGE_W - 2 * _MARGIN,
        4.2,
        f"Config: {cfg.configId}  |  Rev: {cfg.rev}  |  Request a quote: {_QUOTE_URL}",
    )


# ---------------------------------------------------------------------------
# Hero-card section helpers
# ---------------------------------------------------------------------------

def _draw_status_chip(
    pdf: FPDF,
    status: str,
    left: float,
    top: float,
) -> None:
    """Draw a gunmetal pill with status text.

    'Standard'     → yellow text
    'Configurable' → silver text

    fpdf2 2.8.x has no public rounded_rect; we use rect with FD style to
    approximate a pill.  The visual appearance is a tight rectangle; rounding
    is a Phase 1 cosmetic improvement.
    """
    chip_w = 36.0
    chip_h = 7.0

    _set_fill(pdf, _GUNMETAL)
    _set_draw(pdf, _GUNMETAL)
    pdf.rect(left, top, chip_w, chip_h, style="F")

    text_color = _YELLOW if status == "Standard" else _SILVER
    _set_text(pdf, text_color)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_xy(left, top + 0.5)
    pdf.cell(chip_w, chip_h - 1, _latin1(status), align="C")

    # Reset colours
    _set_text(pdf, _GUNMETAL)
    _set_fill(pdf, _WHITE)
    _set_draw(pdf, _GUNMETAL)


def _catalog_part(catalog: dict, part_id: str | None) -> dict:
    if not part_id:
        return {}
    return next((p for p in catalog.get("parts", []) if p.get("id") == part_id), {})


def _slot_callout_label(catalog: dict, part: dict) -> str:
    """The all-caps product label the hero card puts on a leader line —
    WiLL's own design-library cards read "GVX PENDANT LIGHT", "DECORATIVE ARM
    MOUNT", "CL3 BASE COVER": the product, not its part number."""
    name = _display_name(part)
    slot = part.get("slot")
    if slot == "fixture":
        return f"{name} LIGHT".upper() if "light" not in name.lower() else name.upper()
    if slot == "arm":
        return f"{name} MOUNT".upper() if "mount" not in name.lower() else name.upper()
    cat_part = _catalog_part(catalog, part.get("id")) or part
    if slot == "pole":
        ft = cat_part.get("heightFt")
        return f"{int(ft)} FT DECORATIVE POLE" if ft else name.upper()
    if slot == "baseCover":
        design = None
        for opt in cat_part.get("options") or []:
            if opt.get("key") == "design" and len(opt.get("values") or []) == 1:
                design = opt["values"][0]["code"]
        return f"{design} BASE COVER" if design else name.upper()
    return name.upper()


def _trim_png(data: bytes):
    """Alpha/background-trim a snapshot; returns (PIL image, crop fractions).

    Tyler 8/19: a 16:9 snapshot of a tall pole is mostly empty field, so the
    hero card trims to the product before fitting. Pillow is already a
    service dependency; the import stays inside the adapter layer.
    """
    from PIL import Image  # noqa: PLC0415 — adapter-local engine import

    img = Image.open(io.BytesIO(data)).convert("RGBA")
    w, h = img.size
    bg = img.getpixel((0, 0))
    mask = Image.new("L", img.size, 0)
    px, mpx = img.load(), mask.load()
    for y in range(0, h, 2):  # sample every other pixel: 4x faster, same box
        for x in range(0, w, 2):
            p = px[x, y]
            if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 26 or p[3] < 200:
                mpx[x, y] = 255
    bbox = mask.getbbox()
    if not bbox:
        return img, (0.0, 0.0, 1.0, 1.0)
    pad = 10
    bbox = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(w, bbox[2] + pad),
        min(h, bbox[3] + pad),
    )
    return img.crop(bbox), (bbox[0] / w, bbox[1] / h, bbox[2] / w, bbox[3] / h)


def _fit_box(box, aspect):
    """The rect an aspect-preserved image actually occupies inside `box`."""
    left, top, width, height = box
    if not aspect or aspect <= 0:
        return box
    if aspect > width / height:
        dw, dh = width, width / aspect
    else:
        dw, dh = height * aspect, height
    return (left + (width - dw) / 2, top + (height - dh) / 2, dw, dh)


def _hero_render(pdf: FPDF, ctx: GenContext, full_box, detail_box) -> None:
    """Two views, like WiLL's design-library cards: the whole assembly small
    at the left, and a LARGE detail crop as the subject.

    A tall pole cannot fill a landscape page — their cards solve it exactly
    this way. The detail crop is centred on the fixture+arm anchors when the
    viewer supplied them (accurate by construction), else the top third.
    Records the drawn rects in ctx.summary so callouts can anchor into either.
    """
    if ctx.render_png is None:
        _draw_placeholder_box(pdf, *detail_box)
        return
    try:
        img, crop = _trim_png(ctx.render_png)
    except Exception:
        try:
            pdf.image(io.BytesIO(ctx.render_png), x=detail_box[0], y=detail_box[1],
                      w=detail_box[2], h=detail_box[3], keep_aspect_ratio=True)
        except Exception:
            _draw_placeholder_box(pdf, *detail_box)
        return

    # --- full assembly, small (left) ---
    def _emit(image, box):
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        rect = _fit_box(box, image.width / image.height)
        pdf.image(io.BytesIO(buf.getvalue()), x=rect[0], y=rect[1], w=rect[2], h=rect[3])
        return rect

    ctx.summary["_hero_full_rect"] = _emit(img, full_box)
    ctx.summary["_hero_full_crop"] = crop

    # --- detail crop, large (right) ---
    anchors = ctx.render_anchors or {}
    iw, ih = img.size
    cx0, cy0, cx1, cy1 = crop
    span_x = (cx1 - cx0) or 1.0
    span_y = (cy1 - cy0) or 1.0

    def _to_img(frac_xy):
        # snapshot fraction → pixel inside the TRIMMED image
        fx = (frac_xy[0] - cx0) / span_x
        fy = (frac_xy[1] - cy0) / span_y
        return fx * iw, fy * ih

    ys = [
        _to_img(anchors[s])[1]
        for s in ("fixture", "arm")
        if isinstance(anchors.get(s), (list, tuple)) and len(anchors[s]) >= 2
    ]
    if ys:
        centre_y = sum(ys) / len(ys)
    else:
        centre_y = ih * 0.16
    # Detail window: match the target box's aspect so nothing letterboxes.
    target_ar = detail_box[2] / detail_box[3]
    win_h = min(ih, max(ih * 0.30, 260.0))
    win_w = min(iw * 1.0, win_h * target_ar)
    if win_w > iw:
        win_w = iw
        win_h = win_w / target_ar
    top = max(0.0, min(ih - win_h, centre_y - win_h * 0.45))
    # Keep the product horizontally centred in the window.
    left = max(0.0, min(iw - win_w, iw / 2 - win_w / 2))
    detail = img.crop((int(left), int(top), int(left + win_w), int(top + win_h)))
    ctx.summary["_hero_detail_rect"] = _emit(detail, detail_box)
    ctx.summary["_hero_detail_window"] = (
        left / iw,
        top / ih,
        (left + win_w) / iw,
        (top + win_h) / ih,
    )


def _hero_anchor(ctx: GenContext, slot: str, view: str):
    """Map a slot's normalized snapshot anchor into page mm inside a DRAWN
    view ('detail' or 'full'). Returns None when the viewer sent no anchors
    (→ plain legend, no leaders) or the point lies outside that view."""
    a = (ctx.render_anchors or {}).get(slot)
    if not a or len(a) < 2:
        return None
    crop = ctx.summary.get("_hero_full_crop")
    if not crop:
        return None
    cx0, cy0, cx1, cy1 = crop
    span_x = (cx1 - cx0) or 1.0
    span_y = (cy1 - cy0) or 1.0
    fx = (float(a[0]) - cx0) / span_x
    fy = (float(a[1]) - cy0) / span_y
    if view == "detail":
        win = ctx.summary.get("_hero_detail_window")
        rect = ctx.summary.get("_hero_detail_rect")
        if not win or not rect:
            return None
        wx0, wy0, wx1, wy1 = win
        if not (wx0 <= fx <= wx1 and wy0 <= fy <= wy1):
            return None
        fx = (fx - wx0) / ((wx1 - wx0) or 1.0)
        fy = (fy - wy0) / ((wy1 - wy0) or 1.0)
    else:
        rect = ctx.summary.get("_hero_full_rect")
        if not rect:
            return None
    left, top, width, height = rect
    return left + fx * width, top + fy * height


def _draw_hero_callout(
    pdf: FPDF,
    label: str,
    anchor: tuple[float, float],
    label_x: float,
    label_y: float,
    align_right: bool,
) -> None:
    """Leader line + dot + all-caps label, WiLL design-library style."""
    ax, ay = anchor
    _set_draw(pdf, _WHITE)
    pdf.set_line_width(0.4)
    # elbow: horizontal from the label, then a short diagonal to the dot
    elbow_x = label_x + (14.0 if align_right else -14.0)
    pdf.line(label_x, label_y, elbow_x, label_y)
    pdf.line(elbow_x, label_y, ax, ay)
    _set_fill(pdf, _WHITE)
    pdf.ellipse(ax - 1.1, ay - 1.1, 2.2, 2.2, style="F")
    _set_text(pdf, _WHITE)
    pdf.set_font("Helvetica", "", 8.5)
    tw = pdf.get_string_width(label)
    tx = label_x - tw - 2.0 if align_right else label_x + 2.0
    pdf.set_xy(tx, label_y - 2.4)
    pdf.cell(tw, 4.8, _latin1(label))
    pdf.set_line_width(0.2)


def _draw_share_qr(pdf: FPDF, url: str, x: float, y: float, size: float) -> bool:
    """Draw a QR of the build's share link (Phase 0.17, Tyler 8/20).

    A client scanning it opens the EXACT configurator state — the most useful
    thing this page can carry. segno is a pure-python encoder (no native deps,
    safe for the deployed container); a failure degrades to the printed URL
    alone rather than breaking the document.
    """
    try:
        import segno  # noqa: PLC0415 — adapter-local engine import

        qr = segno.make(url, error="m")
        matrix = [[bool(c) for c in row] for row in qr.matrix]
    except Exception:
        return False
    n = len(matrix)
    if n == 0:
        return False
    # Quiet zone: white card behind, then modules in gunmetal.
    _set_fill(pdf, _WHITE)
    pdf.rect(x, y, size, size, style="F")
    quiet = 2
    module = size / (n + quiet * 2)
    _set_fill(pdf, _GUNMETAL)
    for r, row in enumerate(matrix):
        c0 = None
        for c in range(n + 1):
            on = c < n and row[c]
            if on and c0 is None:
                c0 = c
            elif not on and c0 is not None:
                # one rect per run of modules — far fewer PDF ops than per cell
                pdf.rect(
                    x + (quiet + c0) * module,
                    y + (quiet + r) * module,
                    (c - c0) * module,
                    module,
                    style="F",
                )
                c0 = None
    return True


def _render_hero_layout(pdf: FPDF, ctx: GenContext) -> None:
    """The WiLL CONCEPT DRAWING hero card (Phase 0.17, Tyler 8/19).

    Modeled on WiLL's own design-library concept drawings: a full-bleed field
    with the product as the subject, the assembly named across the top,
    leader-line callouts naming each element, and a contact + CONCEPT DRAWING
    footer. Deliberately NO part numbers and NO dimension table — that is the
    Configuration Card's job; this page sells the look and identifies the
    build. Config id + disclaimer still ride the footer so the page is
    traceable.
    """
    # --- Full-bleed field ---
    _set_fill(pdf, _FIELD)
    pdf.rect(0, 0, _PAGE_W, _PAGE_H, style="F")
    # Gunmetal top band + bottom band frame the drawing like their cards do.
    band_h = 20.0
    foot_h = 24.0
    _set_fill(pdf, _GUNMETAL)
    pdf.rect(0, 0, _PAGE_W, band_h, style="F")
    pdf.rect(0, _PAGE_H - foot_h, _PAGE_W, foot_h, style="F")
    _set_fill(pdf, _YELLOW)
    pdf.rect(0, band_h, _PAGE_W, 1.6, style="F")
    pdf.rect(0, _PAGE_H - foot_h - 1.6, _PAGE_W, 1.6, style="F")

    # --- Title: the assembly, in their voice ---
    line = ctx.catalog.get("lineLabel") or "WiLLstudio(R)"
    _set_text(pdf, _WHITE)
    pdf.set_font("Helvetica", "B", 19)
    title = f"{line} ARCHITECTURAL ASSEMBLY".upper()
    pdf.set_xy(_MARGIN, 4.4)
    pdf.cell(_PAGE_W - 2 * _MARGIN, 11, _latin1(title))

    # --- The product: the whole point of the page ---
    parts = [p for p in ctx.summary.get("parts", []) if p.get("name")]
    content_top = band_h + 7.0
    content_h = _PAGE_H - foot_h - content_top - 6.0
    # Their layout: a narrow full-assembly column at the left, the detail view
    # taking the rest of the page as the subject.
    full_box = (_MARGIN, content_top, 46.0, content_h)
    detail_box = (_MARGIN + 56.0, content_top, _PAGE_W - _MARGIN - (_MARGIN + 56.0), content_h)
    _hero_render(pdf, ctx, full_box, detail_box)

    # --- Callouts: name each element on a leader line ---
    slot_order = ["fixture", "arm", "pole", "baseCover"]
    by_slot = {p["slot"]: p for p in parts if p.get("slot")}
    legend = 0
    used_y: list[float] = []
    for slot in slot_order:
        part = by_slot.get(slot)
        if not part:
            continue
        label = _slot_callout_label(ctx.catalog, part)
        # Prefer the big detail view; fall back to the full silhouette for
        # anything outside the detail window (the base cover, typically).
        anchor = _hero_anchor(ctx, slot, "detail")
        in_detail = anchor is not None
        if anchor is None:
            anchor = _hero_anchor(ctx, slot, "full")
        if anchor is None:
            _set_text(pdf, _GUNMETAL)
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_xy(detail_box[0] + 2, detail_box[1] + 4 + legend * 5.4)
            pdf.cell(90, 4.8, _latin1(f"- {label}"))
            legend += 1
            continue
        if in_detail:
            label_x = detail_box[0] + 30.0
            align_right = False
        else:
            # Full-silhouette callouts label to the RIGHT of the small view,
            # in the gap before the detail view starts.
            label_x = full_box[0] + full_box[2] + 6.0
            align_right = False
        label_y = min(max(anchor[1], content_top + 6.0), content_top + content_h - 6.0)
        # Never stack two labels on the same line.
        while any(abs(label_y - y) < 7.0 for y in used_y):
            label_y += 7.5
        used_y.append(label_y)
        _draw_hero_callout(pdf, label, anchor, label_x, label_y, align_right=align_right)

    # --- Footer: contact, brand, CONCEPT DRAWING, traceability ---
    fy = _PAGE_H - foot_h
    _set_text(pdf, _WHITE)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_xy(_MARGIN, fy + 3.0)
    pdf.cell(150, 5, _latin1(f"Contact Us: {_PHONE} / {_SITE}"))
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_xy(_PAGE_W - _MARGIN - 96, fy + 3.0)
    pdf.cell(96, 5.6, "CONCEPT DRAWING", align="R")
    _set_text(pdf, _SILVER)
    pdf.set_font("Helvetica", "", 6.6)
    pdf.set_xy(_PAGE_W - _MARGIN - 96, fy + 9.2)
    pdf.cell(96, 3.6, "DETAILED APPROVAL DRAWING AT ORDER ENTRY", align="R")
    pdf.set_xy(_MARGIN, fy + 9.0)
    pdf.set_font("Helvetica", "I", 6.4)
    pdf.multi_cell(150, 3.4, _latin1(DISCLAIMER))
    pdf.set_xy(_MARGIN, fy + 16.4)
    pdf.set_font("Helvetica", "", 6.6)
    finish = ctx.summary.get("finish", "")
    ral = ctx.summary.get("finish_ral", "")
    finish_txt = f"{finish} ({ral})" if ral else finish
    pdf.cell(
        180,
        3.6,
        _latin1(f"Finish: {finish_txt}  |  Config: {ctx.cfg.configId}  |  Rev: {ctx.cfg.rev}"),
    )

    # --- Share: QR + link, so the client can open this exact build ---
    share = (ctx.share_url or "").strip()
    if share:
        qr_size = foot_h - 7.0
        qr_x = _PAGE_W / 2 - qr_size / 2 - 34.0
        qr_y = fy + 3.5
        drawn = _draw_share_qr(pdf, share, qr_x, qr_y, qr_size)
        _set_text(pdf, _WHITE)
        pdf.set_font("Helvetica", "B", 7)
        tx = qr_x + (qr_size + 3.0 if drawn else 0.0)
        pdf.set_xy(tx, qr_y + 2.0)
        pdf.cell(64, 4.0, "SCAN TO OPEN THIS BUILD" if drawn else "OPEN THIS BUILD")
        _set_text(pdf, _SILVER)
        pdf.set_font("Helvetica", "", 5.8)
        pdf.set_xy(tx, qr_y + 6.2)
        shown = share.replace("https://", "").replace("http://", "")
        if len(shown) > 58:
            shown = shown[:57] + "\u2026"
        pdf.cell(64, 3.4, _latin1(shown))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def render_spec(
    ctx: GenContext,
    mode: Literal["spec", "concept-card"] = "spec",
) -> bytes:
    """Render one-page WiLL PDF spec-sheet or concept card.

    Parameters
    ----------
    ctx:
        Generation context (catalog, cfg, render_png, summary, …).
    mode:
        'spec'         → title "Specification Sheet" (two-column layout, unchanged)
        'concept-card' → title "Concept Card" (hero render top band + info below)

    Returns
    -------
    bytes
        Raw PDF bytes (byte-identical across runs with identical input).

    Determinism note
    ----------------
    fpdf2 injects the current timestamp as /CreationDate by default.
    We pin it to ``datetime(2000, 1, 1, tzinfo=timezone.utc)`` and also
    pin /Producer and /Creator so two runs always produce byte-identical
    output.
    """
    # Phase 0.17 (Tyler 8/19): NOT a spec sheet — it doesn't carry what a
    # submittal spec must. It is the CONFIGURATION CARD: the high-level stack,
    # part numbers, and shortcuts to each element's real spec (product pages).
    title = "Configuration Card" if mode == "spec" else "Concept Card"

    pdf = FPDF(orientation="L", unit="mm", format="A4")

    # --- Determinism: pin all variable metadata ---
    pdf.set_creation_date(_FIXED_EPOCH)
    pdf.set_producer("WiLL Geometry Service")
    pdf.set_creator("WiLL Geometry Service")

    # Standard PDF metadata
    pdf.set_title(f"WiLL {title} — {ctx.cfg.configId}")
    pdf.set_author("WiLL Lighting Systems")

    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    if mode == "concept-card":
        # The hero card paints its own full-bleed field + bands; the generic
        # header would sit UNDER them (invisible but present in the text).
        _render_hero_layout(pdf, ctx)
        return bytes(pdf.output())

    # --- Header ---
    _draw_header(pdf, title)

    # --- Spec layout (Phase 0.17 formatting pass) ---
    content_top = _HEADER_H + _RULE_H + 4.0
    usable_w = _PAGE_W - 2 * _MARGIN
    gutter = 8.0
    left_w = usable_w * _COL_SPLIT
    right_w = usable_w * (1 - _COL_SPLIT) - gutter
    left_x = _MARGIN
    right_x = _MARGIN + left_w + gutter
    content_bottom = _PAGE_H - 19.0  # leave room for footer

    # --- Render column (right): aspect-preserved panel + status + config ---
    render_h = (content_bottom - content_top) * 0.82
    _draw_render_column(
        pdf,
        ctx.render_png,
        left=right_x,
        top=content_top,
        width=right_w,
        height=render_h,
    )
    status = ctx.summary.get("status", "Configurable")
    _draw_status_chip(pdf, status, left=right_x, top=content_top + render_h + 3.0)
    _set_text(pdf, _MUTED)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_xy(right_x + 40.0, content_top + render_h + 4.2)
    pdf.cell(right_w - 40.0, 4.5, _latin1(f"Config {ctx.cfg.configId}"), align="R")
    _set_text(pdf, _GUNMETAL)

    # --- Left column: component table ---
    parts = ctx.summary.get("parts", [])
    y_after_table = _draw_components_table(
        pdf,
        parts,
        left=left_x,
        top=content_top,
        width=left_w,
    )

    # --- Left column: arm arrangement (only when >1 arm; no-op keeps layout) ---
    y_after_arr = _draw_arm_arrangement(
        pdf, ctx.summary, left=left_x, top=y_after_table + 1.0, width=left_w
    )

    # --- Left column: product pages (URLs, wrapped — moved out of the table) ---
    y_after_urls = _draw_product_pages(
        pdf, parts, left=left_x, top=y_after_arr + 1.0, width=left_w
    )

    # --- Left column: dimensions ---
    dims = ctx.summary.get("dims", {})
    y_after_dims = _draw_dims_block(
        pdf,
        dims,
        left=left_x,
        top=y_after_urls + 2.0,
        width=left_w,
    )

    # --- Left column: finish ---
    _draw_finish_block(
        pdf,
        ctx.summary,
        ctx.catalog,
        left=left_x,
        top=y_after_dims + 3.0,
        width=left_w,
    )

    # --- Footer ---
    footer_y = content_bottom + 1.0
    _draw_footer(pdf, ctx.cfg, top=footer_y)

    return bytes(pdf.output())
