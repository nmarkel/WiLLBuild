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

Coordinates: A3 landscape = 420 × 297 mm.  DXF units are mm, 1:1.
Title block occupies the right 80 mm strip.

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
# A3 landscape dimensions (mm)
# ---------------------------------------------------------------------------
A3_W = 420.0
A3_H = 297.0
MARGIN = 5.0       # inner margin from sheet edge
BLOCK_W = 80.0     # title-block strip width on the right
BLOCK_X = A3_W - MARGIN - BLOCK_W   # left edge of title block

# ---------------------------------------------------------------------------
# Text sizes (mm height — approximate character height in DXF TEXT)
# ---------------------------------------------------------------------------
H_TITLE = 7.0
H_BODY = 3.5
H_SMALL = 2.8

LINE_PAD = 2.0  # vertical padding between rows


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

    Parameters
    ----------
    msp:
        ezdxf modelspace (or any layout that accepts add_* calls).
    ctx:
        GenContext carrying cfg.configId, cfg.finish, and summary["finish"].
    """
    # --- Outer border ---
    _rect(msp, MARGIN, MARGIN, A3_W - MARGIN, A3_H - MARGIN, GUNMETAL)
    # Inner white fill to make it a border (overdrawn by content later)
    _rect(msp, MARGIN + 0.5, MARGIN + 0.5, A3_W - MARGIN - 0.5, A3_H - MARGIN - 0.5, rgb2int((255, 255, 255)))

    # --- Title block background (right strip) ---
    _rect(msp, BLOCK_X, MARGIN, A3_W - MARGIN, A3_H - MARGIN, SILVER)

    # --- Divider line between elevation area and title block ---
    line = msp.add_line((BLOCK_X, MARGIN), (BLOCK_X, A3_H - MARGIN))
    line.dxf.true_color = GUNMETAL

    # --- WiLL wordmark header ---
    hdr_top = A3_H - MARGIN
    hdr_bot = hdr_top - H_TITLE - LINE_PAD * 2
    _rect(msp, BLOCK_X, hdr_bot, A3_W - MARGIN, hdr_top, GUNMETAL)
    _text(
        msp,
        BLOCK_X + LINE_PAD,
        hdr_bot + LINE_PAD,
        "WiLL",
        H_TITLE,
        GUNMETAL,
    )

    # --- Body rows ---
    cursor_y = hdr_bot - LINE_PAD * 2

    def _row(label: str, value: str) -> None:
        nonlocal cursor_y
        _text(msp, BLOCK_X + LINE_PAD, cursor_y, label, H_SMALL, GUNMETAL)
        cursor_y -= H_SMALL + LINE_PAD * 0.5
        _text(msp, BLOCK_X + LINE_PAD, cursor_y, value[:35], H_BODY, GUNMETAL)
        cursor_y -= H_BODY + LINE_PAD * 1.5
        # separator
        sep = msp.add_line(
            (BLOCK_X, cursor_y + LINE_PAD * 0.5),
            (A3_W - MARGIN, cursor_y + LINE_PAD * 0.5),
        )
        sep.dxf.true_color = GUNMETAL

    finish_name = ctx.summary.get("finish", ctx.cfg.finish)

    _row("Config ID", ctx.cfg.configId)
    _row("Finish", finish_name)
    _row("Date", "—")          # em dash — deterministic, no wall clock
    _row("Scale", "1:50")
    _row("Drawing type", "Conceptual elevation")

    # --- DISCLAIMER (single visible MTEXT entity at bottom of title block) ---
    # MTEXT wraps the full string automatically — one entity is both searchable
    # (contains the complete DISCLAIMER) and visibly rendered.
    disc_y = MARGIN + LINE_PAD * 3
    _text(msp, BLOCK_X + LINE_PAD, disc_y + H_SMALL + LINE_PAD, "NOTE:", H_SMALL, GUNMETAL)
    mtext = msp.add_mtext(
        DISCLAIMER,
        dxfattribs={
            "char_height": H_SMALL - 0.3,
            "width": BLOCK_W - LINE_PAD * 2,
            "insert": (BLOCK_X + LINE_PAD, disc_y),
            "attachment_point": 4,  # top-left
        },
    )
    _true_color(mtext, GUNMETAL)
