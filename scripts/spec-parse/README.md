# spec-parse — spec-sheet ordering-matrix parser (Phase 0.8, Workstream D)

Downloads each product's spec-sheet PDF from `docs.willbrands.com`, locates the
**Ordering Information** matrix (~page 3 of the fixture sheets), and extracts its
columns → a structured option schema written to `docs/spec-options.json`.

Product options are **driven by the spec sheets, never hand-transcribed**
(Tyler's requirement). Each matrix column becomes a configurator choice; the
valid cell values become the dropdown options.

## Setup

```bash
python3 -m venv scripts/spec-parse/.venv
scripts/spec-parse/.venv/bin/pip install -r scripts/spec-parse/requirements.txt
```

This is a **dedicated** venv — do NOT install these packages into
`geometry-service/.venv`.

## Run

```bash
# Parse all in-scope handles → docs/spec-options.json (downloads + caches PDFs)
scripts/spec-parse/.venv/bin/python scripts/spec-parse/parse_specs.py

# Cache-only (fails if a PDF isn't already in cache/)
scripts/spec-parse/.venv/bin/python scripts/spec-parse/parse_specs.py --no-network

# Inspect one product (prints JSON to stdout, does not write the file)
scripts/spec-parse/.venv/bin/python scripts/spec-parse/parse_specs.py --handle willstudio-gvx-pendant
```

Then inject the result into the catalog (owns only the `options` field):

```bash
node scripts/merge-spec-options.mjs                    # writes public/catalog.json
node scripts/merge-spec-options.mjs --catalog /tmp/x   # write elsewhere (safe testing)
node scripts/merge-spec-options.mjs --dry-run          # report only
```

## URL scheme

Spec sheets live at `https://docs.willbrands.com/<spec-handle>.pdf`. The
`<spec-handle>` is usually — but **not always** — the product handle from
`willbrands.com/products/<product-handle>`. When it differs, `parse_specs.py`
resolves the real sheet by scraping the product page and picking the single
product-specific docs link (everything except a fixed set of generic docs:
warranty, wind maps, install guides, etc.). Known overrides are also hard-coded
in `SPEC_HANDLE_OVERRIDES` for deterministic offline runs.

## How the matrix parser works

1. Find the page containing "Ordering Information".
2. Read word bounding boxes (`pymupdf`).
3. A cell = `<CODE> = <label...>` where `<CODE>` matches a short code pattern.
   Rows are segmented left→right at each code that precedes `=`.
4. Column **headers** are the words above the first cell row; they are clustered
   by x-gap. Each cell is assigned to the nearest header by center-x (robust to
   cells whose code is not left-aligned, e.g. wide wrapped option descriptions).
5. Wrapped continuation lines (no `=`) are appended to the cell above in the
   same column; page footer/boilerplate and `Note:` lines are excluded.
6. Finish codes matching the 5 real catalog finishes are flagged
   `buildable: true` (see `FINISH_CODE_TO_CATALOG_ID`); everything else stays
   `buildable: null` pending Tyler/Cole confirmation.

## Determinism

No wall clock is written anywhere (`extractedAt` is always `null`). Output keys
are sorted; value order follows PDF reading order (stable). Re-running produces
byte-identical `docs/spec-options.json`.

## Parse quality

`GVX` (the Phase 0.8 representative product) parses cleanly (`parseStatus: "ok"`).
Sheets with more complex layouts (two-piece TEX with dual finish columns,
two-column option lists, the very wide pole matrix) parse to `parseStatus:
"partial"` with a `gaps[]` list flagging exactly which columns need a human to
eyeball the PDF. Nothing is fabricated: flagged columns still carry their
extracted values, just marked for review. See `docs/spec-options.md`.
