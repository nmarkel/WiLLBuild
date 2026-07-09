/**
 * merge-inventory.mjs
 *
 * Reads docs/catalog-inventory.json + public/catalog.json and writes an updated
 * public/catalog.json that includes every willbrands.com product as a catalog entry.
 *
 * Idempotent: running twice produces identical output.
 *
 * CURATED MAPPING TABLE
 * =====================
 * The 15 curated parts in catalog.json (tier 2, with sockets/placeholder) correspond
 * to inventory products as follows. The script SKIPS these handles — curated entries
 * stay EXACTLY as they are.
 *
 *  Curated ID            | Inventory handle(s) covered
 *  ----------------------|----------------------------------------------------
 *  drx-post-top          | willstudio-drx-post-top-area
 *  tex-post-top          | willstudio-tex-post-top-area
 *  mvx-coach             | willstudio-mvx-coach
 *  gvx-pendant           | willstudio-gvx-pendant
 *  sh1-shepherds-hook    | willstudio-sh1-single-shepherds-hook-pole-top-bracket
 *  upsweep               | willstudio®-decorative-upsweep-arms
 *                        |   (WiLLstudio® Decorative Upsweep Arms — covers both
 *                        |    upsweep and supported-decorative-arms conceptually;
 *                        |    willstudio-supported-decorative-arms added separately
 *                        |    as an assembly-part standalone because it is a distinct
 *                        |    product page for supported/SD-style arms — kept.)
 *  pa1-pendant-arm       | willstudio-pa1-single-pendant-arm
 *  pm1-pendant-arm       | willstudio-pm1-single-pendant-arm
 *  direct-mount          | (virtual tenon-adapter; no direct inventory product page)
 *  alum-pole-12          | willstudio-decorative-aluminum-light-poles  (height variant)
 *  alum-pole-14          | willstudio-decorative-aluminum-light-poles  (height variant)
 *  alum-pole-16          | willstudio-decorative-aluminum-light-poles  (height variant)
 *  alum-pole-20          | willstudio-decorative-aluminum-light-poles  (height variant)
 *  bc-fluted             | willstudio-decorative-base-covers           (style variant)
 *  bc-round              | willstudio-decorative-base-covers           (style variant)
 *
 * Decision notes:
 *  - The four alum-pole-NN entries all come from ONE inventory product
 *    (willstudio-decorative-aluminum-light-poles) that sells height variants.
 *    We map that handle to all four curated poles and skip it from new entries.
 *  - bc-fluted and bc-round both come from ONE inventory product
 *    (willstudio-decorative-base-covers) that sells style variants. Mapped + skipped.
 *  - aluminum-light-pole-base-covers is a separate, older base-cover product page
 *    (WiLLstudio line, assembly-part, dropShip:true). It is NOT the same product as
 *    willstudio-decorative-base-covers. Added as a new standalone entry (slot: standalone,
 *    productClass: assembly-part preserved) because it lacks geometry.
 *  - sh1-shepherds-hook: curated productUrl points to collections/decorative-brackets-arms
 *    but the match is unambiguous by title keyword "sh1"/"shepherds hook".
 *  - willstudio-supported-decorative-arms: inventory productClass=assembly-part, category
 *    is "fixture" (heuristic mis-classification — it is actually arms). Added as
 *    slot:standalone/assembly-part because no sockets/geometry yet. Task 6 will upgrade.
 *
 * STAGING RULE (important for Task 6)
 * ====================================
 * New entries with productClass === 'assembly-part' that are NOT among the curated 15
 * get slot: 'standalone' for now — they cannot join the wizard until Task 6 adds
 * sockets + placeholder geometry and flips their slot. Their productClass and true
 * category are preserved so Task 6 can query: filter catalog.parts where
 * productClass==='assembly-part' && slot==='standalone' to find upgrade candidates.
 *
 * Usage:  node scripts/merge-inventory.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const INVENTORY_PATH = resolve(ROOT, 'docs/catalog-inventory.json');
const CATALOG_PATH   = resolve(ROOT, 'public/catalog.json');
const ASSETS_MD_PATH = resolve(ROOT, 'catalog-assets.md');

// ── Curated mapping: inventory handles that are already covered by a curated part ──
// One handle may cover multiple curated parts (height/style variants).
const CURATED_HANDLES = new Set([
  'willstudio-drx-post-top-area',
  'willstudio-tex-post-top-area',
  'willstudio-mvx-coach',
  'willstudio-gvx-pendant',
  'willstudio-sh1-single-shepherds-hook-pole-top-bracket',
  'willstudio®-decorative-upsweep-arms',      // upsweep curated entry
  'willstudio-pa1-single-pendant-arm',
  'willstudio-pm1-single-pendant-arm',
  'willstudio-decorative-aluminum-light-poles', // covers alum-pole-12/14/16/20
  'willstudio-decorative-base-covers',          // covers bc-fluted / bc-round
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract meaningful lowercase keywords from a product title. */
function titleToKeywords(title) {
  // Remove trademark symbols and common stop-words
  const cleaned = title
    .replace(/WiLLstudio[®™]?\s*/gi, '')
    .replace(/NAFCO[®™]?\s*/gi, '')
    .replace(/WiLLsport[®™]?\s*/gi, '')
    .replace(/WiLLev[®™]?\s*/gi, '')
    .replace(/WiLLcloud[®™]?\s*/gi, '')
    .replace(/[®™]/g, '')
    .toLowerCase();

  // Split on non-alpha-numeric, filter short/common words
  const stopWords = new Set(['and', 'the', 'of', 'for', 'with', 'a', 'an', 'in',
    'on', 'at', 'to', 'set', 'or', 'w/', 'w', 'x', '-', 'single', 'double',
    'triple', 'quad', 'lower', '48', 'only', 'shipping', 'ak', 'hi', 'can']);

  const words = cleaned.split(/[\s,\/\-\(\)\.\"]+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !stopWords.has(w));

  // De-duplicate while preserving order
  return [...new Set(words)];
}

/** Derive family string from line + category. */
function deriveFamily(line, category) {
  // Map category slugs to human labels
  const catLabel = {
    'fixture': 'Fixtures',
    'arm': 'Brackets & Arms',
    'pole': 'Poles',
    'base-cover': 'Base Covers',
    'accessory': 'Accessories',
    'controls': 'Controls',
    'ev-charging': 'EV Charging',
  }[category] ?? category;
  return `${line} ${catLabel}`;
}

/** Build the 3D / photo-card / GLB status string. */
function statusLabel(part) {
  if (part.placeholder) return '3D parametric';
  if (part.photo)        return 'photo-card';
  return 'photo-card'; // new entries always have a CDN photo
}

// ── Load files ────────────────────────────────────────────────────────────────
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
const catalog   = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

// Build a set of ids already present in the curated parts (to detect conflicts)
const existingIds = new Set(catalog.parts.map(p => p.id));

// ── Build new entries from inventory ─────────────────────────────────────────
const newEntries = [];
const skippedHandles = [];

for (const product of inventory.products) {
  if (CURATED_HANDLES.has(product.handle)) {
    skippedHandles.push(product.handle);
    continue;
  }

  const id = product.handle; // id = handle (URL-slug, unique)

  // Guard: if somehow already present (re-run), skip
  if (existingIds.has(id)) continue;

  // Slot: assembly-parts that are NOT in the wizard yet get 'standalone' (staging rule).
  // All other products are also 'standalone' — they are not wizard parts.
  const slot = 'standalone';

  const entry = {
    id,
    slot,
    line: product.line,
    category: product.category,
    productClass: product.productClass,
    dropShip: product.dropShip,
    tier: 3,
    name: product.title,          // full title, no truncation per spec
    family: deriveFamily(product.line, product.category),
    photo: product.image,         // remote CDN URL — acceptable in 0.3
    thumbnail: null,
    model: null,
    keywords: titleToKeywords(product.title),
    productUrl: product.productUrl,
    finishes: [],                 // no finish UI until wizard-capable
  };

  newEntries.push(entry);
  existingIds.add(id);
}

// ── Merge into catalog ────────────────────────────────────────────────────────
// Curated parts come first (untouched), then new entries sorted by line+name.
const sortedNew = newEntries.sort((a, b) =>
  a.line.localeCompare(b.line) || a.name.localeCompare(b.name)
);

const mergedCatalog = {
  ...catalog,
  parts: [...catalog.parts, ...sortedNew],
};

// ── Validate: no duplicate ids ────────────────────────────────────────────────
const allIds = mergedCatalog.parts.map(p => p.id);
const idSet  = new Set(allIds);
if (idSet.size !== allIds.length) {
  const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  throw new Error(`Duplicate part ids detected: ${dupes.join(', ')}`);
}

// ── Write catalog.json ────────────────────────────────────────────────────────
const catalogJson = JSON.stringify(mergedCatalog, null, 2) + '\n';
writeFileSync(CATALOG_PATH, catalogJson, 'utf8');
console.log(`catalog.json written — ${mergedCatalog.parts.length} parts total (${catalog.parts.length} curated + ${sortedNew.length} new)`);
console.log(`Skipped ${skippedHandles.length} curated handles: ${skippedHandles.join(', ')}`);

// ── Generate catalog-assets.md ────────────────────────────────────────────────
const lines = [];

lines.push('# Catalog Assets Coverage Table');
lines.push('');
lines.push('> Auto-generated by `scripts/merge-inventory.mjs`. Do not edit manually — re-run the script.');
lines.push('');
lines.push('## Staging Rule');
lines.push('');
lines.push('Inventory `assembly-part` products that are **not** among the 15 curated wizard parts are stored with `slot: "standalone"` and `tier: 3`. They cannot join the 3D wizard until Task 6 provides:');
lines.push('');
lines.push('1. Socket definitions (`sockets`, `mount`)');
lines.push('2. A parametric placeholder spec (`placeholder`)');
lines.push('3. A slot flip to the correct wizard slot (`fixture` / `arm` / `pole` / `baseCover`)');
lines.push('');
lines.push('To find upgrade candidates: `catalog.parts.filter(p => p.productClass === "assembly-part" && p.slot === "standalone")`');
lines.push('');
lines.push('## Batch Priorities');
lines.push('');
lines.push('| Priority | Batch | Description |');
lines.push('|----------|-------|-------------|');
lines.push('| **P1** | M1 / Task 6 | WiLLstudio assembly-parts (arms, poles, base covers) — upgrade from standalone to wizard slot by adding sockets + placeholder. These are the core configurator products. |');
lines.push('| **P2** | M2 | WiLLstudio standalone luminaires (bollard, wall mount, ceiling, flood) — photo-card display only; no wizard role. |');
lines.push('| **P3** | M3+ | NAFCO, WiLLsport, WiLLev, WiLLcloud products — catalog reference / product-finder; photo-card display only. |');
lines.push('');
lines.push('## Product Coverage');
lines.push('');
lines.push('| Name | Line | Category | Class | Tier | Status |');
lines.push('|------|------|----------|-------|------|--------|');

for (const part of mergedCatalog.parts) {
  const status = statusLabel(part);
  const tier   = part.tier ?? '—';
  lines.push(`| ${part.name} | ${part.line} | ${part.category} | ${part.productClass} | ${tier} | ${status} |`);
}

lines.push('');
lines.push(`_Table generated ${new Date().toISOString()} — ${mergedCatalog.parts.length} total parts (${catalog.parts.length} tier-2 curated + ${sortedNew.length} tier-3 inventory)_`);
lines.push('');

const assetsContent = lines.join('\n');
writeFileSync(ASSETS_MD_PATH, assetsContent, 'utf8');
console.log(`catalog-assets.md written — ${mergedCatalog.parts.length} rows`);

// ── Summary stats ─────────────────────────────────────────────────────────────
const byLine = {};
for (const p of sortedNew) {
  byLine[p.line] = (byLine[p.line] ?? 0) + 1;
}
console.log('\nNew entries by line:');
for (const [line, count] of Object.entries(byLine).sort()) {
  console.log(`  ${line}: ${count}`);
}
console.log(`\nInventory total: ${inventory.totalProducts}  |  Curated handles mapped: ${skippedHandles.length}  |  New entries: ${sortedNew.length}`);
console.log(`Expected new entries = ${inventory.totalProducts} - ${skippedHandles.length} = ${inventory.totalProducts - skippedHandles.length} ✓`);
