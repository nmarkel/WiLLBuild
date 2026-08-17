/**
 * merge-pole-base-plate.mjs — WiLLBuild Phase 0.14 (Tyler 8/14)
 *
 * Stamps a PLACEHOLDER anchor-base plate onto every alum-pole-* part's
 * placeholder group, sized from Tyler's 8/14 base drawings ("As viewed from
 * top of pole"): a square plate per pole diameter. It renders both on
 * placeholder poles (specToObject) and grafted onto the real RSAA tube
 * (placeholderGraftChildren picks up every box child), at native size and
 * fixed Y — like the hand-hole cover, it must never stretch with pole height.
 *
 * Plan dimensions are Tyler's; the 1in THICKNESS is an assumption (the
 * drawings are plan views only) — swap for Cole's real base CAD when it
 * lands, exactly like the hand hole did.
 *
 * Idempotent: the child is marked `name: "base-plate"` and upserted by that
 * mark. Owns exactly that child; never touches the pole cylinder or the
 * hand-hole cover box.
 *
 * Usage:
 *   node scripts/merge-pole-base-plate.mjs [--catalog <p>] [--dry-run]
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

// Tyler's 8/14 base drawings: square base width (in) per pole OD (in).
const BASE_WIDTH_IN = { 4: 8.63, 5: 10.25, 6: 11.0 };
const THICKNESS_M = 0.0254; // 1in — assumed; plan views carry no thickness.
const IN_TO_M = 0.0254;

let stamped = 0;
let unchanged = 0;
for (const part of catalog.parts) {
  if (part.slot !== 'pole' || !part.id.startsWith('alum-pole-')) continue;
  const widthIn = BASE_WIDTH_IN[part.diameterIn];
  if (!widthIn || part.placeholder?.kind !== 'group') continue;
  const w = Math.round(widthIn * IN_TO_M * 1e4) / 1e4;
  const child = {
    name: 'base-plate',
    spec: { kind: 'box', sizeM: [w, THICKNESS_M, w], direction: 'up' },
    position: [0, 0, 0],
  };
  const children = part.placeholder.children;
  const at = children.findIndex((c) => c.name === 'base-plate');
  if (at >= 0 && JSON.stringify(children[at]) === JSON.stringify(child)) {
    unchanged++;
    continue;
  }
  if (at >= 0) children[at] = child;
  else children.push(child);
  stamped++;
}

console.log(`base plates: ${stamped} stamped, ${unchanged} unchanged`);
if (!DRY_RUN) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`wrote ${CATALOG_PATH}`);
}
