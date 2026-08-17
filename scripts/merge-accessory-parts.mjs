/**
 * merge-accessory-parts.mjs — WiLLBuild Phase 0.14 (Tyler 8/14)
 *
 * Upserts the RENDER-ONLY accessory parts into public/catalog.json: the parts
 * whose layers the compositor places at a configured shaft-accessory
 * placement (additional hand hole, festoon provision, threaded coupling,
 * flag holder kit, plant holder kit). They follow the banner-part pattern —
 * `slot: "accessory"` is not in SLOT_ORDER, so these are never selectable,
 * never repaired, never part-numbered; they exist so the render rig bakes
 * layers for them and `resolveAssemblyLayout` can draw each placed instance.
 *
 * The accessory ORDER CODES stay where they always were: spec-option values
 * on the pole (docs/spec-option-corrections.json), which now carry a
 * `renderPartId` pointing at these parts.
 *
 * WHY a script and not a catalog edit: catalog.json is generated + merged
 * (never hand-edit — the 0.10.5 rule); this is the same regen-safe channel
 * the banner parts should have had. Idempotent — running it twice is
 * byte-identical. It owns exactly the parts listed here (matched by id) and
 * never touches any other entry.
 *
 * Usage:
 *   node scripts/merge-accessory-parts.mjs [--catalog <p>] [--dry-run]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const getFlag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : undefined;
};
const DRY_RUN = argv.includes('--dry-run');
const CATALOG_PATH = resolve(ROOT, getFlag('--catalog') || 'public/catalog.json');

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

// Finishes mirror the banner part's list: paint-to-match accessories offer the
// same palette the pole itself does (the compositor resolves each instance's
// layer in the POLE's finish, so this list is informational).
const FINISHES = [
  'matte-black',
  'statuary-bronze',
  'gloss-white',
  'silver',
  'light-gray',
  'slate-gray',
  'forest-green',
  'dark-platinum',
  'graphite-metallic',
  'custom-ral',
];

const base = {
  slot: 'accessory',
  line: 'WiLLstudio',
  category: 'Pole Accessories',
  productClass: 'assembly-part',
  dropShip: false,
  tier: 2,
  mount: 'shaft',
  sockets: {},
  finishes: FINISHES,
  keywords: [],
  model: null,
  thumbnail: null,
  productUrl: '',
};

const ACCESSORY_PARTS = [
  {
    ...base,
    id: 'willstudio-acc-hand-hole',
    name: 'Additional Hand Hole',
    family: 'HHX',
    // Real CAD: HH-4R.STEP (a 6in pole section, hole frame reaching +X; GLB
    // origin at the section's vertical centre so placement height reads to
    // the hole centreline). See scripts/step-to-glb/ingest.py. The
    // placeholder is the fallback for machines without the GLB: a cover
    // plate matching the pole's own grafted hand-hole cover (4 mm sheet,
    // 2 mm proud of the 4in shaft).
    placeholder: {
      kind: 'group',
      children: [
        {
          spec: { kind: 'box', sizeM: [0.004, 0.152, 0.102], direction: 'up' },
          position: [0.0528, -0.076, 0],
        },
      ],
    },
  },
  {
    ...base,
    id: 'willstudio-acc-festoon',
    name: 'Festoon Power Provision',
    family: 'FSTR',
    // No CAD export exists (Tyler 8/14: "put a best guess representation into
    // the tool") — a weatherproof-outlet read: cover plate on the shaft with
    // a receptacle boss proud of it. Origin at the plate's vertical centre,
    // proud of a 4in pole (r=0.0508) like the pole's own grafted cover.
    // Swaps to real CAD automatically the day Cole exports one.
    placeholder: {
      kind: 'group',
      children: [
        {
          spec: { kind: 'box', sizeM: [0.006, 0.127, 0.089], direction: 'up' },
          position: [0.0528, -0.0635, 0],
        },
        {
          spec: { kind: 'box', sizeM: [0.018, 0.06, 0.045], direction: 'up' },
          position: [0.0588, -0.03, 0],
        },
      ],
    },
  },
  {
    ...base,
    id: 'willstudio-acc-coupling',
    name: 'Threaded Coupling',
    family: 'CPLX',
    // Real CAD: CPL-P-12.STEP (6in pole section, coupling boss reaching +X,
    // origin at vertical centre). Thread spec resolves at quote/order entry.
    // Placeholder fallback: the boss alone, 25 mm proud of the 4in shaft.
    placeholder: {
      kind: 'group',
      children: [
        {
          spec: { kind: 'box', sizeM: [0.026, 0.05, 0.05], direction: 'up' },
          position: [0.0508, -0.025, 0],
        },
      ],
    },
  },
  {
    ...base,
    id: 'willstudio-acc-flag-holder',
    name: 'Flag Holder Kit',
    family: 'FH',
    // Real CAD: FH-4R.STEP (staff included; native origin = the shaft
    // bracket, which is what the placement height drives; rotateY -90 in
    // real-parts.json). Placeholder fallback: bracket block + upright staff
    // approximating the measured 2.18 m kit envelope.
    placeholder: {
      kind: 'group',
      children: [
        {
          spec: { kind: 'box', sizeM: [0.06, 0.15, 0.10], direction: 'up' },
          position: [0.051, -0.075, 0],
        },
        {
          spec: { kind: 'box', sizeM: [0.03, 1.9, 0.03], direction: 'up' },
          position: [0.12, -0.4, 0],
        },
      ],
    },
  },
  {
    ...base,
    id: 'willstudio-acc-plant-holder',
    name: 'Plant Holder Kit',
    family: 'PH',
    // Real CAD: PH-4R.STEP (basket hangs 0.55 m below the native-origin
    // bracket; reaches +X natively). Placeholder fallback: bracket arm +
    // basket box at the measured 0.81 m reach envelope.
    placeholder: {
      kind: 'group',
      children: [
        {
          spec: { kind: 'box', sizeM: [0.5, 0.04, 0.04], direction: 'up' },
          position: [0.05, -0.04, 0],
        },
        {
          spec: { kind: 'box', sizeM: [0.3, 0.25, 0.3], direction: 'up' },
          position: [0.4, -0.3, 0],
        },
      ],
    },
  },
];

let added = 0;
let updated = 0;
let unchanged = 0;
for (const part of ACCESSORY_PARTS) {
  const idx = catalog.parts.findIndex((p) => p.id === part.id);
  if (idx === -1) {
    catalog.parts.push(part);
    added += 1;
    continue;
  }
  // Preserve generated fields other scripts own (realCad), replace the rest.
  const preserved = 'realCad' in catalog.parts[idx] ? { realCad: catalog.parts[idx].realCad } : {};
  const next = { ...part, ...preserved };
  if (JSON.stringify(catalog.parts[idx]) !== JSON.stringify(next)) {
    catalog.parts[idx] = next;
    updated += 1;
  } else {
    unchanged += 1;
  }
}

console.log(`accessory parts: ${added} added, ${updated} updated, ${unchanged} unchanged`);
if (!DRY_RUN) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`wrote ${CATALOG_PATH}`);
}
