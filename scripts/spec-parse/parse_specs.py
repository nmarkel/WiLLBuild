#!/usr/bin/env python3
"""
parse_specs.py  --  WiLLBuild Phase 0.8, Workstream D

Programmatically download each product's spec-sheet PDF and parse its
"Ordering Information" matrix into a structured option schema, written to
docs/spec-options.json.  The matrix is Tyler's source of truth for the
configurator dropdowns -- options are NEVER hand-transcribed.

URL scheme (confirmed):
    https://docs.willbrands.com/<spec-handle>.pdf
The <spec-handle> is USUALLY, but not always, the product handle from
willbrands.com/products/<product-handle>.  When it differs, we resolve the
real spec sheet by scraping the product page and picking the one
product-specific docs link (everything except a fixed set of generic docs).

Determinism: NO wall clock in the emitted JSON (extractedAt is always null).
Ordering is deterministic (reading order for values, sorted product keys).

Usage:
    python parse_specs.py                 # parse all handles in HANDLES
    python parse_specs.py --no-network    # cache-only (fail if a PDF missing)
    python parse_specs.py --handle willstudio-gvx-pendant   # single, prints JSON

Requires: pymupdf (fitz).  See requirements.txt.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # pymupdf

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / "cache"
OUT = ROOT / "docs" / "spec-options.json"

DOCS_BASE = "https://docs.willbrands.com"
PRODUCT_BASE = "https://willbrands.com/products"

# Product handles in Phase 0.8 scope (WiLLstudio products in play).
# spec_handle=None  ->  resolve from the product page (or try handle.pdf first).
HANDLES = [
    "willstudio-gvx-pendant",
    "willstudio-drx-post-top-area",
    "willstudio-tex-post-top-area",
    "willstudio-mvx-coach",
    "willstudio-decorative-aluminum-light-poles",
]

# Spec-handle overrides where the docs slug != product handle. Discovered by
# scraping each product page (the resolver reproduces this automatically; the
# map is kept for offline/deterministic runs and documentation).
SPEC_HANDLE_OVERRIDES = {
    "willstudio-gvx-pendant": "willstudio-gvx-pendant",
    "willstudio-drx-post-top-area": "willstudio-drx-area-post-top",
    "willstudio-tex-post-top-area": "willstudio-tex-area-post-top",
    "willstudio-mvx-coach": "willstudio-mvx-post-top",
    "willstudio-decorative-aluminum-light-poles": "willstudio-rsax-deco-poles",
}

# Generic docs linked on EVERY product page (warranty, wind maps, install
# guides, etc.). Anything left after removing these is the product spec sheet.
# Matched case-insensitively against the URL basename (URL-decoded).
GENERIC_DOC_BASENAMES = {
    "2010-fl-code-180-mph",
    "aashto-1994-wind-map",
    "aashto-2009-wind-map",
    "anchor-bolt-install-guide",
    "fixture-mounting-holes",
    "np-rsaa-wind-gust",
    "np-ssaa-wind-gust",
    "round_tapered_aluminum_poles_09_aashto_and_fbc_2010_20ft_50ft",
    "round_tapered_aluminum_poles_09_aashto_and_fbc_2010_8_25ft",
    "voltage-confirmation",
    "will anodizing advisory",
    "will led lighting maintenance guide",
    "will light pole maintenance guide",
    "will limited product warranty",
    "will terms & conditions of sale",
}

# Buildable finish mapping: spec-sheet WiLLcoat finish CODE -> catalog finish id
# for the 5 finishes that already exist as real catalog selections today
# (see CLAUDE.md).  These are the ONLY options marked buildable:true. Every
# other option stays buildable:null (pending Tyler/Cole confirmation).
# NOTE: BK/WH/NA are exact; DB->statuary-bronze and DG->forest-green are the
# nearest catalog equivalents (documented for Tyler/Cole sign-off).
FINISH_CODE_TO_CATALOG_ID = {
    "BK": "matte-black",       # Black
    "DB": "statuary-bronze",   # Dark Bronze  (nearest catalog bronze)
    "DG": "forest-green",      # Dark Green   (nearest catalog green)
    "WH": "gloss-white",       # White
    "NA": "silver",            # Nat Alum Silver
}

# A cell "code" token: short, upper-case-ish, alnum plus - / . Excludes header
# words like "(Model" and prose. Allows RAL, HSS-GVX, SRG27710, 90D, 5W, C, etc.
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9\-/.]{0,11}$")

# Section titles that split the ordering page into option groups.
GROUP_TITLES = [
    ("options-accessories", re.compile(r"Options\s*&\s*Accessories", re.I)),
]

# Page footer / boilerplate lines that must never be mistaken for matrix data.
FOOTER_RE = re.compile(
    r"willbrands\.com|Page:|Rev\.|©\d|Specifications subject|Brooke St|Fond du Lac",
    re.I,
)


# ---------------------------------------------------------------------------
# Networking / resolution
# ---------------------------------------------------------------------------
def _fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "willbuild-spec-parse/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def resolve_spec_handle(product_handle: str, allow_network: bool) -> tuple[str | None, list[str]]:
    """Return (spec_handle, warnings). Uses the override map first; otherwise
    scrapes the product page for the single non-generic docs.willbrands.com pdf."""
    warnings: list[str] = []
    if product_handle in SPEC_HANDLE_OVERRIDES:
        return SPEC_HANDLE_OVERRIDES[product_handle], warnings
    if not allow_network:
        warnings.append(f"{product_handle}: no override and --no-network; cannot resolve spec handle")
        return None, warnings
    try:
        html = _fetch(f"{PRODUCT_BASE}/{product_handle}").decode("utf-8", "replace")
    except Exception as e:  # pragma: no cover - network
        warnings.append(f"{product_handle}: product page fetch failed: {e}")
        return None, warnings
    links = set(re.findall(r'https?://docs\.willbrands\.com/([^"\' <>]+?)\.pdf', html))
    candidates = []
    for slug in sorted(links):
        base = urllib.parse.unquote(slug).lower()
        if base in GENERIC_DOC_BASENAMES:
            continue
        candidates.append(slug)
    if not candidates:
        warnings.append(f"{product_handle}: no product-specific docs link found")
        return None, warnings
    if len(candidates) > 1:
        # Prefer the candidate sharing the most tokens with the product handle.
        toks = set(product_handle.split("-"))
        candidates.sort(key=lambda s: -len(toks & set(s.lower().split("-"))))
        warnings.append(
            f"{product_handle}: multiple candidate spec sheets {candidates}; chose {candidates[0]}"
        )
    return candidates[0], warnings


def get_pdf(spec_handle: str, allow_network: bool) -> tuple[Path | None, list[str]]:
    warnings: list[str] = []
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{spec_handle}.pdf"
    if path.exists() and path.stat().st_size > 1000:
        return path, warnings
    if not allow_network:
        warnings.append(f"{spec_handle}.pdf not cached and --no-network")
        return None, warnings
    url = f"{DOCS_BASE}/{spec_handle}.pdf"
    try:
        data = _fetch(url)
    except Exception as e:  # pragma: no cover - network
        warnings.append(f"{spec_handle}: download failed ({url}): {e}")
        return None, warnings
    if not data[:5].startswith(b"%PDF"):
        warnings.append(f"{spec_handle}: {url} did not return a PDF")
        return None, warnings
    path.write_bytes(data)
    return path, warnings


# ---------------------------------------------------------------------------
# Matrix extraction
# ---------------------------------------------------------------------------
@dataclass
class Cell:
    code: str
    label: str
    x0: float
    x1: float
    y: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Column:
    header: str
    cx: float
    lo: float
    hi: float
    cells: list[Cell] = field(default_factory=list)


def _rows(words, y_tol=2.5):
    """Group pymupdf words [(x0,y0,x1,y1,text,...)] into rows by y."""
    ws = sorted(words, key=lambda w: (w[1], w[0]))
    rows = []
    cur = []
    cur_y = None
    for w in ws:
        if cur_y is None or abs(w[1] - cur_y) <= y_tol:
            cur.append(w)
            cur_y = w[1] if cur_y is None else cur_y
        else:
            rows.append((cur_y, sorted(cur, key=lambda x: x[0])))
            cur = [w]
            cur_y = w[1]
    if cur:
        rows.append((cur_y, sorted(cur, key=lambda x: x[0])))
    return rows


def _parse_cells_in_row(row_words) -> list[Cell]:
    """A row may hold several cells (one per column). A cell = <code> '=' <label...>
    where <code> matches CODE_RE. Segment left->right at each code that precedes '='."""
    toks = row_words
    n = len(toks)
    # index positions of "=" tokens
    eq_idx = [i for i, t in enumerate(toks) if t[4] == "="]
    # a cell-start is a token immediately followed by "=" and matching CODE_RE
    starts = []
    for i, t in enumerate(toks):
        if i + 1 < n and toks[i + 1][4] == "=" and CODE_RE.match(t[4]):
            starts.append(i)
    cells = []
    for si, i in enumerate(starts):
        code_tok = toks[i]
        # label tokens: after the "=" (i+2) until the next cell-start
        end = starts[si + 1] if si + 1 < len(starts) else n
        label_toks = toks[i + 2:end]
        label = " ".join(t[4] for t in label_toks).strip()
        x1 = max([code_tok[2]] + [t[2] for t in label_toks])
        cells.append(Cell(code=code_tok[4], label=label, x0=code_tok[0], x1=x1, y=code_tok[1]))
    return cells


def _cluster_headers(header_words, gap=22.0):
    """Cluster header words into columns by x-gap; return list of (label, cx, lo, hi)."""
    if not header_words:
        return []
    ws = sorted(header_words, key=lambda w: w[0])
    clusters = [[ws[0]]]
    for w in ws[1:]:
        prev = clusters[-1][-1]
        if w[0] - prev[2] > gap:
            clusters.append([w])
        else:
            clusters[-1].append(w)
    cols = []
    for c in clusters:
        c_sorted = sorted(c, key=lambda w: (w[1], w[0]))
        label = " ".join(w[4] for w in c_sorted).strip()
        lo = min(w[0] for w in c)
        hi = max(w[2] for w in c)
        cols.append((label, (lo + hi) / 2, lo, hi))
    return cols


def _slug(s: str) -> str:
    s = re.sub(r"\(.*?\)", "", s)  # drop parentheticals for the key
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "col"


def parse_ordering_page(pdf_path: Path) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    doc = fitz.open(pdf_path)
    page_idx = None
    for i, p in enumerate(doc):
        if "Ordering Information" in p.get_text():
            page_idx = i
            break
    if page_idx is None:
        return {"parseStatus": "failed", "sourcePage": None, "options": [],
                "exampleOrderCode": None, "notes": []}, ["no 'Ordering Information' page found"]

    page = doc[page_idx]
    words = list(page.get_text("words"))

    title_y = min((w[1] for w in words if w[4] == "Ordering"), default=0.0)
    # example order code line ("Ex: WD-...")
    example = None
    ex_bottom = title_y
    for y, row in _rows(words):
        txt = " ".join(t[4] for t in row)
        m = re.search(r"Ex:?\s*([A-Z0-9][A-Z0-9\-]{4,})", txt)
        if m and "-" in m.group(1):
            example = m.group(1)
            ex_bottom = max(ex_bottom, max(t[3] for t in row))
            break

    # group divider (Options & Accessories)
    divider_y = None
    for y, row in _rows(words):
        txt = " ".join(t[4] for t in row)
        for _, rx in GROUP_TITLES:
            if rx.search(txt):
                divider_y = y
                break
        if divider_y is not None:
            break

    # a "Note:" line marks the bottom of parseable matrix content
    note_y = None
    for y, row in _rows(words):
        if row and row[0][4].rstrip(":").lower() == "note" and y > ex_bottom:
            note_y = y
            break

    def region(top, bottom):
        w = [x for x in words if top < x[1] < (bottom if bottom else 1e9)]
        return w

    groups = []
    if divider_y is not None:
        groups.append(("ordering", ex_bottom, divider_y))
        groups.append(("options-accessories", divider_y, note_y))
    else:
        groups.append(("ordering", ex_bottom, note_y))

    all_options = []
    order_pos = 0
    for group_name, top, bottom in groups:
        reg = region(top, bottom)
        # cells first, to find where the header band ends
        cells = []
        for y, row in _rows(reg):
            cells.extend(_parse_cells_in_row(row))
        if not cells:
            warnings.append(f"{pdf_path.stem}: group '{group_name}' produced no cells")
            continue
        first_cell_y = min(c.y for c in cells)
        # Headers = words above the first cell row (the group-title row is already
        # excluded because regions start strictly below divider_y / example line).
        header_words = [w for w in reg if w[3] <= first_cell_y - 1 and w[4] != "="]
        cols = _cluster_headers(header_words)
        if not cols:
            warnings.append(f"{pdf_path.stem}: group '{group_name}' has no detectable headers")
            continue
        # set column bands from midpoints between header centers
        cxs = [c[1] for c in cols]
        columns = []
        for ci, (label, cx, lo, hi) in enumerate(cols):
            columns.append(Column(header=label, cx=cx, lo=lo, hi=hi))
        # assign each cell to nearest header by center-x
        for c in cells:
            best = min(range(len(columns)), key=lambda k: abs(columns[k].cx - c.cx))
            columns[best].cells.append(c)

        # continuation lines (rows with no cell) -> append to nearest cell above in same column
        cell_ys = {round(c.y, 1) for c in cells}
        for y, row in _rows(reg):
            if round(y, 1) in cell_ys:
                continue
            if y <= first_cell_y:
                continue
            if not row:
                continue
            if row[0][4].rstrip(":").lower() == "note":
                continue
            txt = " ".join(t[4] for t in row).strip()
            if not txt:
                continue
            if FOOTER_RE.search(txt):  # page footer / boilerplate, not matrix data
                continue
            rcx = (min(t[0] for t in row) + max(t[2] for t in row)) / 2
            col = min(range(len(columns)), key=lambda k: abs(columns[k].cx - rcx))
            above = [c for c in columns[col].cells if c.y < y]
            if above:
                above.sort(key=lambda c: c.y)
                above[-1].label = (above[-1].label + " " + txt).strip()

        for col in columns:
            if not col.cells:
                continue
            col.cells.sort(key=lambda c: (c.y, c.x0))
            key = _slug(col.header)
            is_finish = "finish" in key
            values = []
            for c in col.cells:
                buildable = None
                maps_to = None
                if is_finish and c.code in FINISH_CODE_TO_CATALOG_ID:
                    buildable = True
                    maps_to = FINISH_CODE_TO_CATALOG_ID[c.code]
                values.append({
                    "code": c.code,
                    "label": re.sub(r"\s+", " ", c.label).strip(),
                    "buildable": buildable,
                    "mapsTo": maps_to,
                    "note": None,
                })
            all_options.append({
                "key": key,
                "label": re.sub(r"\s+", " ", col.header).strip(),
                "group": group_name,
                "orderPosition": order_pos,
                "values": values,
            })
            order_pos += 1

    # ---- de-duplicate keys + detect parse anomalies (gaps) ----------------
    gaps: list[str] = []
    seen: dict[str, int] = {}
    for opt in all_options:
        base = opt["key"]
        if base in seen:
            seen[base] += 1
            opt["key"] = f"{base}-{seen[base]}"
            gaps.append(
                f"Duplicate column header '{base}' -> keyed as '{opt['key']}'. "
                f"Layout likely splits this option across sub-columns; needs human review."
            )
        else:
            seen[base] = 1
        # merged-header heuristic: a header that repeats a token indicates two
        # visually adjacent columns were clustered into one (e.g. TEX dual finish).
        toks = [t for t in re.split(r"[^a-z0-9]+", opt["key"]) if t]
        dupes = {t for t in toks if toks.count(t) > 1}
        if dupes:
            gaps.append(
                f"Column '{opt['key']}' header repeats token(s) {sorted(dupes)}; "
                f"adjacent columns were likely merged ({len(opt['values'])} values). Needs human review."
            )

    if all_options and not gaps:
        status = "ok"
    elif all_options:
        status = "partial"
    else:
        status = "failed"
    return {
        "parseStatus": status,
        "sourcePage": page_idx + 1,  # 1-based
        "exampleOrderCode": example,
        "options": all_options,
        "notes": [],
        "gaps": gaps,
    }, warnings


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def build(allow_network: bool, only: str | None):
    products = {}
    all_warnings = []
    handles = [only] if only else HANDLES
    for handle in handles:
        spec_handle, w = resolve_spec_handle(handle, allow_network)
        all_warnings += w
        entry = {
            "handle": handle,
            "specHandle": spec_handle,
            "sourcePdf": f"{DOCS_BASE}/{spec_handle}.pdf" if spec_handle else None,
            "sourcePage": None,
            "exampleOrderCode": None,
            "extractedAt": None,  # determinism: never a wall clock
            "parseStatus": "failed",
            "options": [],
            "notes": [],
            "gaps": [],
        }
        if spec_handle:
            path, w2 = get_pdf(spec_handle, allow_network)
            all_warnings += w2
            if path:
                parsed, w3 = parse_ordering_page(path)
                all_warnings += w3
                entry.update(parsed)
        products[handle] = entry

    doc = {
        "$comment": "Generated by scripts/spec-parse/parse_specs.py. Do not hand-edit. "
                    "extractedAt is intentionally null (repo determinism rule: no wall clock).",
        "urlScheme": f"{DOCS_BASE}/<spec-handle>.pdf",
        "generator": "scripts/spec-parse/parse_specs.py",
        "products": products,
    }
    return doc, all_warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true", help="cache-only")
    ap.add_argument("--handle", help="parse a single product handle and print JSON to stdout")
    ap.add_argument("--stdout", action="store_true", help="print result JSON to stdout instead of writing")
    args = ap.parse_args()

    doc, warnings = build(allow_network=not args.no_network, only=args.handle)

    text = json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if args.handle or args.stdout:
        sys.stdout.write(text)
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")

    if warnings:
        sys.stderr.write("\n".join(["WARNINGS:"] + [f"  - {w}" for w in warnings]) + "\n")


if __name__ == "__main__":
    main()
