# Request: per-part default spec selections (`specDefaults`)

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
