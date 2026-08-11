/**
 * apply-spec-option-corrections.mjs — Phase 0.12
 *
 * Brings public/catalog.json up to date with docs/spec-option-corrections.json,
 * IN PLACE, without regenerating anything else.
 *
 * Why this exists rather than just re-running merge-spec-options.mjs: that
 * script rebuilds `options` from the raw parse and would discard the deliberate
 * curation the shipped catalog carries (see its header). This one only performs
 * the column substitutions, so it is safe to run against the live catalog.
 *
 * Idempotent: a rule whose `rawKey` is already gone has already been applied and
 * is skipped, so running twice is a no-op.
 *
 * Usage:
 *   node scripts/apply-spec-option-corrections.mjs [--catalog <p>] [--dry-run]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyCorrections, handleFromUrl } from './lib/spec-option-corrections.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const getFlag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : undefined;
};
const DRY_RUN = argv.includes('--dry-run');
const CATALOG_PATH = resolve(ROOT, getFlag('--catalog') || 'public/catalog.json');
const CORRECTIONS_PATH = resolve(
  ROOT,
  getFlag('--corrections') || 'docs/spec-option-corrections.json',
);

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')).products || {};

let changedParts = 0;
let appliedColumns = 0;
let skippedRules = 0;

for (const part of catalog.parts || []) {
  if (!part.options) continue;
  const handle = handleFromUrl(part.productUrl);
  if (!handle || !corrections[handle]) continue;

  const result = applyCorrections(part.options, handle, corrections);
  skippedRules += result.skipped;
  if (result.applied > 0) {
    part.options = result.options;
    changedParts++;
    appliedColumns += result.applied;
    console.log(`  ${part.id}: +${result.applied} corrected column(s)`);
  }
}

if (!DRY_RUN && changedParts > 0) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

console.log(`Catalog:     ${CATALOG_PATH}`);
console.log(`Corrections: ${CORRECTIONS_PATH}`);
console.log(
  `Parts changed: ${changedParts}, columns applied: ${appliedColumns}, ` +
    `rules already applied: ${skippedRules}${DRY_RUN ? ' (dry-run, not written)' : ''}`,
);
