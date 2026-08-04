# Phase 0.10 — Part numbers, Sternberg flow, geometry detail + real-CAD ingest

**Date:** 2026-08-04 · **Branch:** `phase-0.10` off `Dev` · **Specs:**
`Phase 0.10 — Sternberg Flow, Options & Geometry Detail.md`,
`WiLLstudio Ordering Matrix & Part Numbers.md` (vault), plus a mid-flight ask to ingest
Engineering's released WiLLstudio STEP set.

This records the decisions a reviewer would otherwise have to reverse-engineer.

## Workstream 0 — the part number is the product

**Decision: two data sources, one resolver, no invented codes.**

| source | covers | why |
|---|---|---|
| `docs/ordering-matrix.json` (transcribed once from Tyler's sheet) | WiLLstudio arms + the aluminium base cover | the sheet is the only place these codes exist |
| `docs/spec-options.json` (0.8 machine parse) | the 4 fixtures + decorative poles | already machine-derived; "never hand-transcribed" rule holds |
| neither | everything else (NAFCO, WiLLsport, curated covers) | resolves to `unavailable`, shown as "ordering matrix pending" |

Consequences worth knowing:

- **Fit is derived, not typed.** The host pole's shaft OD (or the mount socket's nominal OD) is
  matched against a fit table within a stated tolerance. This is what let the ingest *correct*
  the codes later (below) by changing one data field rather than editing strings.
- **Finish columns are not dropdowns.** The Finish step owns them; the resolver substitutes
  `FinishDef.code`. A pole's "Finish Type" (painted/anodized) is a different column and stays
  selectable — the reason `isFinishColumn` matches the `finish-color` prefix and not `finish`.
- **`?` beats a default.** Filling unchosen ordering columns with the sheet's first value would
  produce a spec-able-looking number nobody chose. Unresolved segments render `?` and the number
  is marked incomplete; the panel says how many choices remain.
- **A mirrored Python resolver** (`app/partnumber.py`) rather than passing numbers over HTTP:
  keeps the frozen `/generate` contract, and both suites pin the same literals so drift fails a
  test.
- **`partOptions` joins the config hash only when non-empty** — old configs keep their hashes,
  and two option sets can never share a cached PDF.

## Workstream A — arm family + count, and the 90° fix

The matrix's trailing digit *is* the arm count, so the UI is: pick the family (the arm card),
pick the count (chips showing the code each resolves), and the design code follows. Counts come
from `arrangements`, which `merge-ordering.mjs` now generates from the matrix — so the geometry
list and the codes cannot drift.

Two rules that needed code changes, not data:

- `allowedArmCounts` no longer force-adds `1`. A crossarm exists only as `CR2`, a fixed pair;
  offering "1 arm" invented a product with no code. `repairConfig` clamps to the family's first
  allowed count.
- `armAzimuths` is now a drilled-tenon table: `3 → [0,90,180]`, not `[0,120,240]`. The pole
  sheet's own drilling column carries both (`D3` = 3@120, `D6` = 3@90) and the arms matrix
  specifies 3@90. The 120°/240° render set (450 WebPs) is retired; the rig's angle list shrank
  to 0/90/180/270. Mirrored in `app/kit/assembly.py`, and `validate_config` now rejects an arm
  count the family cannot be ordered in (a 3-arm SH1 is a 422).

## Workstream A2/B/C — flow, options, banner

- **Sternberg flow** as a two-half step (choose → configure → Next) rather than a modal
  rewrite: same information architecture Tyler liked, far less churn, and it gave each step a
  natural home for that part's ordering columns.
- **Per-part selections** (`config.partOptions`) instead of the 0.8 fixture-only `specOptions`
  map — required by Workstream 0, since each component resolves its own number. Legacy links
  still work (`repairPartOptions` folds `specOptions` onto the fixture).
- **Base cover became an Option**, which means `''` is a real choice: `repairConfig` stops
  filling it in, `defaultConfig` sets it explicitly (so the default build is unchanged), and the
  share URL encodes `baseCover=none`.
- **Banner dimensions are derived, not new inputs.** Tyler asked to *label* the height and both
  bar distances; `src/lib/banner.ts` computes them from the part's geometry + the shaft height,
  so the labels always describe what is drawn. Count is capped at an opposite pair until Puddy
  confirms the true maximum (4 removed from `arrangements`, and a crafted 4-side link clamps).

## Workstream D — fixture geometry detail

Kit-side only (`app/kit/detail.py`): chamfered edges (flush transitions), a stepped-down lower
band on housing-sized boxes, filleted lathe-profile corners. Fixtures only — poles, covers, arms
and banner hardware build byte-identically to 0.9. Everything is size-gated (brackets and panels
keep sharp edges) and guarded (a failed fillet degrades to the plain solid).

Effect: 2-7× more faces per fixture, bbox within a few percent, volume within 5%. Cost: the fast
pytest suite went from ~7 min to ~14 min — the price of chamfering every fixture in every
geometry test.

## Mid-flight: the real-CAD ingest

Engineering's 26-file WiLLstudio STEP drop turned out to be **named by ordering code**
(`SS3-40F.STEP`), which made it both a geometry source and evidence about part numbers.

Decisions:

1. **Real CAD stays offline** (gitignored, as since 0.6). What ships is ~4 KB WebP layers plus
   the tracked `docs/real-geometry.json` provenance (sha256, mapping, unmapped files).
2. **14 parts now render from real CAD** (arms, pole, all three covers, banner, all four
   fixtures, bollard, flood). Base-cover identity (CL1/CL2/CL3 → round/aluminium/fluted) was
   settled by *looking at the renders*, not by guessing from dimensions — CL3's flutes are
   visible. Bollard/flood masters are modelled Z-up and needed a stand-up rotation.
3. **Real geometry corrected the catalog again** (the 0.6 pattern): SS1 and AR1 fixture sockets
   from the measured tube-end centres, banner bar centres to a symmetric ±0.625 m.
4. **The fit codes changed because of it.** Every released arm file is `-40F` (4" flush) and the
   released pole is a 4" OD straight, so the arm families now resolve fit from the host pole's
   shaft OD against the flush table: `WP-SS3-40F-BK`. The catalog's `tenon-3in` socket type is
   Phase-0 placeholder vocabulary, not an ordering code.
5. **Real B-reps are not used for assembly downloads by default.** Measured: a fixture master
   parses in 10-20 s, but fusing several real solids did not finish in 10 minutes (the kit fuses
   every placed part). So `REAL_GEOMETRY_IN_KIT` defaults off, and customers get real CAD two
   better ways: the viewer's layers ARE real geometry, and the zip ships
   `factory-cad/<part number>.step` — Engineering's own file for the configured SKU (only when
   the number is complete; a `?` number must never label a file).
6. **Render-rig shard bug fixed on the way past:** a partial `--parts` re-render wrote a
   separate `manifest-all.json`, which `merge-manifests.mjs` (alphabetical) then let
   `manifest-studio.json` overwrite. Partial runs now splice into the shard each part belongs
   to.

## Deliberately not done

- Real `.rfa` (still needs the Autodesk account), photometrics, pricing — all Phase 1+.
- `FH-4R`, `PH-4R`, `SC1-4R`, `SC2-4R`: real CAD with no confirmed catalog part. Recorded with
  their measured envelopes, not guessed into the catalog.
- The `upsweep` → `BR` family mapping and the DB/DG finish equivalences remain flagged
  assumptions (see `docs/part-numbers.md` "Open confirmations").
