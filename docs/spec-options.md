# Spec-sheet ordering options (Phase 0.8, Workstream D)

Product configurator options are **driven by each product's spec-sheet ordering
matrix** (Tyler's requirement) — never hand-transcribed. This pipeline downloads
the spec PDFs, parses the "Ordering Information" matrix, and produces a
structured option schema that drives the configurator dropdowns + validation.

- Parser: `scripts/spec-parse/parse_specs.py` (+ its own venv / requirements / README)
- Output: `docs/spec-options.json` (generated; do not hand-edit)
- Merge into catalog: `scripts/merge-spec-options.mjs` (idempotent; owns only the `options` field)

## URL scheme

```
https://docs.willbrands.com/<spec-handle>.pdf
```

`<spec-handle>` is usually — but **not always** — the product handle from
`willbrands.com/products/<product-handle>`. Only GVX matched directly; the other
four in-scope products use a different docs slug. The parser resolves the real
sheet by scraping the product page and removing a fixed set of generic docs
(warranty, wind maps, install guides, maintenance guides, etc.); the single
remaining product-specific link is the spec sheet. Discovered mapping:

| Product handle                                | Spec-sheet handle (docs.willbrands.com)   |
|-----------------------------------------------|-------------------------------------------|
| `willstudio-gvx-pendant`                      | `willstudio-gvx-pendant`                  |
| `willstudio-drx-post-top-area`                | `willstudio-drx-area-post-top`            |
| `willstudio-tex-post-top-area`                | `willstudio-tex-area-post-top`            |
| `willstudio-mvx-coach`                         | `willstudio-mvx-post-top`                 |
| `willstudio-decorative-aluminum-light-poles`  | `willstudio-rsax-deco-poles`              |

`docs.willbrands.com` returns HTTP **500** (not 404) for a missing file — so a
wrong guess looks like a server error, not a clean miss. The parser verifies the
response body starts with `%PDF` before caching. *(machine-verified: all 5 URLs
return 200 + real PDF)*

## Sheets parsed (Phase 0.8 scope)

| Product | Ordering page | Status | Option groups | Values | Buildable | Gaps |
|---|---|---|---|---|---|---|
| willstudio-gvx-pendant | p.7 | **ok** | 10 | 53 | 5 | 0 |
| willstudio-drx-post-top-area | p.7 | partial | 11 | 60 | 5 | 1 |
| willstudio-tex-post-top-area | p.7 | partial | 9 | 61 | 10 | 1 |
| willstudio-mvx-coach | p.8 | partial | 11 | 61 | 5 | 1 |
| willstudio-decorative-aluminum-light-poles | p.11 | partial | 9 | 114 | 5 | 3 |

**Total: 349 option values across 5 products; 30 flagged buildable, 319 pending.**
*(all machine-verified: numbers emitted by the parser and cross-checked from
`docs/spec-options.json`)*

## GVX ordering matrix (the Phase 0.8 representative product — machine-verified clean)

Example order code: `WD-GVX-80-30-MV-5W-BK-PM`

**Group `ordering` (the main matrix — one column per hyphen-segment of the order code):**

| key | label | values (code = label) |
|---|---|---|
| `product-family` | Product Family | WD = WiLLstudio® |
| `design` | Design | GVX = Medium Housing · CW = Custom |
| `lumen-output` | Lumen Output | 40 = 6,000 · 80 = 10,800 · 115 = 15,200 · 155 = 19,600 · CW = Custom, Amber & RGB |
| `color-temp` | Color Temp | 30 = 3000K, 70 CRI · 40 = 4000K, 70 CRI · 50 = 5000K, 70 CRI · PCA = PC Amber (590 nm) · TA = True Amber (593 nm) · CT = Custom & RGB |
| `voltage` | Voltage | MV = 120-277V · HV = 277-480V · CV = Custom |
| `distribution` | Distribution | 1S = Type I Short · 2M = Type II Medium · 3M = Type III Medium · 3W = Type III Wide · 4M = Type IV Medium · 5W = 150° Type V Square · 5M = 90° Type V Medium · 5N = 70° Type V Narrow · CD = Custom |
| `finish-color` | Finish Color | **BK = Black** · **DB = Dark Bronze** · **WH = White** · **NA = Nat Alum Silver** · LG = Light Gray · SG = Slate Gray · **DG = Dark Green** · DP = Dark Platinum · GM = Graphite Metallic · RAL = Custom RAL Match · C = Custom |

**Group `options-accessories` (suffix add-ons):**

| key | label | values |
|---|---|---|
| `mounting` | Mounting | PM = Pendant Mount · CM = Custom |
| `options` | Options | WHP3NP/WHP7NP/WHP11NP/WHP15NP = 2'/6'/10'/14' Cord w/o Plug · SRG27710/SRG48010 = 10kA Surge Suppressor · BPC1/BPC3/BPC4 = Button Photocontrol · MPS = Programmable Motion Sensor · 90D = 90° Optics Rotation |
| `accessories` | Accessories | HSS-GVX = House Side Shield · GFX = Wireless DMX Control · GFM = Wireless Mesh Control |

**Bold** finish codes are flagged `buildable: true` (see next section).

## Buildable vs quote-only flag

The spec asks whether every matrix option is buildable in the configurator or
some are quote-only. **This needs Tyler/Cole sign-off — it cannot be inferred
from the PDF.** Convention applied by the parser:

- Every option value defaults to **`buildable: null`** = *pending confirmation*.
- **Exception:** finish codes that map to the 5 finishes that already exist as
  real catalog selections today are set **`buildable: true`** with a `mapsTo`
  catalog finish id:

  | Spec code | Spec label | `mapsTo` catalog finish | Confidence |
  |---|---|---|---|
  | `BK` | Black | `matte-black` | exact |
  | `WH` | White | `gloss-white` | exact |
  | `NA` | Nat Alum Silver | `silver` | exact |
  | `DB` | Dark Bronze | `statuary-bronze` | **inferred (nearest bronze)** |
  | `DG` | Dark Green | `forest-green` | **inferred (nearest green)** |

**Phase 0.10 update:** the UI no longer shows a "quote" flag on option values (Tyler, 8/3 —
Round 4 reversed 0.8's flagging). The `buildable` field stays in the data as the record of what
is confirmed, but the configurator presents every sheet option plainly and the Options field is
multi-select. See `docs/part-numbers.md`.

The UI can gate `buildable !== true` behind "Request a quote". `DB→statuary-bronze`
and `DG→forest-green` are best-guess equivalences and should be confirmed with
Tyler/Cole (the exact WiLLcoat↔catalog finish correspondence is unconfirmed —
`catalog.finishesProvisional` is already `true`).

TEX reports 10 buildable because it is a two-piece fixture whose sheet lists the
5 finishes **twice** (Housing + Spider Mount) — see the gap note below.

## Known gaps (needs-human-open — NOT fabricated)

GVX parses cleanly. The other four sheets have layout variations that the
generic parser flags as `parseStatus: "partial"` with a `gaps[]` list rather than
guessing. All extracted values are still present; the gaps mark columns a human
should eyeball against the PDF:

- **willstudio-tex-post-top-area** — TEX is a two-piece fixture; the sheet has
  **two** "Finish Color" columns ("(Housing)" and "(Spider Mount & Accent
  Line)"). The parser merged them into one 20-value column
  `finish-color-finish-color-spider-mount`. A human should split these into two
  finish options (housing finish vs spider/accent finish). *(needs-human-open)*
- **willstudio-drx / -mvx** — the suffix Options list is laid out in two physical
  columns under one "Options" header; the parser emits `options` + `options-2`.
  These are logically one option group and can be concatenated. *(needs-human-open)*
- **willstudio-decorative-aluminum-light-poles** — the pole matrix is very wide
  (dimensions, anchor bolts, base/finish type, fixture mounting). Several
  headers merged (`length-pole-base-...-thickness`, `anchor-bolts-base-type-finish-type`)
  and the options list split (`options`/`options-2`). Treat pole options as a
  first-draft extraction; a human should verify column boundaries. *(needs-human-open)*

Each gap is recorded per-product in `docs/spec-options.json` under `gaps[]` and
mirrored into `catalog.parts[].optionsMeta.gaps` by the merge.

## Output schema (`docs/spec-options.json`)

```jsonc
{
  "urlScheme": "https://docs.willbrands.com/<spec-handle>.pdf",
  "generator": "scripts/spec-parse/parse_specs.py",
  "products": {
    "<productHandle>": {
      "handle": "willstudio-gvx-pendant",
      "specHandle": "willstudio-gvx-pendant",
      "sourcePdf": "https://docs.willbrands.com/willstudio-gvx-pendant.pdf",
      "sourcePage": 7,                 // 1-based page in the PDF
      "exampleOrderCode": "WD-GVX-80-30-MV-5W-BK-PM",
      "extractedAt": null,             // determinism: NEVER a wall clock
      "parseStatus": "ok",             // "ok" | "partial" | "failed"
      "options": [
        {
          "key": "finish-color",       // slug (deduped; unique within product)
          "label": "Finish Color",
          "group": "ordering",         // "ordering" | "options-accessories"
          "orderPosition": 6,
          "values": [
            { "code": "BK", "label": "Black", "buildable": true, "mapsTo": "matte-black", "note": null },
            { "code": "LG", "label": "Light Gray", "buildable": null, "mapsTo": null, "note": null }
          ]
        }
      ],
      "gaps": [],
      "notes": []
    }
  }
}
```

## Proposed `CatalogPart.options` TypeScript type (orchestrator owns `src/types.ts`)

Add to `src/types.ts` (the merge injects `options` + `optionsMeta` onto parts):

```ts
/** One selectable value within a spec-sheet ordering-matrix column. */
export interface SpecOptionValue {
  /** Order-code token, e.g. "BK", "5W", "WHP3NP". */
  code: string;
  /** Human label from the sheet, e.g. "Black", "150° Type V Square". */
  label: string;
  /**
   * true  = buildable in the configurator today (only the 5 real catalog finishes),
   * null  = pending Tyler/Cole confirmation (gate behind "request a quote"),
   * false = confirmed quote-only.
   */
  buildable: boolean | null;
  /** Catalog finish id this value maps to, when buildable (else null). */
  mapsTo: string | null;
  note: string | null;
}

/** One column of the ordering matrix = one configurator choice. */
export interface SpecOption {
  key: string;                              // unique slug within the part
  label: string;
  group: 'ordering' | 'options-accessories';
  orderPosition: number;
  values: SpecOptionValue[];
}

export interface SpecOptionsMeta {
  source: string | null;                    // spec-sheet PDF URL
  sourcePage: number | null;
  parseStatus: 'ok' | 'partial' | 'failed';
  gaps: string[];                           // human-review flags
}

// On CatalogPart (both optional — only spec-parsed parts carry them):
//   options?: SpecOption[];
//   optionsMeta?: SpecOptionsMeta;
```

## Orchestrator handoff — what remains to finish wiring

1. **Add the types** above to `src/types.ts` (`SpecOption`, `SpecOptionValue`,
   `SpecOptionsMeta`, and the optional `options?` / `optionsMeta?` fields on
   `CatalogPart`). *(this workstream did not touch `src/types.ts` — you own it)*
2. **Run the real merge** (this workstream only proved it on a temp copy):
   ```bash
   node scripts/merge-spec-options.mjs        # writes public/catalog.json
   ```
   It owns only `options`/`optionsMeta` and is idempotent. Run AFTER any
   concurrent catalog edits land, to avoid the write race.
3. **Wire the UI dropdowns**: render each part's `options[]` (group `ordering`
   first, then `options-accessories`, by `orderPosition`) as dropdowns in the
   configurator; use `values[].buildable` to gate — show `buildable === true`
   as selectable, `null`/`false` behind a "Request a quote" affordance. The
   finish dropdown can reconcile `mapsTo` with the existing catalog finish ids.
4. **Resolve the flagged gaps** with Tyler/Cole (see "Known gaps"): TEX dual
   finish split; DRX/MVX/pole `options`/`options-2` concatenation; pole column
   boundaries; and confirm the `DB→statuary-bronze` / `DG→forest-green` finish
   mappings + which non-finish options are truly buildable vs quote-only.
5. **Regenerate** any time a spec sheet is revised:
   `python scripts/spec-parse/parse_specs.py` then re-run the merge.
