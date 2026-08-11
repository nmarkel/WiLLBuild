"""WiLL part-number resolver — Python mirror of ``src/lib/summary.ts``.

Phase 0.11, Workstream Z1.  Restores the geometry-service side of the part
number after the 0.10.5 branch combine dropped it (regression R1): the number
existed only in the browser, so generated STEP/DXF/IFC/PDF and the download
bundle carried no part number at all — which had been 0.10's headline goal.

This is a **clean re-add, not a revival**.  0.10's ``app/partnumber.py``
mirrored ``src/lib/partNumber.ts`` and read ``config.partOptions`` plus
``catalog.parts[].ordering`` — a data model that no longer exists.  The
surviving resolver is Tyler's ``buildPartNumber`` in ``src/lib/summary.ts``,
which reads ``config.specOptions`` and ``catalog.parts[].options`` (the
machine-parsed spec-sheet columns).  This module mirrors *that* function, line
for line, and 0.10's version is deliberately not restored.

    [ordering columns in sheet order] - [selected options/accessories]
    WD-GVX-80-30-MV-5W-BK-PM

Drift guard
-----------
``docs/part-number-cases.json`` is a shared fixture of (config -> expected
number) cases read by BOTH ``geometry-service/tests/test_partnumber.py`` and
``src/lib/summary.test.ts``.  Neither language owns it.  Changing resolution
behaviour in one language fails the other's suite until the fixture is
regenerated and both are updated together — which is the entire point.
``src/lib/summary.ts`` remains the reference implementation; this file follows
it.
"""

from __future__ import annotations

from .models import PoleConfig

# The four assembly slots that carry their own number, in selection order
# (mirrors SUMMARY_ROWS in src/lib/summary.ts).
NUMBERED_SLOTS = ("fixture", "arm", "pole", "baseCover")

SLOT_LABELS = {
    "fixture": "Fixture",
    "arm": "Arm",
    "pole": "Pole",
    "baseCover": "Base Cover",
}

# An ordering column the customer has not answered yet.  Mirrors the '_'
# placeholder in buildPartNumber — deliberately not '?', which 0.10 used.
UNSPECIFIED = "_"


def _find_part(catalog: dict, part_id: str) -> dict | None:
    """Mirrors partById in src/lib/compat.ts."""
    if not part_id:
        return None
    for part in catalog.get("parts", []):
        if part.get("id") == part_id:
            return part
    return None


def _find_finish(catalog: dict, finish_id: str) -> dict | None:
    for finish in catalog.get("finishes", []):
        if finish.get("id") == finish_id:
            return finish
    return None


def finish_for(cfg: PoleConfig, slot: str) -> str:
    """The finish a part in ``slot`` renders/orders in.

    Mirrors ``finishFor`` in src/lib/compat.ts: the per-slot override when set,
    else the base ``config.finish``.  Phase 0.11 Workstream A (per-component
    finish) is what makes this more than an alias — every slot can differ.
    """
    if slot in NUMBERED_SLOTS:
        overrides = cfg.finishes or {}
        return overrides.get(slot) or cfg.finish
    return cfg.finish


def spec_codes(value: str | list[str] | None) -> list[str]:
    """Mirrors ``specCodes`` in src/lib/compat.ts.

    Ordering columns store a single string, options & accessories columns store
    a list; readers never care which shape arrived.  Falsy entries are dropped
    exactly as the JS ``.filter(Boolean)`` does.
    """
    if not value:
        return []
    items = value if isinstance(value, list) else [value]
    return [v for v in items if v]


def _js_number(value: float | int) -> str:
    """Format a number the way JS ``String(n)`` does.

    ``String(20)`` is ``"20"``, not ``"20.0"``.  ``catalog.json``'s ``heightFt``
    parses as an int for whole feet but a float would round-trip differently in
    Python, and the pole part number embeds this value verbatim.
    """
    if isinstance(value, bool):  # bool is an int subclass — never a height
        return str(value)
    as_float = float(value)
    if as_float.is_integer():
        return str(int(as_float))
    return repr(as_float)


def _chosen_for_slot(cfg: PoleConfig, slot: str) -> dict:
    return (cfg.specOptions or {}).get(slot) or {}


def build_part_number(catalog: dict, cfg: PoleConfig, slot: str) -> str | None:
    """One component's full ordering part number, or None when it has no sheet.

    Faithful mirror of ``buildPartNumber`` in src/lib/summary.ts.  Every branch
    below corresponds to a branch there, in the same order; keep them aligned.
    """
    part = _find_part(catalog, getattr(cfg, slot, ""))
    if part is None:
        return None

    # Arms carry official per-configuration model codes (SH1, SS3, AR2, …) —
    # that code IS the arm's ordering part number for the chosen count.
    model_codes = part.get("modelCodes")
    if slot == "arm" and model_codes:
        # JSON object keys are strings; the frontend indexes with a number and
        # gets undefined for a count the arm has no code for.
        base = model_codes.get(str(cfg.armCount or 1))
        if base is None:
            return None
        return _with_add_ons(base, part, cfg, slot)

    options = part.get("options")
    if not options:
        return None

    chosen = _chosen_for_slot(cfg, slot)
    finish_id = finish_for(cfg, slot)
    finish = _find_finish(catalog, finish_id)

    segments: list[str] = []
    for opt in sorted(
        (o for o in options if o.get("group") == "ordering"),
        key=lambda o: o.get("orderPosition", 0),
    ):
        key = opt.get("key", "")
        values = opt.get("values") or []
        selected = spec_codes(chosen.get(key))
        if selected:
            segments.append(selected[0])
        elif key.startswith("finish-color"):
            # The sheet's own code when it lists this finish, else the palette
            # code (covers sheets whose finish column predates a new color).
            mapped = next((v for v in values if v.get("mapsTo") == finish_id), None)
            segments.append(
                (mapped or {}).get("code")
                or (finish or {}).get("code")
                or UNSPECIFIED
            )
        elif key == "finish-type":
            # Finish type is a function of the picked color: FP painted / AN anodized.
            type_code = (finish or {}).get("typeCode")
            segments.append(type_code if type_code else values[0]["code"])
        elif key == "design" and part.get("designCode"):
            segments.append(part["designCode"])
        elif key == "length" and part.get("heightFt"):
            segments.append(_js_number(part["heightFt"]))
        elif len(values) == 1:
            segments.append(values[0]["code"])
        elif any(v.get("code") == part.get("family") for v in values):
            # The part card IS this choice (e.g. the DRX design column).
            segments.append(part["family"])
        else:
            segments.append(UNSPECIFIED)

    for opt in sorted(
        (o for o in options if o.get("group") == "options-accessories"),
        key=lambda o: o.get("orderPosition", 0),
    ):
        segments.extend(spec_codes(chosen.get(opt.get("key", ""))))

    return "-".join(segments)


def _with_add_ons(base: str, part: dict, cfg: PoleConfig, slot: str) -> str:
    """Append selected options/accessories codes to a modelCodes-derived number.

    Phase 0.11 Workstream C: SH1 offers CF1/CF2/CF3 centre-feature codes, so an
    arm resolved from ``modelCodes`` must still carry its chosen options —
    ``SH1-CF2``, not a bare ``SH1``.  Arms with no options column are
    unaffected and still resolve to the bare model code.
    """
    chosen = _chosen_for_slot(cfg, slot)
    extras: list[str] = []
    for opt in sorted(
        (o for o in (part.get("options") or []) if o.get("group") == "options-accessories"),
        key=lambda o: o.get("orderPosition", 0),
    ):
        extras.extend(spec_codes(chosen.get(opt.get("key", ""))))
    return "-".join([base, *extras]) if extras else base


def resolve_assembly_part_numbers(catalog: dict, cfg: PoleConfig) -> dict[str, str | None]:
    """Every configured component's part number, keyed by slot.

    Slots with no selected part are omitted entirely; a selected part with no
    published ordering sheet maps to ``None`` (the caller prints a dash — never
    a fabricated code, per docs/part-numbers.md).
    """
    numbers: dict[str, str | None] = {}
    for slot in NUMBERED_SLOTS:
        if getattr(cfg, slot, ""):
            numbers[slot] = build_part_number(catalog, cfg, slot)
    return numbers


def part_number_text(catalog: dict, cfg: PoleConfig, slot: str) -> str:
    """One printable ``Fixture: WD-GVX-…`` line for summary.txt / the bundle."""
    number = build_part_number(catalog, cfg, slot)
    label = SLOT_LABELS.get(slot, slot.title())
    if not number:
        return f"{label}: part number pending matrix"
    return f"{label}: {number}"


def is_complete(number: str | None) -> bool:
    """A number with no unanswered ordering column.

    ``_`` marks a column the customer still has to specify; a number carrying
    one must never be presented as spec-able (and must never name a file).
    """
    if not number:
        return False
    return UNSPECIFIED not in number.split("-")
