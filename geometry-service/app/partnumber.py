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

# The ordering key of a part's SECOND finish column.  Mirrors
# ACCENT_FINISH_KEY in src/lib/compat.ts.
ACCENT_FINISH_KEY = "finish-color-accent"


# Lines the Coming Soon rule is switched on for.  Mirrors COMING_SOON_LINES in
# src/lib/availability.ts — WiLLstudio only, the one line whose real-vs-
# placeholder split has been audited (the 8/11 coverage matrix).
COMING_SOON_LINES = ("WiLLstudio",)


def _is_coming_soon(part: dict) -> bool:
    """Whether a part is visible-but-inert.  Mirrors src/lib/availability.ts.

    Two independent reasons.  An EDITORIAL hold (``comingSoon``) is a decision
    about a named product — Tyler's 8/11 cut keeps the fixtures to GVX + TEX, so
    DRX/MVX/DWX are held despite having real CAD — and it ignores the line
    scope.  A GEOMETRY gap is the generated ``realCad`` flag, scoped to the
    audited lines and skipped for pseudo-parts; it clears by itself as the
    ingest lands each part.
    """
    if part.get("comingSoon"):
        return True
    if part.get("line") not in COMING_SOON_LINES:
        return False
    if part.get("pseudoPart"):
        return False
    return part.get("realCad") is not True


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


def accent_finish_for(cfg: PoleConfig, slot: str) -> str:
    """The finish a part's accent / secondary component orders in.

    Mirrors ``accentFinishFor`` in src/lib/compat.ts.  Phase 0.12: TEX's sheet
    carries TWO finish segments (Housing, and Spider Mount & Accent Line) and
    requires the accent designation even on side mounts.  An unset accent falls
    back to the slot's own finish, exactly as an unset slot finish falls back to
    the base ``config.finish`` — a default, not an invented code.
    """
    overrides = getattr(cfg, "accentFinishes", None) or {}
    return overrides.get(slot) or finish_for(cfg, slot)


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


def _finish_code(catalog: dict, values: list[dict], finish_id: str) -> str:
    """A finish column's code for one finish id.

    Mirrors ``finishCode`` in src/lib/summary.ts: the sheet's own code when that
    column lists the finish, else the palette code (TEX prints 10 of the
    palette's 13 colours).  Shared by both finish segments so Housing and Accent
    resolve identically.
    """
    mapped = next((v for v in values if v.get("mapsTo") == finish_id), None)
    if mapped and mapped.get("code"):
        return mapped["code"]
    finish = _find_finish(catalog, finish_id)
    return (finish or {}).get("code") or UNSPECIFIED


def _cord_code_for(catalog: dict, cfg: PoleConfig) -> str | None:
    """CR-OPT-06 (Tyler 8/14): the bracket-derived required cord.

    Mirrors ``cordCodeFor`` in src/lib/compat.ts: pendant fixture + WiLLstudio
    bracket → the arm's ``cordCode`` or the WHP7NP standard; anything else →
    no cord.
    """
    fixture = _find_part(catalog, getattr(cfg, "fixture", ""))
    arm = _find_part(catalog, getattr(cfg, "arm", ""))
    if not fixture or not arm:
        return None
    if fixture.get("mount") != "pendant":
        return None
    if arm.get("line") != "WiLLstudio" or arm.get("pseudoPart"):
        return None
    return arm.get("cordCode") or "WHP7NP"


def build_part_number(catalog: dict, cfg: PoleConfig, slot: str) -> str | None:
    """One component's full ordering part number, or None when it has no sheet.

    Faithful mirror of ``buildPartNumber`` in src/lib/summary.ts.  Every branch
    below corresponds to a branch there, in the same order; keep them aligned.
    """
    part = _find_part(catalog, getattr(cfg, slot, ""))
    if part is None:
        return None

    # Phase 0.12 (Workstream D): a Coming Soon part produces NO part number.
    # Mirrors `isComingSoon` in src/lib/availability.ts.  A part still rendering
    # from placeholder geometry is not orderable, and this resolver's output is
    # exactly what a designer pastes into a project spec — so the generated PDF
    # and bundle must print a dash here, never a plausible-looking SKU.
    if _is_coming_soon(part):
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
        # Phase 0.12_TO (Tyler 8/12): the arm's finish colour joins its number
        # (SS2-BK-CF2, finish before the centre-feature codes), from the
        # palette itself — arms have no sheet columns.
        finish = _find_finish(catalog, finish_for(cfg, slot))
        arm_finish = (finish or {}).get("code")
        if arm_finish:
            base = f"{base}-{arm_finish}"
        # Tyler 8/12: arms lead with the WP family code like every other
        # WiLLstudio number — WP-SS2-BK-CF2.
        return _with_add_ons(f"WP-{base}", part, cfg, slot)

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
        if key == "pole-fit":
            # CR-PN-04 (final form, Tyler 8/14): derived, in the sheet's own
            # column position; blank placeholder when no pole is chosen.
            pole = _find_part(catalog, getattr(cfg, "pole", ""))
            diameter = (pole or {}).get("diameterIn")
            fit = None
            if diameter:
                want = f"{_js_number(diameter)}R"
                fit = next(
                    (v["code"] for v in values if v.get("code") == want), None
                )
            segments.append(fit or UNSPECIFIED)
            continue
        if selected:
            segments.append(selected[0])
        elif key == ACCENT_FINISH_KEY:
            # Phase 0.12: TEX's second finish segment.  MUST be tested before
            # the "finish-color" prefix below, which this key also matches —
            # otherwise both columns resolve to the housing colour and the
            # accent silently duplicates it.
            segments.append(
                _finish_code(catalog, values, accent_finish_for(cfg, slot))
            )
        elif key.startswith("finish-color"):
            segments.append(_finish_code(catalog, values, finish_id))
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

    # CR-OPT-07: voltage-resolved codes; CR-OPT-06: derived rows never print
    # their own code.  Mirrors addOnCodes in src/lib/summary.ts.
    voltage = (spec_codes(chosen.get("voltage")) or [None])[0]
    _pole = _find_part(catalog, getattr(cfg, "pole", ""))
    pole_diameter = (_pole or {}).get("diameterIn")
    for opt in sorted(
        (o for o in options if o.get("group") == "options-accessories"),
        key=lambda o: o.get("orderPosition", 0),
    ):
        values = opt.get("values") or []
        for code in spec_codes(chosen.get(opt.get("key", ""))):
            # CR-OPT-06: cord codes in selections never print — the derived
            # cord is the only authority (mirrors exclusiveFamily 'cord').
            if code.startswith("WHP"):
                continue
            value = next((v for v in values if v.get("code") == code), None)
            if value and value.get("derived"):
                continue
            mapped = (value or {}).get("resolvesBy", {}).get(voltage) if voltage else None
            # CR-OPT-10: pole-diameter-resolved codes (hand-hole size digit).
            sized = (
                (value or {}).get("resolvesByDiameter", {}).get(_js_number(pole_diameter))
                if pole_diameter
                else None
            )
            resolved = sized or mapped or code
            # CR-OPT-11: a multi accessory prints once per configured instance.
            count = 1
            if ((value or {}).get("placement") or {}).get("multi"):
                raw = (getattr(cfg, "accessoryPlacements", None) or {}).get(code)
                instances = raw if isinstance(raw, list) else ([raw] if raw else [])
                count = max(1, len(instances))
            segments.extend([resolved] * count)

    # CR-OPT-06: the REQUIRED bracket-derived cord (WHP7NP standard).
    if slot == "fixture":
        cord = _cord_code_for(catalog, cfg)
        if cord:
            segments.append(cord)

    # Derived Pole Fit rides at the very end (after finish + add-ons).
    # Phase 0.12_TO (Tyler 8/12): trailing unanswered columns don't print — a
    # pole with nothing chosen ends after its colour code.  Interior blanks
    # stay: they keep the sheet's column positions readable.
    while segments and segments[-1] == UNSPECIFIED:
        segments.pop()

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
