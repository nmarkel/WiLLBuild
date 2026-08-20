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
    "®": "(R)", # registered trade mark
    "©": "(C)", # copyright
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


def _render_hero_layout(pdf: FPDF, ctx: GenContext) -> None:
    """Render concept-card hero layout.

    Top ~55% height: full-width render band.
    Bottom: component list, compact dims row, finish (with RAL), status chip.
    Footer: unchanged (disclaimer + config ID + quote CTA).
    """
    content_top = _HEADER_H + _RULE_H + 4.0
    usable_w = _PAGE_W - 2 * _MARGIN
    footer_y = _PAGE_H - 19.0
    content_h = footer_y - content_top

    # Hero render band: ~58% of content height, aspect-preserved in its panel.
    render_band_h = content_h * 0.58
    _draw_render_column(
        pdf,
        ctx.render_png,
        left=_MARGIN,
        top=content_top,
        width=usable_w,
        height=render_band_h,
    )

    # Below render: info area — left components, right dims/finish/status.
    info_top = content_top + render_band_h + 5.0
    gutter = 8.0
    left_w = usable_w * 0.56
    right_w = usable_w * 0.44 - gutter
    left_x = _MARGIN
    right_x = _MARGIN + left_w + gutter

    # --- Left: component table ---
    parts = ctx.summary.get("parts", [])
    y_after_table = _draw_components_table(
        pdf,
        parts,
        left=left_x,
        top=info_top,
        width=left_w,
    )

    # --- Left: arm arrangement (only when >1 arm; no-op → position unchanged) ---
    _draw_arm_arrangement(pdf, ctx.summary, left=left_x, top=y_after_table + 1.0, width=left_w)

    # --- Right: dims, then finish, then status chip — one column, even gaps ---
    dims = ctx.summary.get("dims", {})
    y_after_dims = _draw_dims_block(
        pdf,
        dims,
        left=right_x,
        top=info_top,
        width=right_w,
    )
    y_after_finish = _draw_finish_block(
        pdf,
        ctx.summary,
        ctx.catalog,
        left=right_x,
        top=y_after_dims + 3.0,
        width=right_w,
    )
    status = ctx.summary.get("status", "Configurable")
    _draw_status_chip(pdf, status, left=right_x, top=y_after_finish + 1.5)

    # --- Footer ---
    _draw_footer(pdf, ctx.cfg, top=footer_y)


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

    # --- Header ---
    _draw_header(pdf, title)

    if mode == "concept-card":
        _render_hero_layout(pdf, ctx)
        return bytes(pdf.output())

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
