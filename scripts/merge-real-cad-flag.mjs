/**
 * merge-real-cad-flag.mjs — WiLLBuild Phase 0.12, Workstream D
 *
 * Stamps `realCad: true|false` onto every public/catalog.json part, from the
 * offline render rig's scripts/render-rig/real-parts.json (the parts whose
 * render layers come from Cole's real CAD rather than a placeholder solid).
 *
 * WHY the flag has to exist at all: real-parts.json is a render-rig file and
 * never ships in the app bundle, but the builder needs to know — at runtime —
 * which products are still on placeholder geometry, so it can badge them
 * "Coming Soon" and make them inert (Tyler, 8/11: placeholder renders can no
 * longer sit next to real products as if they were equivalent).
 *
 * OWNERSHIP: this script owns ONLY `realCad`. It never touches another field.
 * Idempotent — running it twice is byte-identical.
 *
 * The point of generating it rather than hand-maintaining a list is that parts
 * flip on BY THEMSELVES as Workstream A lands their alignment: map a part in
 * real-parts.json, re-run this, and it stops being Coming Soon. Nothing to
 * remember, nothing to delete. `src/lib/availability.test.ts` keeps the flag
 * honest against real-parts.json.
 *
 * Usage:
 *   node scripts/merge-real-cad-flag.mjs [--catalog <p>] [--dry-run]
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
const REAL_PARTS_PATH = resolve(
  ROOT,
  getFlag('--real-parts') || 'scripts/render-rig/real-parts.json',
);

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const realParts = JSON.parse(readFileSync(REAL_PARTS_PATH, 'utf8'));
const realIds = new Set(Object.keys(realParts));

let real = 0;
let placeholder = 0;
const unknown = [...realIds];

for (const part of catalog.parts || []) {
  const isReal = realIds.has(part.id);
  part.realCad = isReal;
  if (isReal) {
    real++;
    unknown.splice(unknown.indexOf(part.id), 1);
  } else {
    placeholder++;
  }
}

// A real-parts entry with no catalog part is a broken mapping, not a curiosity:
// the rig would render a layer nothing can select.
if (unknown.length > 0) {
  throw new Error(
    `real-parts.json maps ${unknown.length} id(s) with no catalog part: ${unknown.join(', ')}`,
  );
}

if (!DRY_RUN) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

console.log(`Catalog:    ${CATALOG_PATH}`);
console.log(`Real parts: ${REAL_PARTS_PATH}`);
console.log(
  `realCad=true on ${real} part(s), false on ${placeholder}` +
    `${DRY_RUN ? ' (dry-run, not written)' : ''}`,
);
