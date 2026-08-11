# WiLL part numbers (Phase 0.10, Workstream 0; restored to both sides in 0.11)

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

**Two implementations, one contract (restored in 0.11, Workstream Z1).**

- `buildPartNumber` in `src/lib/summary.ts` — the **reference implementation**. Everything the
  customer sees in the browser resolves here.
- `build_part_number` in `geometry-service/app/partnumber.py` — a faithful **mirror**, so every
  generated STEP/DXF/IFC/PDF and the download bundle carry the same number the customer saw.

0.10.5 dropped the Python side entirely (regression R1), leaving the number in the browser only
— which had been 0.10's whole point. 0.11 re-adds it *cleanly*: the restored module mirrors
Tyler's surviving `buildPartNumber`, not 0.10's deleted `partNumber.ts`. 0.10's resolver read
`config.partOptions` and `catalog.parts[].ordering`, a data model that no longer exists, so
reviving it verbatim would have resolved against dead fields.

**The drift guard.** Two implementations of one customer-facing SKU rot silently, so neither
language owns the expectations: `docs/part-number-cases.json` holds a shared set of
(config → expected number) cases that **both** suites read —
`src/lib/partNumber.contract.test.ts` and `geometry-service/tests/test_partnumber.py`. Change
the rules in one language and the other language's suite fails until they are brought back into
step. Regenerate deliberately with
`UPDATE_PN_CASES=1 npx vitest run src/lib/partNumber.contract.test.ts`, then read the diff —
every changed line is a changed part number. One case is anchored to the GVX sheet's own
published ordering example (`WD-GVX-80-30-MV-5W-BK`) rather than to our own output, so the
fixture is not purely self-referential.

**Plumbing that had to be fixed first.** The browser POSTs the whole config object, but
`app/models.py`'s `PoleConfig` never declared `specOptions`, `finishes`, `finishRal`,
`armOrientation` or `accessoryPlacements` — pydantic silently dropped all five. That is *why*
no ordering selection or per-slot finish could reach a generated file. All five are now
declared and optional, so an older client produces byte-identical output.

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

## Where it surfaces (geometry-service — restored in 0.11)

- **Spec sheet / concept-card PDF** (`app/adapters/_spec_template.py`) — the components table
  now carries a `Part Number` column, set **bold** and placed right after the slot, ahead of the
  product name: it is the string a designer copies into a project spec. A component with no
  published ordering sheet prints `-`, never a fabricated code. A number still carrying an
  unanswered ordering column (`_`) is footnoted so an incomplete spec cannot pass for orderable.
- **Download bundle** (`app/adapters/bundle_adapter.py`) — `summary.txt` prints each component's
  own `Part No:` line under it, plus its own finish when the assembly is not all one colour.
- **Per-component finish** (Phase 0.11 Workstream A) flows through the same resolver: each
  slot's finish drives that component's own finish segment (and its `finish-type` FP/AN
  segment), in the generated files, not just the browser summary.

### The customer download, and the allowlist that gates it

`factory-cad/<part number>.step` is back in the bundle (Phase 0.11, Workstream I) — but only for
components whose **de-featured shell** has been confirmed. Today that is exactly one:
`gvx-pendant` → `GVX-Simple.STEP` (Cole's simplified export, confirmed by Nick 2026-08-10). A
fully-specified GVX therefore ships as `factory-cad/WD-GVX-80-30-MV-5W-BK.step`.

The gate is `CUSTOMER_STEP_FILES` in `app/realgeom.py`, resolved through `customer_step_path()`,
and it is deliberately a **separate table from `BASE_FILES`** rather than a flag on it:

- `BASE_FILES` holds Engineering's **full masters** (`WD-GVX-PM` is 88 MB of internal detail).
  Those drive the viewer and the kit. They must never leave the building.
- `CUSTOMER_STEP_FILES` holds only what is cleared to ship. It is **fail-closed**: a new real
  STEP does not become downloadable just by existing, and `customer_step_path()` has **no
  fallback** to the master.

That distinction is the whole lesson of the regression: Phase 0.10 resolved the attachment from
"any part with real CAD", which is why the entire feature had to be dropped in 0.10.5 rather than
patched. A component with real CAD but no cleared shell (DRX, TEX, MVX, the poles, the base
covers) attaches nothing. An **incomplete** part number also attaches nothing — `WD-GVX-_-_-…`
would label a file with a SKU that does not exist. `geometry-service/tests/test_partnumber.py`
(`TestCustomerDownloadGate`) pins all of this, including that the allowlist is a strict subset of
`BASE_FILES` and never points at the same file as the viewer master.

`app/kit/assembly.py`'s `_design()` still returns `None`, so `app/realgeom.py`'s `CLUSTER_FILES`
table (e.g. `SS3-40F.STEP`) remains unreachable and a real-CAD part falls back to its
single-arm/base STEP regardless of `armCount`. The design code needed to select it is now
resolvable on the Python side again, so this is no longer *blocked* — it is simply not wired,
and is out of 0.11's scope.

## Cache correctness (fixed in 0.11 — Workstream Z2, coupled to Z1)

`app/naming.py`'s `config_hash` whitelist was `{pole, baseCover, arm, fixture, finish, armCount,
banner}`. It now also includes:

- **`specOptions`** — the ordering-column and options/accessories selections that resolve the
  part number. Without this, two configs differing only in (say) cord length hashed identically
  and the second was served the first's cached PDF — **showing the wrong part number**. That is
  why Z1 and Z2 had to ship together: restoring the number onto the sheet without this makes the
  cache actively wrong rather than merely incomplete.
- **`finishes`** — the per-slot finish overrides, for the same reason.

Both are included **only when non-empty**, so every config predating them keeps its historical
hash byte-for-byte and existing caches stay valid. Multi-select code order is deliberately *not*
normalised: the part number appends codes in stored order, so two configs with the same codes in
a different order genuinely print different numbers and must hash apart.

`armOrientation` and `accessoryPlacements` round-trip through the model but are deliberately
**excluded** — they reach no generated artifact yet, so hashing them would only fragment the
cache. Add them in the same commit that makes an adapter read them.

## TEX: two finish segments (Phase 0.12)

TEX is the first sheet in the catalog whose part number carries **two** finish
codes — Housing, and Spider Mount & Accent Line:

```
WD-TEX-[Lumen]-[CCT]-[Voltage]-[Dist]-[Mount]-[Housing]-[Accent][-Options]
WD-TEX-80-30-MV-5W-3T-NA-BK          <- the sheet's own ordering example
```

The sheet is explicit that this is not optional: *"For side mount fixtures, the
mounting arm will match the housing color. Accent line finish designation is
still required."* So the accent segment appears on `SMS`/`SMR` too, and never
resolves to `_`.

- **Config axis:** `PoleConfig.accentFinishes`, keyed by slot, exactly parallel
  to `finishes`. An unset accent falls back to that slot's own finish, the way an
  unset slot finish falls back to the base `finish` — a default, not a fabricated
  choice, because the fallback value is a colour the customer really picked.
- **Which parts have one is DATA:** `hasAccentFinish(part)` looks for the
  `finish-color-accent` ordering column. There is no part-id list, so a second
  two-finish sheet needs no code change.
- **Resolution order matters.** `finish-color-accent` also matches the generic
  `finish-color` prefix, so both resolvers test the accent key FIRST. Reverse
  them and both columns silently resolve to the housing colour — which is
  exactly the bug 0.12 found in the shipped catalog.
- **Cache:** `accentFinishes` is in `config_hash` (see below). Two TEX configs
  differing only in accent print different numbers, so they must not share a
  cached PDF.
- **`5VN` is deliberately not encoded.** It appears in the sheet's lumen tables
  but not in its ordering matrix, so orderability is unconfirmed (Tyler/Cole).
  `src/lib/texPartNumber.test.ts` pins its absence *and* `5N`'s presence, so
  neither can drift in by accident.

The sheet also merged its **Design** column into **Lumen Output**. One column can
only ever emit one segment, so before 0.12 the number lost whichever the customer
did not pick — `WD-80-…` with a lumen chosen, `WD-TEX-…` with none. GVX, DRX and
MVX all already carried a separate `design` column; TEX was the only sheet
missing one. Both defects are corrected declaratively — see below.

## Known spec-parse artifacts (now corrected declaratively)

**Phase 0.12** moved these out of hand-edited `public/catalog.json` and into
`docs/spec-option-corrections.json`, applied by
`scripts/apply-spec-option-corrections.mjs` (and by `merge-spec-options.mjs`
during a regeneration). Each rule names the merged column and the reviewed
columns it splits into; a rule that can neither find its `rawKey` nor confirm it
is already applied throws, so a re-parse cannot silently un-fix a SKU.
`src/lib/specOptionCorrections.test.ts` pins the shipped catalog to that file.

No value in it is invented: the pole columns were lifted verbatim from the
already-reviewed catalog, and the TEX columns re-partitioned from the raw parse.

> **⚠ Still not a full regeneration.** The corrections cover the parser's column
> *merges* only. `public/catalog.json` carries further deliberate curation that
> lives nowhere else — `gvx-pendant`'s `mounting` column is removed (pendant mount
> rides as the `PM` option code), the `alum-pole-*` options/accessories value
> lists are hand-trimmed, and `merge-ordering.mjs` separately owns `options` on
> the arms and base covers. Running `merge-spec-options.mjs` alone still discards
> those. Bringing them into the corrections file is worthwhile follow-up work and
> was deliberately left undone in 0.12. Until then, prefer
> `apply-spec-option-corrections.mjs`, which only performs the substitutions and
> is safe against the live catalog.

## Coming Soon parts resolve to no number (Phase 0.12, Workstream D)

A part still rendering from placeholder geometry produces **no** part number, in
both languages (`isComingSoon` / `_is_coming_soon`). The resolver's output is
precisely what a designer pastes into a project spec, so a spec-able-looking SKU
for a product that cannot be built is the one thing that must not escape. The
generated PDF and bundle print `-` for it.

## Historic spec-parse detail (why the merges happen)

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

> **Historic note.** Until Phase 0.12 this section carried a HAZARD warning: the
> merge script recomputed `options` verbatim from the raw parse on every run, so
> re-running it silently reverted the `alum-pole-*` `design`/`length` hand-fixes
> and pole part numbers quietly started resolving from polluted data again. That
> specific trap is closed — those fixes are declarative now (above) and the merge
> script applies them. The narrower caveat that remains is the curation callout
> above, which is a known gap rather than a silent one.

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
