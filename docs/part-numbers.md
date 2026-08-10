# WiLL part numbers (Phase 0.10, Workstream 0; frontend-only as of 0.10.5)

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

**Frontend-only as of 0.10.5.** The part number is resolved by exactly one place in the
codebase: `buildPartNumber` in `src/lib/summary.ts`. There is no `geometry-service` mirror —
an earlier `app/partnumber.py` resolver (kept in lockstep with the frontend by pinning both
test suites to the same expected strings) was deliberately dropped when the two divergent
0.10.5 source branches were combined, rather than carried forward and re-synced. This is a
known regression, not an oversight: generated STEP/DXF/IFC/PDF files and the download bundle
no longer carry the configured part number anywhere, and the geometry-service's `config_hash`
(`app/naming.py`) does not vary with `specOptions`/ordering-column choices — two configs that
differ only in a spec option (e.g. cord length) still resolve to the *same* cached CAD/PDF
files today. Restoring both (the Python resolver and the `config_hash` coupling) is tracked as
R1/R2 for Phase 0.11 — see `Phase 0.10.5 — Branch Combine, Carry-Forward & Open Decisions.md`
in the Design Assistant vault. Until then:

`buildPartNumber` applies:

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

## Where it surfaces (frontend)

- **Config summary sidebar** (`src/components/Summary.tsx`) — each configured part's row shows
  its own resolved part number (`summary-pn`) next to its name/finish swatch.
- **Config summary / quote request** (`buildSummaryText` in `src/lib/summary.ts`) — each part
  line is immediately followed by its own `Part No: …` line, and its selected spec-sheet
  options underneath that.
- **Output tray** — the "Part Numbers + Config" card (`src/components/OutputTray.tsx`) copies
  that same summary text to the clipboard for pasting into a project spec.

## Where it does NOT surface (known 0.10.5 regression, tracked for 0.11)

Because the Python resolver was dropped rather than carried forward (see "Resolution rules"
above), none of the geometry-service outputs know about part numbers:

- **Spec sheet / concept-card PDF** (`app/adapters/_spec_template.py`) — the components table
  has `Slot` / `Product` / `URL` columns only; there is no `Part Number` column.
- **STEP/DXF/IFC/download bundle** — files are named from `config_hash` + `configId`
  (`app/naming.py`), never from the configured part number. `app/realgeom.py`'s `CLUSTER_FILES`
  table (e.g. `SS3-40F.STEP`, a real multi-arm cluster file) is consequently unreachable: the
  design code that would select it is resolved only on the frontend now, and
  `app/kit/assembly.py`'s `_design()` always returns `None` (see its own Phase 0.10.5 comment).
  Every real-CAD part therefore falls back to its single-arm/base STEP file regardless of
  `armCount`.
- Restoring this (R1) together with coupling `specOptions` into `config_hash` so that two
  configs differing only in a spec-sheet option no longer share a cached file (R2) is deferred
  to Phase 0.11 — see `Phase 0.10.5 — Branch Combine, Carry-Forward & Open Decisions.md` in the
  Design Assistant vault.

## Cache correctness (as of 0.10.5 — see R2 above)

`app/naming.py`'s `config_hash` whitelist is `{pole, baseCover, arm, fixture, finish, armCount,
banner}` — it does **not** include `specOptions` (per-part ordering-column / options-and-
accessories selections). Those change the *printed* part number on the frontend but, today, two
configs that differ only in a spec option resolve to the same `config_hash` and can share a
cached geometry-service file. This was true before 0.10.5 too; it is not a regression introduced
here, but it compounds the part-number gap above and is why R1 and R2 are tracked together.

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

> **⚠ HAZARD — read before ever rerunning `scripts/merge-spec-options.mjs`:** it owns the
> `options` field and recomputes it *verbatim* from `docs/spec-options.json` (still polluted —
> the raw parser output was deliberately left alone, see above) on every run — that's what makes
> it idempotent against its own source. It is **not** idempotent against the hand edits above:
> rerunning it will silently revert `alum-pole-*`'s hand-fixed `design`/`length` columns (and the
> two older merges) back to the raw, polluted merged columns, with no error and nothing obviously
> wrong in a quick diff — `buildPartNumber`'s pole part numbers would just quietly start
> resolving from bad data again. This was already true before this task for the two older
> merges; it is not fixed here (would require either fixing the parser's column-clustering,
> which risks regressing sheets that already parse cleanly, or teaching the merge script to
> preserve hand-authored columns). If you must rerun it, re-apply the `design`/`length` hand-fix
> to `alum-pole-*` afterward. The same warning is repeated as a comment at the top of the script
> itself.

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
