"""WiLL title block for DXF elevation drawings.

Draws an A3 landscape border and a right-column title block with:
  - WiLL wordmark text (gunmetal)
  - Config ID
  - Date placeholder "—" (deterministic — no wall clock)
  - Finish name
  - DISCLAIMER line
  - Scale note (1:50)

Both DXF route adapters call ``draw(msp, ctx)`` identically — the boundary
between routes is in the silhouette geometry only.

Coordinates
-----------
The elevation is drawn at 1:1 real-world mm (a 20 ft pole = ~6100 mm tall).
To match the "Scale 1:50" note the border and title block are drawn at ×50
of the A3 paper dimensions so that, when printed at 1:50, the sheet reads
as a standard A3 layout:

    Sheet width  = 420 mm × 50 = 21 000 mm
    Sheet height = 297 mm × 50 = 14 850 mm

The elevation is centred horizontally near X=0 and sits above Y=0.  The
border is positioned so that the elevation extents sit inside it with a
comfortable margin.  The title block occupies the right 80 mm × 50 = 4 000 mm
strip of the sheet.

Dimension ``actual_measurement`` values are always the real mm values —
they are set explicitly by the dimension helpers in dxf_adapter and are
not affected by this coordinate change.

Brand palette (RGB → ezdxf true-color int):
  Gunmetal Gray   #42413D → rgb(66,  65,  61)
  Yellow Light    #FFCF2E → rgb(255, 207, 46)
  Gunmetal Silver #E6E7E8 → rgb(230, 231, 232)
"""

from __future__ import annotations

import ezdxf
from ezdxf.colors import rgb2int

from app.adapters.base import GenContext
from app.naming import DISCLAIMER

# ---------------------------------------------------------------------------
# Brand colours
# ---------------------------------------------------------------------------
GUNMETAL = rgb2int((66, 65, 61))
YELLOW = rgb2int((255, 207, 46))
SILVER = rgb2int((230, 231, 232))

# ---------------------------------------------------------------------------
# Scale factor — everything in this module is multiplied by SCALE.
# ---------------------------------------------------------------------------
SCALE = 50.0  # 1:50 → paper mm × 50 = model-space mm

# ---------------------------------------------------------------------------
# A3 landscape paper dimensions (mm) scaled to model-space coordinates
# ---------------------------------------------------------------------------
A3_W = 420.0 * SCALE   # 21 000 mm
A3_H = 297.0 * SCALE   # 14 850 mm
MARGIN = 5.0 * SCALE   # 250 mm
BLOCK_W = 80.0 * SCALE  # 4 000 mm — title-block strip width on the right

# The border is positioned relative to the elevation extents.
# draw() computes BORDER_X0, BORDER_Y0 dynamically from the elevation.
# BLOCK_X_OFFSET is the horizontal gap from the border right edge to the
# title block left edge — i.e. BLOCK_X = border_x1 - BLOCK_W.

# ---------------------------------------------------------------------------
# Text sizes (model-space mm height; paper equivalent = size / SCALE)
# ---------------------------------------------------------------------------
H_TITLE = 7.0 * SCALE    # 350 mm model ≈ 7 mm paper
H_BODY = 3.5 * SCALE     # 175 mm model ≈ 3.5 mm paper
H_SMALL = 2.8 * SCALE    # 140 mm model ≈ 2.8 mm paper

LINE_PAD = 2.0 * SCALE   # 100 mm model ≈ 2 mm paper


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _true_color(entity, color_int: int) -> None:
    """Apply an ezdxf true-color integer to an entity's dxf.true_color."""
    entity.dxf.true_color = color_int


def _rect(msp, x0: float, y0: float, x1: float, y1: float, color: int) -> None:
    """Draw a filled rectangle using a closed lwpolyline with bulge=0."""
    poly = msp.add_lwpolyline(
        [(x0, y0), (x1, y0), (x1, y1), (x0, y1)],
        close=True,
    )
    poly.dxf.true_color = color


def _text(msp, x: float, y: float, content: str, height: float, color: int) -> None:
    """Add a TEXT entity at (x, y) with the given height and true color."""
    t = msp.add_text(content, dxfattribs={"height": height})
    t.set_placement((x, y))
    _true_color(t, color)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def draw(msp, ctx: GenContext) -> None:
    """Draw the WiLL A3 title block into modelspace ``msp``.

    The border is sized A3 × SCALE (21 000 × 14 850 mm) and positioned so
    that the elevation — which is centred near X=0 and starts at Y=0 — sits
    inside it with at least MARGIN clearance on all sides.

    Parameters
    ----------
    msp:
        ezdxf modelspace (or any layout that accepts add_* calls).
    ctx:
        GenContext carrying cfg.configId, cfg.finish, and summary["finish"].
    """
    # Compute elevation extents from assembly dims (if available).
    dims = getattr(ctx.assembly, "dims", None) if ctx.assembly else None
    if dims is not None:
        elev_height_mm = dims.overall_height        # e.g. ~6906 mm
        elev_width_mm = max(dims.base_diameter, dims.arm_reach * 2.0)
    else:
        elev_height_mm = A3_H - 2 * MARGIN          # fallback: fill sheet
        elev_width_mm = A3_W - BLOCK_W - 2 * MARGIN

    # Elevation is centred at X=0, starts at Y=0.
    elev_x_min = -elev_width_mm / 2.0 - MARGIN
    elev_x_max = elev_width_mm / 2.0 + MARGIN
    elev_y_min = -MARGIN
    elev_y_max = elev_height_mm + MARGIN

    # Border: large enough to contain elevation + MARGIN + title block strip.
    # Ensure minimum A3 aspect.
    border_w = max(elev_x_max - elev_x_min + BLOCK_W + MARGIN, A3_W)
    border_h = max(elev_y_max - elev_y_min + MARGIN, A3_H)

    # Position: left/bottom of border so that elevation sits inside it.
    bx0 = elev_x_min - MARGIN
    by0 = elev_y_min - MARGIN
    bx1 = bx0 + border_w
    by1 = by0 + border_h

    # Title block: right BLOCK_W strip of the border interior.
    tb_x0 = bx1 - MARGIN - BLOCK_W
    tb_x1 = bx1 - MARGIN

    # --- Outer border ---
    _rect(msp, bx0 + MARGIN, by0 + MARGIN, bx1 - MARGIN, by1 - MARGIN, GUNMETAL)
    # Inner white fill to make it a border outline
    _rect(
        msp,
        bx0 + MARGIN + 0.5 * SCALE,
        by0 + MARGIN + 0.5 * SCALE,
        bx1 - MARGIN - 0.5 * SCALE,
        by1 - MARGIN - 0.5 * SCALE,
        rgb2int((255, 255, 255)),
    )

    # --- Title block background (right strip) ---
    _rect(msp, tb_x0, by0 + MARGIN, tb_x1, by1 - MARGIN, SILVER)

    # --- Divider line between elevation area and title block ---
    line = msp.add_line((tb_x0, by0 + MARGIN), (tb_x0, by1 - MARGIN))
    line.dxf.true_color = GUNMETAL

    # --- WiLL wordmark header ---
    hdr_top = by1 - MARGIN
    hdr_bot = hdr_top - H_TITLE - LINE_PAD * 2
    _rect(msp, tb_x0, hdr_bot, tb_x1, hdr_top, GUNMETAL)
    _text(
        msp,
        tb_x0 + LINE_PAD,
        hdr_bot + LINE_PAD,
        "WiLL",
        H_TITLE,
        GUNMETAL,
    )

    # --- Body rows ---
    cursor_y = hdr_bot - LINE_PAD * 2

    def _row(label: str, value: str) -> None:
        nonlocal cursor_y
        _text(msp, tb_x0 + LINE_PAD, cursor_y, label, H_SMALL, GUNMETAL)
        cursor_y -= H_SMALL + LINE_PAD * 0.5
        _text(msp, tb_x0 + LINE_PAD, cursor_y, value[:35], H_BODY, GUNMETAL)
        cursor_y -= H_BODY + LINE_PAD * 1.5
        # separator
        sep = msp.add_line(
            (tb_x0, cursor_y + LINE_PAD * 0.5),
            (tb_x1, cursor_y + LINE_PAD * 0.5),
        )
        sep.dxf.true_color = GUNMETAL

    finish_name = ctx.summary.get("finish", ctx.cfg.finish)

    _row("Config ID", ctx.cfg.configId)
    _row("Finish", finish_name)
    _row("Date", "-")          # deterministic, no wall clock
    _row("Scale", "1:50")
    _row("Drawing type", "Conceptual elevation")

    # --- DISCLAIMER (single visible MTEXT entity at bottom of title block) ---
    disc_y = by0 + MARGIN + LINE_PAD * 3
    _text(msp, tb_x0 + LINE_PAD, disc_y + H_SMALL + LINE_PAD, "NOTE:", H_SMALL, GUNMETAL)
    mtext = msp.add_mtext(
        DISCLAIMER,
        dxfattribs={
            "char_height": H_SMALL - 0.3 * SCALE,
            "width": BLOCK_W - LINE_PAD * 2,
            "insert": (tb_x0 + LINE_PAD, disc_y),
            "attachment_point": 4,  # top-left
        },
    )
    _true_color(mtext, GUNMETAL)

    # Expose the border rectangle extents for tests / dimension positioning.
    # Store on the module so _draw_dimensions in dxf_adapter can find BLOCK_X.
    # tb_x0 is the left edge of the title block (= right edge of elevation area).
    # Callers that imported BLOCK_X from app.titleblock used the paper-size value
    # (420-5-80=335 mm); they now get the scaled equivalent via this module.
    draw._last_tb_x0 = tb_x0  # type: ignore[attr-defined]
    draw._last_border = (bx0, by0, bx1, by1)  # type: ignore[attr-defined]


# Expose a BLOCK_X for callers that need to know the title-block left edge.
# This is approximate (uses A3 default sizing); draw() populates draw._last_tb_x0
# with the actual value after being called.
BLOCK_X = (420.0 - 5.0 - 80.0) * SCALE  # 335 mm × 50 = 16 750 mm
