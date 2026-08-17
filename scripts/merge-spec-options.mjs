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
 *
 * ============================================================================
 * RESOLVED (Phase 0.12): this script used to be idempotent only against its own
 * RAW source, so re-running it silently reverted the hand-fixes that had been
 * edited straight into public/catalog.json — the `alum-pole-*` `design`/`length`
 * columns that buildPartNumber depends on for pole part numbers, with no error
 * and nothing obviously wrong in a quick diff.
 *
 * Those column fixes are now declarative, in docs/spec-option-corrections.json,
 * and are applied here immediately after the raw injection, so re-running this
 * script no longer reverts them. A correction whose `rawKey` no longer exists is
 * a hard error, not a silent no-op — that is what makes a re-parse that renames
 * or fixes a column impossible to miss.
 *
 * ⚠ STILL NOT A FULL REGENERATOR (measured in 0.12, do not assume otherwise).
 * The corrections file covers the parser's column-MERGE defects only. The shipped
 * public/catalog.json carries further deliberate curation that lives nowhere but
 * that file, and that this script would still discard:
 *   - `gvx-pendant` has its `mounting` column REMOVED (pendant mount is carried
 *     as the `PM` option code instead — see the sheet example WD-GVX-…-BK-PM);
 *   - `alum-pole-*` have hand-TRIMMED options/accessories value lists
 *     (options 16→3, options-2 20→5, accessories 10→4);
 *   - `merge-ordering.mjs` separately owns `options` on the arms and base covers
 *     (sh1-shepherds-hook, bc-*), which this script clears if run alone.
 * So: run this ONLY as `merge-spec-options` → `merge-ordering`, then diff
 * public/catalog.json and re-apply the curation above. Bringing that curation
 * into the corrections file is worthwhile follow-up work, deliberately not done
 * in 0.12. `src/lib/specOptionCorrections.test.ts` pins the corrected columns
 * that ARE covered, so those cannot drift silently.
 *
 * The raw docs/spec-options.json is still deliberately left polluted: the defects
 * are specific to two sheets' unusual two-line headers, and "fixing" the generic
 * nearest-centroid clustering risks regressing sheets that parse cleanly today.
 * See docs/part-numbers.md, "Known spec-parse artifacts".
 * ============================================================================
 */
import { readFileSync, writeFileSync } from 'fs';
import { applyCorrections, handleFromUrl } from './lib/spec-option-corrections.mjs';
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
const CORRECTIONS_PATH = resolve(
  ROOT,
  getFlag('--corrections') || 'docs/spec-option-corrections.json',
);

// ── Helpers ───────────────────────────────────────────────────────────────
// ── Load ────────────────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const spec = JSON.parse(readFileSync(SPEC_OPTIONS_PATH, 'utf8'));
const products = spec.products || {};
const corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')).products || {};
let correctedColumns = 0;

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

  // Inject ONLY the options data we own, with the reviewed column corrections
  // applied on top of the raw parse (see docs/spec-option-corrections.json).
  const corrected = applyCorrections(entry.options, handle, corrections, part.id);
  correctedColumns += corrected.applied;
  part.options = corrected.options;
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
console.log(`Corrections:   ${CORRECTIONS_PATH}`);
console.log(`Parts with injected options: ${injected}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
console.log(`Corrected columns applied:   ${correctedColumns}`);
if (cleared) console.log(`Stale options cleared from ${cleared} part(s).`);
for (const [h, n] of Object.entries(perHandle).sort()) {
  const e = products[h];
  console.log(`  ${h} -> ${n} part(s), ${e.options.length} option group(s), status=${e.parseStatus}`);
}
