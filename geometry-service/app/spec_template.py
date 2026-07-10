"""Backwards-compatibility shim — real implementation moved to app/adapters/_spec_template.py.

Importing from this module continues to work for tests and legacy callers.
"""

from app.adapters._spec_template import (  # noqa: F401  (re-export)
    render_spec,
    _mm_to_ft_in,
    _latin1,
    _LATIN1_MAP,
    _GUNMETAL,
    _YELLOW,
    _SILVER,
    _WHITE,
    _LIGHT_GRAY,
    _PAGE_W,
    _PAGE_H,
    _MARGIN,
    _HEADER_H,
    _RULE_H,
    _COL_SPLIT,
    _QUOTE_URL,
    _FIXED_EPOCH,
)
