"""Backwards-compatibility shim — real implementation moved to app/adapters/_titleblock.py.

Importing from this module continues to work for tests and legacy callers.
"""

from app.adapters._titleblock import (  # noqa: F401  (re-export)
    GUNMETAL,
    YELLOW,
    SILVER,
    SCALE,
    A3_W,
    A3_H,
    MARGIN,
    BLOCK_W,
    BLOCK_X,
    H_TITLE,
    H_BODY,
    H_SMALL,
    LINE_PAD,
    draw,
)
