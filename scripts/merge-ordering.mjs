/**
 * merge-ordering.mjs  --  WiLLBuild Phase 0.10, Workstream 0 + A
 *
 * Injects the WiLL ordering-matrix data (docs/ordering-matrix.json) into
 * public/catalog.json so the part-number resolver (src/lib/partNumber.ts and its
 * Python mirror) is driven entirely by catalog data — no component, and no
 * resolver, hardcodes a family/design/fit/finish code.
 *
 * OWNERSHIP: this script owns exactly three things and never touches anything
 * else:
 *   1. `catalog.ordering`        — the shared code tables (fit codes, socket ODs,
 *                                  finish-code map, part-number structure).
 *   2. `catalog.parts[].ordering` — the per-part matrix block (family, designs,
 *                                  fit rule, part-number-bearing options).
 *   3. `catalog.parts[].arrangements` — ONLY for parts the matrix covers with
 *      per-count design codes (arms). The matrix is the authority on how many
 *      arms a family can carry (SH1 = single only; SS/AR = 1-4; SD/HS = 1-2;
 *      crossarm = fixed 2), so the geometry/UI list and the design codes cannot
 *      drift apart. Parts the matrix does not cover keep whatever
 *      `arrangements` they already had.
 *   Plus `catalog.finishes[].code` — the ordering-matrix finish code (BK/DB/...).
 *
 * Running it repeatedly is idempotent: everything is recomputed from
 * docs/ordering-matrix.json, never accumulated.
 *
 * Usage:
 *   node scripts/merge-ordering.mjs                 # writes public/catalog.json
 *   node scripts/merge-ordering.mjs --catalog <p>   # write a different catalog file
 *   node scripts/merge-ordering.mjs --dry-run       # report only, write nothing
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
const MATRIX_PATH = resolve(ROOT, getFlag('--matrix') || 'docs/ordering-matrix.json');

// ── Load ────────────────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));

// ── Shared tables onto the catalog root ─────────────────────────────────────
catalog.ordering = {
  structure: matrix.structure,
  example: matrix.example,
  source: matrix.source,
  provenance: matrix.provenance,
  fitCodes: matrix.fitCodes,
  socketOdIn: matrix.socketOdIn,
  socketOdNote: matrix.socketOdNote,
  fitToleranceIn: matrix.fitToleranceIn,
  fitToleranceNote: matrix.fitToleranceNote,
};

// ── Finish codes ────────────────────────────────────────────────────────────
let finishCoded = 0;
for (const finish of catalog.finishes || []) {
  const code = matrix.finishCodes[finish.id];
  delete finish.code;
  if (code) {
    finish.code = code;
    finishCoded++;
  }
}

// ── Per-part matrix blocks ──────────────────────────────────────────────────
const partsById = new Map((catalog.parts || []).map((p) => [p.id, p]));

// Clear anything we own from a previous run (idempotency).
for (const part of catalog.parts || []) delete part.ordering;

const missing = [];
let injected = 0;
const arrangementChanges = [];

for (const [familyKey, fam] of Object.entries(matrix.families)) {
  const options = fam.options === 'armOptions' ? matrix.armOptions : (fam.options ?? null);
  for (const partId of fam.parts) {
    const part = partsById.get(partId);
    if (!part) {
      missing.push(`${familyKey} -> ${partId}`);
      continue;
    }
    part.ordering = {
      familyKey,
      familyLabel: fam.label,
      family: fam.family,
      designs: fam.designs,
      fit: fam.fit ?? null,
      fitFrom: fam.fitFrom ?? 'hostSocket',
      ...(options ? { options } : {}),
      source: matrix.source,
      ...(fam.note ? { note: fam.note } : {}),
    };
    injected++;

    // arrangements: the matrix owns the arm counts for families whose designs
    // encode a count (arms). Base covers / plate-mount families do not.
    const counts = [...new Set(fam.designs.map((d) => d.armCount).filter((n) => Number.isInteger(n)))].sort(
      (a, b) => a - b,
    );
    if (counts.length > 0) {
      const before = JSON.stringify(part.arrangements ?? null);
      const after = JSON.stringify(counts);
      part.arrangements = counts;
      if (before !== after) arrangementChanges.push(`${partId}: ${before} -> ${after}`);
    }
  }
}

// ── Write ───────────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`Catalog:        ${CATALOG_PATH}`);
console.log(`Ordering matrix: ${MATRIX_PATH}`);
console.log(`Parts with ordering blocks: ${injected}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
console.log(`Finishes coded:             ${finishCoded}/${(catalog.finishes || []).length}`);
if (arrangementChanges.length) {
  console.log('Arrangements set from the matrix:');
  for (const line of arrangementChanges) console.log(`  ${line}`);
}
if (missing.length) {
  console.log('MATRIX PART IDS NOT IN CATALOG (fix the mapping):');
  for (const line of missing) console.log(`  ${line}`);
  process.exitCode = 1;
}
