"""WiLL part-number resolver (Phase 0.10, Workstream 0).

Python mirror of ``src/lib/partNumber.ts``.  Same catalog data
(``public/catalog.json`` — one source of truth), same rules, same output
strings, so the number a customer sees in the configurator is the number
printed on the spec sheet / concept card:

    [Product Family] - [Design] - [Pole/Tenon Fit] - [Finish] [- Options]
    WP - SS3 - 30E - BK

Two data sources:
  * ``part["ordering"]``  — the transcribed WiLLstudio arms/base-cover matrix
    (merged by ``scripts/merge-ordering.mjs``).  Arm count selects the design.
  * ``part["options"]``   — the machine-parsed spec-sheet ordering matrix
    (Phase 0.8 D).  Its ``ordering``-group columns ARE the segments, in sheet
    order.

A part with neither resolves to NO number (``unavailable``), never a guessed
one.  An unchosen column renders as ``?`` and marks the number incomplete.

Keep in sync with the TypeScript resolver — ``tests/test_partnumber.py`` pins the
same expected strings the frontend tests do.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .models import PoleConfig

UNSPECIFIED = "?"
_IN_PER_M = 1 / 0.0254

# Which assembly components carry their own number, in selection order.
_NUMBERED_FIELDS = ("fixture", "arm", "pole", "baseCover")

_SLOT_LABELS = {
    "fixture": "Fixture",
    "arm": "Arm",
    "pole": "Pole",
    "baseCover": "Base Cover",
    "banner": "Banner Arm",
    "standalone": "Product",
}


@dataclass
class Segment:
    label: str
    code: str | None
    source: str  # family | design | fit | finish | spec | option
    value_label: str | None = None


@dataclass
class PartNumber:
    part_id: str
    part_name: str
    slot_label: str
    code: str = ""
    segments: list[Segment] = field(default_factory=list)
    complete: bool = False
    unavailable: str | None = None
    source: str | None = None
    parse_flagged: bool = False

    @property
    def unresolved(self) -> int:
        return sum(1 for s in self.segments if s.source != "option" and s.code is None)


# ---------------------------------------------------------------------------
# Column classification — mirrors isFinishColumn / isMultiSelectOption
# ---------------------------------------------------------------------------

def _is_finish_column(option: dict) -> bool:
    """A Finish COLOUR column (driven by the assembly finish, not a dropdown).

    Deliberately not a bare "finish" match: the decorative-pole sheet also has an
    ``anchor-bolts-base-type-finish-type`` column (finish TYPE), a real choice.
    """
    return str(option.get("key", "")).startswith("finish-color")


def _is_multi_select(option: dict) -> bool:
    """The multi-select Options/Accessories fields (customers pick several)."""
    key = str(option.get("key", ""))
    return bool(re.fullmatch(r"options(-\d+)?", key)) or key == "accessories"


def _is_family_column(option: dict) -> bool:
    return option.get("key") == "product-family"


def _codes(cfg: PoleConfig, part_id: str) -> dict[str, str]:
    """Single-select ordering-column codes chosen for this part."""
    selections = (cfg.partOptions or {}).get(part_id)
    return dict(selections.codes) if selections is not None else {}


def _add_ons(cfg: PoleConfig, part_id: str) -> list[str]:
    """Multi-select Options/Accessories codes chosen for this part."""
    selections = (cfg.partOptions or {}).get(part_id)
    return list(selections.addOns) if selections is not None else []


# ---------------------------------------------------------------------------
# Segment builders
# ---------------------------------------------------------------------------

def _find_part(catalog: dict, part_id: str) -> dict | None:
    for p in catalog.get("parts", []):
        if p["id"] == part_id:
            return p
    return None


def _designs_for_count(part: dict, arm_count: int) -> list[dict]:
    designs = (part.get("ordering") or {}).get("designs") or []
    counted = [d for d in designs if isinstance(d.get("armCount"), int)]
    if not counted:
        return designs
    return [d for d in counted if d["armCount"] == arm_count]


def _finish_segment(catalog: dict, cfg: PoleConfig, label: str = "Finish") -> Segment:
    finish = next((f for f in catalog.get("finishes", []) if f["id"] == cfg.finish), None)
    return Segment(
        label=label,
        code=(finish or {}).get("code"),
        source="finish",
        value_label=(finish or {}).get("name"),
    )


def _host_for(catalog: dict, cfg: PoleConfig, part: dict) -> dict | None:
    slot = part.get("slot")
    if slot == "fixture":
        return _find_part(catalog, cfg.arm)
    if slot in ("arm", "baseCover", "banner"):
        return _find_part(catalog, cfg.pole)
    return None


def _fit_segment(catalog: dict, cfg: PoleConfig, part: dict) -> Segment | None:
    ordering = part.get("ordering") or {}
    tables = catalog.get("ordering") or {}
    fit_key = ordering.get("fit")
    if not fit_key or not tables:
        return None
    table = (tables.get("fitCodes") or {}).get(fit_key)
    if not table:
        return None

    segment = Segment(label="Pole/Tenon Fit", code=None, source="fit")

    od_in: float | None = None
    if ordering.get("fitFrom") == "hostPoleShaftOd":
        pole = _find_part(catalog, cfg.pole) or {}
        shaft = pole.get("placeholder") or {}
        if "radiusTopM" in shaft:
            od_in = shaft["radiusTopM"] * 2 * _IN_PER_M
    else:
        host = _host_for(catalog, cfg, part)
        mount = part.get("mount")
        socket_type = None
        if host and mount:
            for socket in (host.get("sockets") or {}).values():
                if socket.get("type") == mount:
                    socket_type = socket["type"]
                    break
        if socket_type is not None:
            od_in = (tables.get("socketOdIn") or {}).get(socket_type)

    if od_in is None:
        return segment

    tolerance = tables.get("fitToleranceIn", 0.5)
    best, best_delta = None, float("inf")
    for entry in table:
        if entry.get("odIn") is None:
            continue
        delta = abs(entry["odIn"] - od_in)
        if delta < best_delta:
            best, best_delta = entry, delta
    if best is not None and best_delta <= tolerance:
        segment.code = best["code"]
        segment.value_label = best.get("label")
    return segment


def _matrix_segments(catalog: dict, cfg: PoleConfig, part: dict) -> list[Segment]:
    ordering = part["ordering"]
    segments = [
        Segment(
            label="Product Family",
            code=ordering.get("family"),
            source="family",
            value_label=ordering.get("familyLabel"),
        )
    ]

    candidates = _designs_for_count(part, cfg.armCount or 1)
    chosen_code = _codes(cfg, part["id"]).get("design")
    design = next((d for d in candidates if d["code"] == chosen_code), None)
    if design is None and len(candidates) == 1:
        design = candidates[0]
    segments.append(
        Segment(
            label="Design",
            code=(design or {}).get("code"),
            source="design",
            value_label=(design or {}).get("label"),
        )
    )

    fit = _fit_segment(catalog, cfg, part)
    if fit is not None:
        segments.append(fit)
    segments.append(_finish_segment(catalog, cfg))
    return segments


def _spec_segments(catalog: dict, cfg: PoleConfig, part: dict) -> list[Segment]:
    segments: list[Segment] = []
    codes = _codes(cfg, part["id"])
    for column in sorted(part.get("options") or [], key=lambda o: o.get("orderPosition", 0)):
        if _is_multi_select(column):
            continue
        if _is_family_column(column):
            first = (column.get("values") or [{}])[0]
            segments.append(
                Segment(
                    label=column.get("label", ""),
                    code=first.get("code"),
                    source="family",
                    value_label=first.get("label") or None,
                )
            )
            continue
        if _is_finish_column(column):
            segments.append(_finish_segment(catalog, cfg, column.get("label", "Finish")))
            continue
        code = codes.get(column["key"])
        value = next((v for v in column.get("values", []) if v["code"] == code), None)
        segments.append(
            Segment(
                label=column.get("label", ""),
                code=code,
                source="spec",
                value_label=(value or {}).get("label"),
            )
        )
    return segments


def _add_on_segments(cfg: PoleConfig, part: dict) -> list[Segment]:
    chosen = set(_add_ons(cfg, part["id"]))
    if not chosen:
        return []
    segments: list[Segment] = []
    for option in (part.get("ordering") or {}).get("options") or []:
        if option["code"] in chosen:
            segments.append(
                Segment(label="Options", code=option["code"], source="option",
                        value_label=option.get("label"))
            )
    for column in sorted(part.get("options") or [], key=lambda o: o.get("orderPosition", 0)):
        if not _is_multi_select(column):
            continue
        for value in column.get("values", []):
            if value["code"] in chosen:
                segments.append(
                    Segment(label=column.get("label", "Options"), code=value["code"],
                            source="option", value_label=value.get("label"))
                )
    return segments


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_part_number(catalog: dict, cfg: PoleConfig, part_id: str) -> PartNumber:
    """Resolve one component's WiLL part number (mirrors resolvePartNumber)."""
    part = _find_part(catalog, part_id)
    number = PartNumber(
        part_id=part_id,
        part_name=(part or {}).get("name", part_id),
        slot_label=_SLOT_LABELS.get((part or {}).get("slot", ""), "Component"),
        unavailable="Ordering matrix pending for this product.",
    )
    if part is None:
        return number

    has_matrix = bool(part.get("ordering"))
    has_spec = any(_is_family_column(o) for o in part.get("options") or [])
    if not has_matrix and not has_spec:
        return number

    segments = (
        _matrix_segments(catalog, cfg, part)
        if has_matrix
        else _spec_segments(catalog, cfg, part)
    )
    segments += _add_on_segments(cfg, part)

    number.segments = segments
    number.code = "-".join(s.code or UNSPECIFIED for s in segments)
    number.complete = all(s.code is not None for s in segments if s.source != "option")
    number.unavailable = None
    number.source = (part.get("ordering") or {}).get("source") or (
        part.get("optionsMeta") or {}
    ).get("source")
    number.parse_flagged = (
        not has_matrix and (part.get("optionsMeta") or {}).get("parseStatus") == "partial"
    )
    return number


def resolve_assembly_part_numbers(catalog: dict, cfg: PoleConfig) -> list[PartNumber]:
    """Every component's part number, in selection order (+ the banner accessory)."""
    numbers: list[PartNumber] = []
    for field_name in _NUMBERED_FIELDS:
        part_id = getattr(cfg, field_name, "")
        if part_id:
            numbers.append(resolve_part_number(catalog, cfg, part_id))
    if cfg.banner is not None and cfg.banner.armId:
        numbers.append(resolve_part_number(catalog, cfg, cfg.banner.armId))
    return numbers


def design_code_for(catalog: dict, cfg: PoleConfig, part_id: str) -> str | None:
    """The resolved Design segment for a part, e.g. ``SS3`` — None when unresolved.

    The Phase 0.10 CAD ingest keys real geometry off this: a configured design code
    selects Engineering's file for exactly that SKU (see app/realgeom.py).
    """
    number = resolve_part_number(catalog, cfg, part_id)
    for segment in number.segments:
        if segment.source == "design":
            return segment.code
    return None


def part_number_text(number: PartNumber) -> str:
    """One printable line — mirrors partNumbersText in src/lib/summary.ts."""
    if number.unavailable:
        return f"{number.slot_label}: {number.part_name} - part number pending matrix"
    if number.complete:
        return f"{number.slot_label}: {number.code}"
    n = number.unresolved
    return f"{number.slot_label}: {number.code} ({n} choice{'' if n == 1 else 's'} to complete)"
