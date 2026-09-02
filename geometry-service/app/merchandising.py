"""Server-side merchandising enforcement (Phase 0.20, Workstream B).

The builder UI hides held parts, offers five download cards and builds option
codes from each part's own ordering table. None of that was enforced anywhere a
direct API caller could not reach: `curl` could ask for a held fixture, for the
mock `rfa`, or for a fabricated option code, and the service answered.

**The UI is a convenience. This module is the gate.** Every rule here is
fail-closed — the question is always "is this explicitly permitted?", never "is
this known to be forbidden?" — so a part, format or code that nobody has
thought about yet is refused rather than served.

Note on CORS: `ALLOWED_ORIGINS` is not access control. It asks the *browser* to
withhold a response; it does nothing to curl, and it is not a substitute for
any check in this file.
"""

from __future__ import annotations

from .models import PoleConfig

# ---------------------------------------------------------------------------
# Rule 1 — Coming Soon
# ---------------------------------------------------------------------------
# A direct port of `isComingSoon` in src/lib/availability.ts. The two must agree
# exactly: if the server were STRICTER the builder would offer parts that 422 on
# download, and if it were LOOSER the hold would be advisory. Keep the branches
# in the same order as the TypeScript so a diff between them stays readable.

COMING_SOON_LINES: frozenset[str] = frozenset({"WiLLstudio"})


def is_coming_soon(part: dict | None) -> bool:
    """Whether a part is presented as Coming Soon: visible, but inert.

    Two independent reasons, kept apart because they behave differently over
    time: an EDITORIAL hold (``comingSoon``) that only a person clears, and a
    GEOMETRY gap (``realCad``) that clears itself when ingest lands the part.
    """
    if not part:
        return False
    if part.get("comingSoon"):
        return True
    if part.get("line") not in COMING_SOON_LINES:
        return False
    # A configuration concept (direct-mount) needs no CAD, ever.
    if part.get("pseudoPart"):
        return False
    # Render-only accessories are never selectable; badging one would wrongly
    # imply its ORDER CODE is unorderable.
    if part.get("slot") == "accessory":
        return False
    # Tyler 8/12: named parts may sell from placeholder art.
    if part.get("placeholderApproved"):
        return False
    return part.get("realCad") is not True


_CONFIG_SLOTS = ("fixture", "arm", "pole", "baseCover")


def check_not_held(catalog: dict, cfg: PoleConfig) -> None:
    """Raise ValueError when any configured part is Coming Soon.

    Refuses the whole build rather than the offending slot: a part number and a
    drawing describe an assembly, so emitting one with a held component in it
    would be a quote for something WiLL is not selling.
    """
    parts = {p["id"]: p for p in catalog.get("parts", [])}
    held: list[str] = []
    for slot in _CONFIG_SLOTS:
        part_id = getattr(cfg, slot, "") or ""
        if not part_id:
            continue
        part = parts.get(part_id)
        if is_coming_soon(part):
            held.append(f"{part_id} ({(part or {}).get('name', slot)})")
    if held:
        raise ValueError(
            "these components are Coming Soon and cannot be generated: "
            + ", ".join(sorted(held))
        )


# ---------------------------------------------------------------------------
# Rule 2 — servable formats
# ---------------------------------------------------------------------------
# The five cards in DELIVERABLE_DEFS (src/components/OutputTray.tsx), plus dwg.
#
# Deliberately NOT the adapter registry. `step` and `rfa` both have working,
# registered adapters and neither is merchandised: the STEP a customer is meant
# to receive rides inside `bundle`, and `rfa` is an APS mock that announces
# itself as a Revit family and will not open in Revit. A registered adapter is
# an engineering fact; this set is a product decision.
#
# `dwg` has no card of its own — it is the DXF card's documented alternative,
# reachable only where the ODA binary is installed (it is in no deployment
# today), so it is allowed here without appearing in the UI list.
#
# tests/test_merchandising.py pins this set against the TSX so the two cannot
# drift: a new card that is not added here 422s in production.
SERVABLE_FORMATS: frozenset[str] = frozenset(
    {"herocard", "pdf", "dxf", "ifc", "bundle", "dwg"}
)


def check_formats_servable(formats: list[str]) -> None:
    """Raise ValueError on any format the UI does not offer.

    Refuses the ENTIRE request when one format is unservable, rather than
    quietly generating the rest — a caller who asked for four files and
    received three with a 200 has been told nothing went wrong.
    """
    unservable = [f for f in formats if f not in SERVABLE_FORMATS]
    if unservable:
        raise ValueError(
            "format(s) not offered for download: "
            + ", ".join(repr(f) for f in sorted(set(unservable)))
            + "; available: "
            + ", ".join(sorted(SERVABLE_FORMATS))
        )


# ---------------------------------------------------------------------------
# Rule 3 — option codes
# ---------------------------------------------------------------------------


def _declared_codes(part: dict) -> dict[str, set[str]]:
    """option key -> the codes that key's own ordering column declares."""
    out: dict[str, set[str]] = {}
    for opt in part.get("options") or []:
        key = opt.get("key")
        if not key:
            continue
        out[key] = {v["code"] for v in opt.get("values") or [] if v.get("code")}
    return out


def check_spec_options(catalog: dict, cfg: PoleConfig) -> None:
    """Raise ValueError on an option key or code the part does not declare.

    These codes are not decoration — they are concatenated into the customer's
    part number, so an invented one prints a SKU that does not exist and a code
    borrowed from another product prints one that means something else. Both
    reach a quote looking authoritative.
    """
    parts = {p["id"]: p for p in catalog.get("parts", [])}
    chosen = getattr(cfg, "specOptions", None) or {}
    problems: list[str] = []

    for slot, selections in chosen.items():
        if not isinstance(selections, dict):
            problems.append(f"{slot}: specOptions must be an object of key -> code")
            continue
        part_id = getattr(cfg, slot, "") if slot in _CONFIG_SLOTS else ""
        part = parts.get(part_id or "")
        if part is None:
            problems.append(f"{slot}: no configured part to take options from")
            continue
        declared = _declared_codes(part)
        for key, value in selections.items():
            if key not in declared:
                problems.append(f"{part_id}: unknown option {key!r}")
                continue
            # A column may be single- or multi-select; validate elementwise so
            # one bad entry in a list cannot ride along with good ones.
            codes = [value] if isinstance(value, str) else list(value or [])
            for code in codes:
                if code == "":
                    continue
                if code not in declared[key]:
                    problems.append(f"{part_id}.{key}: invalid code {code}")

    if problems:
        raise ValueError("; ".join(problems))
