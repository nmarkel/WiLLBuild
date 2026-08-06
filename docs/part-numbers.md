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

## Open confirmations

- `DB → statuary-bronze` and `DG → forest-green` finish equivalences are inferred (see
  `docs/spec-options.md`); `catalog.finishesProvisional` is still `true`.
- The curated "Decorative Upsweep" wizard arm is mapped to the sheet's `BR` (Upsweep, No
  Gusset) family, with `HSX` taking `HS` — confirm with Tyler/Cole.
- Fluted/round base-cover design codes are not on the supplied sheet; only the aluminium cover
  has one (`CL2`). The real CAD (`CL1`/`CL2`/`CL3`) suggests one family in three heights.
- Wall Mount (`WM1/WM2`) and Pendant Ceiling Mount (`PC1-3`) are on the sheet but have no
  catalog part yet.
