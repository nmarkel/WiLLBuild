/**
 * merge-spec-options.mjs  --  WiLLBuild Phase 0.8, Workstream D
 *
 * Injects the spec-sheet ordering-matrix options (docs/spec-options.json,
 * produced by scripts/spec-parse/parse_specs.py) into the matching
 * public/catalog.json parts[] entries.
 *
 * Options must be DRIVEN BY THE SPEC SHEETS, never hand-transcribed (Tyler's
 * requirement). This script is the seam that carries the parsed matrix into the
 * catalog that drives the configurator dropdowns + validation.
 *
 * OWNERSHIP: this script owns ONLY the `options` field on catalog parts. It
 * never touches any other field. Running it repeatedly is idempotent — the
 * output is byte-identical on a second run (options are recomputed from
 * spec-options.json, not accumulated).
 *
 * MATCHING: a spec-options product `handle` is matched to catalog parts by the
 * handle embedded in each part's `productUrl` (the segment after `/products/`).
 * One handle may match several parts (e.g. the four alum-pole-NN height
 * variants all share willstudio-decorative-aluminum-light-poles) — all matching
 * parts receive the same `options`.
 *
 * Only options blocks whose parseStatus is "ok" or "partial" are injected.
 * "partial" products carry a `optionsMeta.parseStatus`/`optionsMeta.gaps` so the
 * UI/orchestrator can decide whether to surface flagged columns. "failed"
 * products inject nothing (and any stale injected options are removed).
 *
 * Usage:
 *   node scripts/merge-spec-options.mjs                 # writes public/catalog.json
 *   node scripts/merge-spec-options.mjs --catalog <p>   # write a different catalog file (temp-copy testing)
 *   node scripts/merge-spec-options.mjs --dry-run       # report only, write nothing
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getFlag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : undefined;
};
const DRY_RUN = argv.includes('--dry-run');
const CATALOG_PATH = resolve(ROOT, getFlag('--catalog') || 'public/catalog.json');
const SPEC_OPTIONS_PATH = resolve(ROOT, getFlag('--spec-options') || 'docs/spec-options.json');

// ── Helpers ───────────────────────────────────────────────────────────────
/** Extract the product handle from a willbrands.com productUrl. */
function handleFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ── Load ────────────────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const spec = JSON.parse(readFileSync(SPEC_OPTIONS_PATH, 'utf8'));
const products = spec.products || {};

// ── Merge (idempotent) ────────────────────────────────────────────────────
let injected = 0;
let cleared = 0;
const perHandle = {};

for (const part of catalog.parts || []) {
  const handle = handleFromUrl(part.productUrl);
  const entry = handle ? products[handle] : undefined;

  // Recompute from source each run → idempotent. Remove ownership fields first.
  const hadOptions = 'options' in part;
  delete part.options;
  delete part.optionsMeta;

  if (!entry || entry.parseStatus === 'failed' || !entry.options || entry.options.length === 0) {
    if (hadOptions) cleared++;
    continue;
  }

  // Inject ONLY the options data we own.
  part.options = entry.options;
  part.optionsMeta = {
    source: entry.sourcePdf,
    sourcePage: entry.sourcePage,
    parseStatus: entry.parseStatus,
    gaps: entry.gaps || [],
  };
  injected++;
  perHandle[handle] = (perHandle[handle] || 0) + 1;
}

// ── Write ───────────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`Catalog:       ${CATALOG_PATH}`);
console.log(`Spec options:  ${SPEC_OPTIONS_PATH}`);
console.log(`Parts with injected options: ${injected}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
if (cleared) console.log(`Stale options cleared from ${cleared} part(s).`);
for (const [h, n] of Object.entries(perHandle).sort()) {
  const e = products[h];
  console.log(`  ${h} -> ${n} part(s), ${e.options.length} option group(s), status=${e.parseStatus}`);
}
