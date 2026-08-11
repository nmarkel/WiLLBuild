/**
 * gen-spec-option-corrections.mjs — ONE-OFF generator (Phase 0.12).
 *
 * Builds docs/spec-option-corrections.json by lifting the already-correct
 * hand-fixed columns out of public/catalog.json (the decorative-pole sheet,
 * hand-fixed in dbf26aa4 and again in 0.10) and re-partitioning the TEX sheet's
 * two collapsed columns from the RAW parser output in docs/spec-options.json.
 *
 * Lifting rather than re-typing is the point: the pole columns that ship today
 * are known good, so transcribing them by hand would be the one step that could
 * silently change a pole SKU. Every TEX value is likewise re-partitioned from
 * the parse — no value is invented, per docs/part-numbers.md.
 *
 * Run once; the generated JSON is the artifact under review. Kept in-repo so
 * the provenance of each corrected column is reproducible.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'public/catalog.json'), 'utf8'));
const spec = JSON.parse(readFileSync(resolve(ROOT, 'docs/spec-options.json'), 'utf8'));

const partById = (id) => catalog.parts.find((p) => p.id === id);
const colOf = (part, key) => {
  const c = (part.options || []).find((o) => o.key === key);
  if (!c) throw new Error(`missing corrected column ${key} on ${part.id}`);
  return c;
};
const rawCol = (handle, key) => {
  const c = (spec.products[handle]?.options || []).find((o) => o.key === key);
  if (!c) throw new Error(`missing raw column ${key} on ${handle}`);
  return c;
};
/** A raw parsed value, looked up by code — keeps label/mapsTo/buildable faithful to the sheet. */
const pick = (col, code) => {
  const v = col.values.find((x) => x.code === code);
  if (!v) throw new Error(`raw column ${col.key} has no value ${code}`);
  return { ...v };
};

// ── Poles: lift the three hand-fixed splits straight out of the shipped catalog ──
const pole = partById('alum-pole-20');
const POLE_HANDLE = 'willstudio-decorative-aluminum-light-poles';

// ── TEX: re-partition the two collapsed columns from the raw parse ──────────
const TEX_HANDLE = 'willstudio-tex-post-top-area';
const rawLumen = rawCol(TEX_HANDLE, 'lumen-output');
const rawFinish = rawCol(TEX_HANDLE, 'finish-color-finish-color-spider-mount');

// Sheet order for both TEX finish segments (WiLLstudio Ordering Matrix, 8/11).
const TEX_FINISH_CODES = ['NA', 'BK', 'DB', 'WH', 'LG', 'SG', 'DG', 'DP', 'GM', 'RAL'];
const texFinishValues = () =>
  TEX_FINISH_CODES.map((code) => {
    const v = pick(rawFinish, code);
    // The collapsed column duplicated every colour once per segment; the RAL
    // duplicate also carried the doubled label "Custom RAL Match Match".
    if (code === 'RAL') v.label = 'Custom RAL Match';
    return v;
  });

const out = {
  note:
    'Phase 0.12 — declarative corrections applied to the machine-parsed spec-sheet columns by scripts/merge-spec-options.mjs, AFTER it injects the raw docs/spec-options.json output. Exists because parse_specs.py assigns ordering-table cells by PDF x-coordinate, which merges adjacent columns on sheets with two-line headers (see docs/part-numbers.md, "Known spec-parse artifacts"). Before this file those fixes were edited straight into public/catalog.json, so re-running the merge script silently reverted them and quietly corrupted pole part numbers. Corrections live here so the merge stays idempotent against the CORRECTED state, not just against its own raw source.',
  rules:
    'Each entry replaces ONE raw column (matched by `rawKey`) with an ordered list of corrected columns. Fractional orderPosition values keep a split column adjacent to its neighbours without renumbering the sheet. No value here is invented: pole columns were lifted verbatim from the reviewed catalog, TEX columns re-partitioned from the raw parse.',
  products: {
    [POLE_HANDLE]: {
      reason:
        "The decorative-pole sheet's two-line 'Length (Above Grade)' header makes nearest-centroid cell assignment bleed Length and Wall Thickness cells into neighbouring columns. Splits below match the sheet as printed.",
      replace: [
        {
          rawKey: 'design',
          why: "Raw `design` carried 12 values: the 3 real design codes plus leaked Length cells and a stray Wall Thickness 'Custom'. Split into the trimmed design column and the real Length column that buildPartNumber resolves from part.heightFt.",
          columns: [colOf(pole, 'design'), colOf(pole, 'length')],
        },
        {
          rawKey: 'length-pole-base-pole-top-wall-od-od-thickness',
          why: 'Three sheet columns merged into one by the header clustering; split back into pole diameter and wall thickness.',
          columns: [colOf(pole, 'pole-diameter'), colOf(pole, 'wall-thickness')],
        },
        {
          rawKey: 'anchor-bolts-base-type-finish-type',
          why: 'Three sheet columns merged into one; split back so finish-type (FP/AN) resolves from the picked finish.',
          columns: [
            colOf(pole, 'anchor-bolts'),
            colOf(pole, 'base-type'),
            colOf(pole, 'finish-type'),
          ],
        },
      ],
    },
    [TEX_HANDLE]: {
      reason:
        "TEX ships two defects the GVX sheet does not: the Design column ('TEX' Medium / 'CH' Custom) is merged into Lumen Output, and the sheet's TWO finish columns (Housing, and Spider Mount & Accent Line) are merged into one with every colour duplicated. Both are fatal to the part number — see the sheet's own example WD-TEX-80-30-MV-5W-3T-NA-BK.",
      replace: [
        {
          rawKey: 'lumen-output',
          why: "Merged Design + Lumen Output. One column can only ever emit ONE segment, so the number lost whichever the customer did not pick: with a lumen chosen it resolved WD-80-… (no design), with none it resolved WD-TEX-… (no lumen). Split restores both.",
          columns: [
            {
              key: 'design',
              label: 'Design',
              group: 'ordering',
              orderPosition: 1,
              values: [pick(rawLumen, 'TEX'), pick(rawLumen, 'CH')],
            },
            {
              key: 'lumen-output',
              label: 'Lumen Output (Model Nominal Lumens)',
              group: 'ordering',
              orderPosition: 1.5,
              values: ['40', '70', '80', '115', '155', 'CW'].map((c) => pick(rawLumen, c)),
            },
          ],
        },
        {
          rawKey: 'finish-color-finish-color-spider-mount',
          why: "The sheet prints TWO finish columns side by side; the parser zipped them into one 20-value column (each colour twice). Split into Housing and Spider Mount & Accent Line. The sheet requires the accent designation even on side mounts, where the mounting arm matches the housing colour.",
          columns: [
            {
              key: 'finish-color',
              label: 'Finish Color (Housing)',
              group: 'ordering',
              orderPosition: 6,
              values: texFinishValues(),
            },
            {
              key: 'finish-color-accent',
              label: 'Finish Color (Spider Mount & Accent Line)',
              group: 'ordering',
              orderPosition: 6.5,
              values: texFinishValues(),
            },
          ],
        },
      ],
    },
  },
};

writeFileSync(
  resolve(ROOT, 'docs/spec-option-corrections.json'),
  JSON.stringify(out, null, 2) + '\n',
  'utf8',
);
console.log('wrote docs/spec-option-corrections.json');
for (const [h, e] of Object.entries(out.products)) {
  console.log(`  ${h}: ${e.replace.length} replacement rule(s)`);
  for (const r of e.replace) {
    console.log(`    ${r.rawKey} -> ${r.columns.map((c) => c.key).join(', ')}`);
  }
}
