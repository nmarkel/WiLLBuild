# The Drawing Contract

What every generated 2D drawing sheet guarantees, stated as checkable rules.
This exists so that "is the sheet right?" is settled here instead of re-argued
per drawing. Edits to this file are deliberate decisions — most rules are
pinned by tests (named below), so changing a rule means changing its test.

The sheet is a **concept drawing**, generated deterministically per config
(`app/drawing.py` + `app/adapters/_drawing_sheet.py`). Its readers are a
customer or spec engineer recognizing the product, an installer doing rough
planning, and WiLL order entry. It is not a submittal and says so on its face.

## Accuracy: every number has a tier, and the sheet admits which

| Tier | Meaning | Examples | Obligation |
|---|---|---|---|
| 1 — measured | dimensioned off the model geometry, so drawing and model cannot disagree | bolt circle in the anchor base detail; overall height | anything install-relevant lives here |
| 2 — declared | transcribed from the catalog / spec options | pole height, feature placements | keep the transcription pinned (contract fixtures) |
| 3 — defaulted or unmodelled | the model does not know it | wall thickness (modeled at thinnest), adjustable bolt-circle midpoint, festoon (no CAD) | MUST be flagged: a warning, an on-sheet note, or a blank field |

The failure mode to guard: a crisply drawn sheet makes tier-3 numbers look
like tier-1. **Never let render fidelity imply data fidelity.** Corollaries:
WEIGHT stays blank until real per-part weights exist; an unmodelled accessory
is omitted *with a warning*, never sketched from imagination; the adjustable
bolt circle says on the sheet that the midpoint is modeled.

## Detail: identity + function, arbitrated by WiLL's own spec sheets

A drafter draws what makes the part recognizable (flutes, silhouette, logo)
and what the reader acts on (hand hole, bolt circle, mounting interfaces),
and omits incidentals (fasteners, seams, facet noise). The acceptance test is
empirical, not aesthetic: **count distinct features against the official
sheet** (`docs.willbrands.com/<handle>.pdf`). As of 8/21: fixture 28 vs 22,
bracket 8 vs 9, base cover 13 vs 10, pole 10 vs 4-plus-anchor-base.

- Crease threshold is 24° — calibrated twice: the fixture gains nothing below
  32°, but the fluted clamshell's flutes need 24° to draw as continuous
  curves; 18° and below dredge decimation noise, so 24° is the floor.
  Raster resolution / step / bias are proven irrelevant to detail gaps
  (survival byte-identical from 20 px/in to 60 px/in) — do not re-tune them.
- **Print scale governs annotation; model space governs line work.** Text
  sizes and callout counts must be legible at the sheet's scale. Line-work
  completeness is not throttled by print scale — a DXF is zoomed in CAD.
- Detail the model lacks (GVX shell decimation, festoon CAD) is an ingest or
  data task. The drawing side never papers over it.
- No dedicated per-part detail views beyond the anchor base (Tyler 8/21) —
  the anchor base earns its own because a base cover correctly hides it in
  elevation.

## Annotation: features are drawn, named, and face-on

- Every feature riding on the pole is drawn whole (`feature_line_work` —
  deliberate crease loops, occluded only by strictly-nearer components, never
  by the feature's own host), carries a centre cross (`WILL-CENTER`), and
  gets a height callout **named in the dimension text** (`1'-3" HAND HOLE`),
  measured from the structure bottom, placed beside the elevation that shows
  the feature face-on. Pinned by `tests/test_anchor_base.py` +
  `tests/test_drawing.py`.
- The overall height reads `OVERALL HEIGHT`. Lengths ≥ 12" read
  feet-and-inches (`fmt_length`), rounding before the ft/in split.
- Dimensions are real DIMENSION entities that measure true (DIMLFAC carries
  the sheet scale; code 42 holds the paper distance). Never fudge a number to
  fit — move the text instead.

## Layout: a grammar decided once; content flexes, the frame doesn't

Template of record: the SolidWorks C-size sheet (ANSI C landscape, zone
borders, title block). Views hold fixed positions (iso far left unlabeled,
FRONT, SIDE, TOP; plan upper right); the title block sizes itself; views take
the first standard scale that fits.

- **Nothing overlaps.** Every text placement goes through the `_Occupancy`
  ledger, and the finished sheet passes a zero-padding intersection audit of
  every TEXT and rendered dimension-text box — pinned by
  `tests/test_dxf.py::TestNoTextOverlap`.
- When content and frame collide, the resolution order is mechanical:
  1. move the annotation (another lane; text longer than its dimension
     segment moves above the top extension line, running upward),
  2. step the scale,
  3. drop the least load-bearing annotation.
  Never redesign the sheet per config.
- Zone labels never print inside the title-block band (both the bottom-edge
  numbers and the side letters are skipped there).

## Determinism

Same config → byte-identical DXF (`pin_document` + fixed metadata; checked on
raw bytes because `ezdxf.readfile` fabricates header values). Both DXF routes
share `try_shell_sheet`, so on shell-covered configs `direct` and
`projection` are byte-identical.

## Open decisions (owner: Tyler)

1. **Tolerances** — the pole reference carries ±1.0 on feature heights. Is
   that universal for feature placements, and should the sheet print it?
2. **Units** — the references read decimal inches; the recorded 8/20 call is
   feet-and-inches at 12" and over. Ft-in stands until changed here.
3. **NOMINAL MOUNTING HEIGHT** — ours is an assembly overall height. A true
   mounting-height dim needs the mounting point defined on the assembly.
4. **Direct burial** — the reference dims from a GROUND LINE with NOMINAL
   EMBEDDED LENGTH and a WIRE ACCESS hole 18" below grade. Nothing below
   grade is modeled; needs the embedded-length data source, then modeling.
5. **Festoon** — no CAD. Cole's STEP, or an approved schematic symbol?
6. **Weight** — blank until per-part weights exist. What is their source?
