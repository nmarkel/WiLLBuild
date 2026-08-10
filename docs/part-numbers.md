# WiLL part numbers (Phase 0.10, Workstream 0)

The configured **part number is the configurator's primary output**. Per Tyler (8/3): a
designer drops the WiLL SKU into their project spec, it becomes the basis of design, and
substitution gets hard. Renders/CAD/spec sheets support that number; the number is the
demand-capture artifact.

```
[Product Family] - [Design] - [Pole/Tenon Fit] - [Finish] [- Options]
WP - SS3 - 40F - BK
```

Every component resolves **its own** number; the configurator's output is the complete set
for the assembly (fixture, arm, pole, base cover, banner accessory).

## Where the codes come from

| source | what it covers | file |
|---|---|---|
| WiLLstudio arms + base-cover matrix (transcribed once, from the sheet Tyler supplied) | family `WP`, design codes per arm count, fit tables, `CF*` options | `docs/ordering-matrix.json` → merged into `public/catalog.json` by `scripts/merge-ordering.mjs` |
| Machine-parsed spec sheets (Phase 0.8 D) | the 4 WiLLstudio fixtures + the decorative poles: every ordering column, in sheet order | `docs/spec-options.json` → `catalog.parts[].options` |
| Engineering's released CAD filenames (Phase 0.10 ingest) | evidence for the fit segment, and the design→file mapping for downloads | `docs/real-geometry.json` |

**Nothing is invented.** A product with neither a transcribed matrix nor a parsed sheet
resolves to *no* part number (`unavailable`), surfaced as "ordering matrix pending" — never a
plausible-looking guess. Today that is every NAFCO/WiLLsport part and the curated
fluted/round base covers.

## Resolution rules

Both resolvers — `src/lib/partNumber.ts` (app) and `app/partnumber.py` (service, a mirror
pinned by the same expected strings in both test suites) — apply:

1. **Family** — `ordering.family` (`WP`), or the sheet's `product-family` column (`WD` for
   fixtures).
2. **Design** — for arm families the *arm count* selects it (Side Shepherds Hook + 3 → `SS3`).
   Where several designs share a count (upsweep 24" vs 36" → `BR12`/`BR13`) the customer picks
   and the segment stays `?` until they do.
3. **Pole/Tenon fit** — derived, never typed: the host pole's shaft OD (or the mount socket's
   nominal OD) is matched against a fit table within `fitToleranceIn`. On the released 4" OD
   WiLLstudio pole the arms resolve `40F`, which is exactly what Engineering's own filenames
   say (`SS3-40F.STEP`, `AR2-40F.STEP`).
4. **Finish** — always the assembly finish (`FinishDef.code`: BK/DB/DG/WH/NA). Sheet
   "Finish Color" columns are therefore *not* offered as dropdowns — the Finish step owns
   them. (A pole's separate "Finish Type" column — painted vs anodized — IS a real choice and
   stays selectable.)
5. **Options** — the multi-select field appends codes in matrix order (`…-BK-CF1-CF2`).

Unresolved required segments render as `?` and mark the number **incomplete**, with a count of
what is left to choose. An incomplete number never looks spec-able.

## Where it surfaces

- **Panel** — a `WiLL Part Numbers` card under the build steps (copy-all, per-segment
  breakdown), plus a live chip on each step header.
- **Config summary / quote request** — the summary text now *leads* with the part numbers.
- **Spec sheet + concept card (PDF)** — "Part Number" is a first-class column in the
  components table, bold, with a footnote explaining `?`.
- **Download bundle** — `factory-cad/<part number>.step` is Engineering's own released CAD for
  that SKU, when it exists.

## Cache correctness

`partOptions` (per-part ordering selections) changes the printed numbers but not the geometry,
so it joins the config hash **only when non-empty** — old configs keep their historical hashes
byte-for-byte, while two configs that differ only in options can never share a cached PDF.

## Known spec-parse artifacts (fixed in the catalog, not the parser)

`scripts/spec-parse/parse_specs.py` locates ordering-table columns purely from PDF word
x-coordinates (`_cluster_headers`'s 22pt gap heuristic, then nearest-centroid cell assignment).
On the decorative-pole sheet this produces two multi-column merges the parser itself already
flags as `gaps` needing human review — `length-pole-base-pole-top-wall-od-od-thickness` and
`anchor-bolts-base-type-finish-type` — plus a third, unflagged defect: the `design` column's
own header cluster sits close enough to the `Length` column's cells that some of them (and a
stray `Wall Thickness` "Custom" cell) get assigned to `design` by nearest-centroid distance
instead. None of the three is a one-line regex fix — they're specific to this sheet's unusual
two-line "Length (Above Grade)" header and the resulting cluster geometry — and the sheet's own
parser already treats the first two as expected, flagged debris rather than something to
special-case in the generic clustering code.

The established fix (commit `dbf26aa4`, for the first merge) is a direct, hand-authored
`catalog.parts[].options` edit rather than a parser change: replace the polluted column with a
clean one, sourced from the same PDF but assembled by hand. This task follows that precedent for
the third defect:
- `design`'s values were trimmed to the 3 real design codes (`RSAA`, `RSAD`, `C`), dropping the
  leaked length/wall-thickness cells.
- A `length` ordering column (position 1.5, between `design` and `pole-diameter`) was added with
  the 8 real height codes.
- `buildPartNumber` resolves both from the *part* now, not from `chosen`/`opt.values` matching:
  `part.designCode` (new `CatalogPart` field, `"RSAA"` on every `alum-pole-*` part — they're all
  the anchor-base mount variant, confirmed by their own `anchor-bolts` column being fixed to
  `AB`) and `part.heightFt`. Neither is a customer choice — which pole you pick already answers
  both — so both keys were also added to `Panel.tsx`'s `IMPLIED_COLUMNS` to keep them out of the
  "Base configuration" dropdowns (mirroring how `design`/`finish-type` were already hidden).

Caveat: `scripts/merge-spec-options.mjs` owns the `options` field and recomputes it verbatim from
`docs/spec-options.json` (still polluted — the raw parser output was deliberately left alone, see
above) every time it runs. It is idempotent against its own source but **not** against these
hand edits: rerunning it would silently revert `design`/`length` (and the two older merges) back
to the raw merged columns. This was already true before this task for the two older merges; it
is not fixed here (would require either fixing the parser's column-clustering, which risks
regressing sheets that already parse cleanly, or teaching the merge script to preserve
hand-authored columns) — flagged for whoever next touches this pipeline.

## Open confirmations

- `DB → statuary-bronze` and `DG → forest-green` finish equivalences are inferred (see
  `docs/spec-options.md`); `catalog.finishesProvisional` is still `true`.
- The curated "Decorative Upsweep" wizard arm is mapped to the sheet's `BR` (Upsweep, No
  Gusset) family, with `HSX` taking `HS` — confirm with Tyler/Cole.
- Fluted/round base-cover design codes are not on the supplied sheet. `docs/ordering-matrix.json`
  originally assigned `CL2` ("Two-piece aluminum base cover") to the dropship
  `aluminum-light-pole-base-covers` product, but that collided with the machine-parsed 8/4 spec
  sheet and the real-CAD ingest (`docs/real-geometry.json`), which both confirm `CL2` = Medium
  Clamshell = the catalog's `bc-cl2-medium-clamshell` wizard base cover (with `CL1`/`CL3` as the
  small/large siblings — one family in three heights). The `CL2` assignment on
  `aluminum-light-pole-base-covers` was a transcription error and has been removed from the
  matrix (moved to `unmapped`) rather than guessed at — that product's own design code, if any,
  is still unconfirmed and it resolves to no part number until Tyler/Cole supply one.
- Wall Mount (`WM1/WM2`) and Pendant Ceiling Mount (`PC1-3`) are on the sheet but have no
  catalog part yet.
