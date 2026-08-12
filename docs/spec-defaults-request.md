# Tyler's config-pass requests — EXECUTED 8/12 (full-stack OK from Nick)

Status update: Nick greenlit full-stack work on `phase-0.12_TO`, so the
requests below were implemented directly (commit bde4a1f9) instead of handed
off. What shipped differs from the original asks in one big way: **Tyler's
blank-slate call superseded the defaults** — the builder now opens with
nothing selected anywhere, so Request 2's seeding mechanism (`specDefaults` +
`DEFAULT_OPTION_CODES`) is built and tested but deliberately DORMANT (no data
seeds it). Request 0 (TEX hold) and Request 1 (X-code options) shipped as
specced; the contract fixture was regenerated and verified against the Python
mirror. Still open for Puddy: are WHPXNP / SRGXXX10 / BPCX real orderable
conventions?

The original request text follows for the record.

---

# Requests from Tyler's config pass (for Nick)

Three related asks from working the GVX pilot config (Casey RFA path, step 2
"dial the config"). All change ordering data / SKU output, so they're specced
here rather than applied from the UI branch.

---

# Request 0: hold TEX as Coming Soon (fixture cut → GVX only)

**From:** Tyler (2026-08-12) — narrows his own 8/11 GVX+TEX cut to GVX-only
for the Casey pilot.

Setting `comingSoon: true` on `tex-post-top` was attempted on the UI branch
and **deliberately reverted**: a held part loses its part number in both
resolvers by design, so the flip fails 13 pinned tests — the section-D
exact-list assertions in `availability.test.ts`, and every TEX SKU case in
`texPartNumber.test.ts` + the cross-language contract
(`partNumber.contract.test.ts` / `docs/part-number-cases.json`, which the
geometry-service pytest reads too). Landing it properly means: flip the flag,
update the section-D pins, regenerate the contract fixture
(`UPDATE_PN_CASES=1`), and run the Python side — your call end to end.
Side effect worth noting: the open "TEX side-mount labeling" item goes
dormant while TEX is held.

---

# Request 1: GVX options simplification (X-codes via the corrections layer)

**From:** Tyler (2026-08-12, working session)
**Mechanism:** `docs/spec-option-corrections.json` + `apply-spec-option-corrections.mjs`
(the 0.12 declarative layer — this is exactly its use case), then
`UPDATE_PN_CASES=1` to regenerate the part-number contract fixture.

## Target list (7 lines, replacing today's 14)

| Line (simplified label) | Code → PN | Replaces | Default |
|---|---|---|---|
| Cord w/o Plug, Stripped Pigtail | `WHPXNP` | WHP3NP / WHP7NP / WHP11NP / WHP15NP | **ON** |
| 10kA Surge Suppressor | `SRGXXX10` | SRG27710 / SRG48010 | off |
| Button Photocontrol | `BPCX` | BPC1 / BPC3 / BPC4 | off |
| Programmable Motion Sensor | `MPS` (unchanged) | — (label shortened from the 3-line spec text) | off |
| House Side Shield | `HSS-GVX` (unchanged) | — | off |
| Wireless DMX Control — consult factory | `GFX` (unchanged) | — | off |
| Wireless Mesh Control — consult factory | `GFM` (unchanged) | — | off |

- **90D (90° Optics Rotation): REMOVE from the customer list entirely** (Tyler).
- X-code semantics: the generic code goes into the configured part number as-is
  ("the string that gets inputted to the PN is WHPXNP" — Tyler); the concrete
  variant (length / voltage rating) resolves at quote/order time. Cord
  explicitly has "no bearing on the visual render."
- Cord default-ON rides on the `specDefaults` mechanism below (Request 2) —
  seed `specOptions.fixture.options = ['WHPXNP']` alongside the base columns.
- **Data check (same class as the 5VN question):** are `WHPXNP` / `SRGXXX10` /
  `BPCX` real conventions on the GVX sheet, or Tyler's shorthand for
  "variant TBD"? Worth a Puddy confirm before they ship on quotes.
- UI note: the builder renders whatever values the catalog carries — once the
  corrections land, the list collapses with no UI change. The exclusive-family
  auto-swap and voltage filtering simply stop mattering for these rows.

---

# Request 2: per-part default spec selections (`specDefaults`)

**From:** Will (phase-0.10.5_TO UI pass, 2026-08-10)
**For:** Nick — this needs catalog + store changes, which the UI branch deliberately doesn't touch.

## What's wanted

When a customer picks a fixture, its spec columns should arrive pre-selected
with sensible defaults instead of empty, so the derived part number is complete
out of the gate. First concrete case — **GVX Pendant** (`gvx-pendant`):

| Column | Default code | Label |
|---|---|---|
| `lumen-output` | `115` | 15,200 |
| `color-temp` | `50` | 5000K, 70 CRI |
| `voltage` | `MV` | 120-277V |
| `distribution` | `5M` | 90° Type V Medium |

## Suggested shape

1. Catalog: optional `specDefaults: Record<optionKey, code>` on a part entry
   (survives the inventory merge like other curated fields — worth checking
   `merge-inventory.mjs` doesn't strip it).
2. Store: in `select(slot, id)`, when the chosen part has `specDefaults`, seed
   `config.specOptions[slot]` with them (user picks still override; repairConfig
   untouched).

## UI notes (already in place on phase-0.10.5_TO)

- Spec columns render as single-select toggle boxes (no "Standard" chip);
  an empty column = unspecified. Defaults seeded into `config.specOptions`
  will highlight automatically — no UI change needed.
- The group is titled "Configure Product Spec (Optional)" — with defaults
  applied, the count badge ("4 set") will reflect them.
