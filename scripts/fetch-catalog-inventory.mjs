#!/usr/bin/env node
/**
 * fetch-catalog-inventory.mjs
 *
 * Builds docs/catalog-inventory.json from willbrands.com's Shopify JSON API.
 *
 * Usage:
 *   node scripts/fetch-catalog-inventory.mjs                     # live network
 *   node scripts/fetch-catalog-inventory.mjs --from-cache <dir>  # use cached API responses
 *
 * Cache directory layout (matches controller-scouted scratchpad):
 *   products-p{N}.json        – raw Shopify products.json pages
 *   collections.json          – raw Shopify collections.json
 *   collections/<handle>.json – per-collection product lists
 *
 * ── Line → collection map ──────────────────────────────────────────────────────
 * The real product catalog is the UNION of products in these line collections.
 * vendor / product_type are uniformly "WiLL-brands" / "" and not useful.
 * Line assignment rules (priority order):
 *   1. Title brand prefix  →  WiLLstudio® / NAFCO® / WiLLsport® / WiLLev™ / WiLLcloud™
 *   2. Collection handle   →  prefer highest-specificity collection (see SPECIFICITY)
 * ── Drop-ship heuristic ────────────────────────────────────────────────────────
 * WiLL's in-house lines carry the brand name in the title (® or ™ mark).
 * Products in line collections WITHOUT such a brand prefix are third-party
 * accessories or generic products sourced externally → dropShip: true.
 * Exception: products in `tesla-ntx-order-form` are WiLL-sold EV products
 * (WiLL resells Tesla EV charging hardware under the WiLLev umbrella) → dropShip: false.
 * ── Specificity ranking ────────────────────────────────────────────────────────
 * `nafco-site-area-copy` is a catch-all marketing collection that contains
 * virtually all products.  Assigning line/category from it first corrupts
 * classifications for WiLLsport poles, WiLLstudio arms, etc.  Each collection
 * is given a specificity rank (higher = more specific); when a product appears
 * in multiple collections, the highest-rank entry wins the fallback assignment.
 * Title brand-prefix STILL takes priority over all collections.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, cwd } from 'node:process';

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = 'https://willbrands.com';
const OUT_PATH = resolve(cwd(), 'docs/catalog-inventory.json');

/**
 * Line collection map:
 *   key   = Shopify collection handle
 *   value = { line, category, specificity }
 *
 * Products may appear in multiple collections; line/category is resolved via
 * title-prefix first, then the highest-specificity collection as fallback.
 *
 * specificity: higher = more specific; catch-all collections score lowest (1).
 * Specific product-type collections (e.g. 'aluminum-light-poles') score highest (10).
 *
 * Note on tesla-ntx-order-form:
 *   All products in this collection are WiLL-sold EV products (WiLL resells
 *   Tesla EV charging hardware under the WiLLev umbrella). Membership here
 *   overrides the drop-ship heuristic: dropShip = false for these products.
 */
const LINE_COLLECTION_MAP = {
  // ── WiLLstudio ──────────────────────────────────────────────────── spec:10 ──
  architectural:              { line: 'WiLLstudio', category: 'fixture',   specificity: 10 },
  'decorative-light-poles':   { line: 'WiLLstudio', category: 'pole',      specificity: 10 },
  'decorative-brackets-arms': { line: 'WiLLstudio', category: 'arm',       specificity: 10 },
  'fiberglass-light-poles':   { line: 'WiLLstudio', category: 'pole',      specificity: 10 }, // no brand prefix; WiLLstudio context
  'light-pole-accessories':   { line: 'WiLLstudio', category: 'accessory', specificity: 9  },
  // ── NAFCO ───────────────────────────────────────────────────────── spec:10 ──
  'light-poles-arms':         { line: 'NAFCO', category: 'pole',           specificity: 10 }, // poles & arms
  'site-area':                { line: 'NAFCO', category: 'fixture',        specificity: 10 },
  'brackets-arms':            { line: 'NAFCO', category: 'arm',            specificity: 10 },
  'aluminum-light-poles':     { line: 'NAFCO', category: 'pole',           specificity: 10 },
  'steel-light-poles':        { line: 'NAFCO', category: 'pole',           specificity: 10 },
  // catch-all — LOWEST specificity so it never wins over any specific collection
  'nafco-site-area-copy':     { line: 'NAFCO', category: 'fixture',        specificity: 1  },
  // ── WiLLsport ───────────────────────────────────────────────────── spec:10 ──
  willsport:                  { line: 'WiLLsport', category: 'fixture',    specificity: 9  },
  'light-poles-crossarms':    { line: 'WiLLsport', category: 'pole',       specificity: 10 }, // Sports Poles & Cross Arms — more specific than willsport umbrella
  // ── WiLLev ──────────────────────────────────────────────────────── spec:10 ──
  willev:                     { line: 'WiLLev', category: 'ev-charging',   specificity: 10 },
  'tesla-ntx-order-form':     { line: 'WiLLev', category: 'ev-charging',   specificity: 10 },
  // ── WiLLcloud ───────────────────────────────────────────────────── spec:10 ──
  'willcloud-lighting-controls': { line: 'WiLLcloud', category: 'controls', specificity: 10 },
  'controls-accessories':     { line: 'WiLLcloud', category: 'controls',   specificity: 9  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect the WiLL brand prefix in a product title.
 * Returns: 'WiLLstudio' | 'NAFCO' | 'WiLLsport' | 'WiLLev' | 'WiLLcloud' | null
 */
function titleBrandPrefix(title) {
  if (/willstudio/i.test(title))  return 'WiLLstudio';
  if (/nafco/i.test(title))       return 'NAFCO';
  if (/willsport/i.test(title))   return 'WiLLsport';
  if (/willev/i.test(title) || /\bntx\b/i.test(title) && /tesla/i.test(title)) return 'WiLLev';
  if (/willcloud/i.test(title) || /gfd\s+wireless/i.test(title)) return 'WiLLcloud';
  return null;
}

/**
 * Assign { line, category } to a product given its seen-in collections.
 * Priority: title-brand > highest-specificity collection > keyword inference.
 * The catch-all `nafco-site-area-copy` (specificity=1) is only chosen when no
 * other mapped collection is present.
 *
 * Title-inferred category overrides the collection category when the title
 * keywords point to a specific product type (base-cover, pole, arm) and the
 * collection only supplies a generic bucket (e.g. 'accessory' or 'fixture').
 * This handles cases like "Aluminum Light Pole Base Covers" landing in the
 * `light-pole-accessories` collection (category='accessory') — the title wins.
 */
function assignLine(title, collectionHandles) {
  const brand = titleBrandPrefix(title);

  // Title-keyword category always beats a generic collection bucket.
  // 'fixture' is the generic default — don't let it override a specific
  // collection category, but do let base-cover / pole / arm / etc. win.
  const titleCategory = inferCategoryFromTitle(title);

  if (brand) {
    // Find the highest-specificity matching collection entry for category context
    const matchingCols = collectionHandles
      .map(h => LINE_COLLECTION_MAP[h])
      .filter(e => e && e.line === brand)
      .sort((a, b) => b.specificity - a.specificity);
    const colCategory = matchingCols.length > 0
      ? matchingCols[0].category
      : inferCategory(title, collectionHandles);
    // Title-keyword wins when it's more specific than the collection's guess
    const category = titleCategory !== null ? titleCategory : colCategory;
    return { line: brand, category };
  }
  // Fallback: highest-specificity collection in our map
  const mappedCols = collectionHandles
    .map(h => LINE_COLLECTION_MAP[h])
    .filter(Boolean)
    .sort((a, b) => b.specificity - a.specificity);
  if (mappedCols.length > 0) {
    const colCategory = mappedCols[0].category;
    const category = titleCategory !== null ? titleCategory : colCategory;
    return { line: mappedCols[0].line, category };
  }
  return { line: 'Other', category: titleCategory ?? 'other' };
}

/**
 * Infer category purely from title keywords (no collection context).
 * Returns null when title provides no clear signal — letting the collection
 * category stand in the caller.
 */
function inferCategoryFromTitle(title) {
  const t = title.toLowerCase();
  if (/base cover/.test(t)) return 'base-cover';
  if (/pole|mast/.test(t) && !/pole\s+(top|mount|slim|area)/.test(t)) return 'pole';
  if (/\b(arm|bracket|crossarm|bullhorn|upsweep|spoke|hook)\b/.test(t)) return 'arm';
  if (/base cover|cover/.test(t)) return 'base-cover';
  if (/\bevse\b|ev\s+charge|charging pedestal/.test(t)) return 'ev-charging';
  return null; // no strong title signal
}

/**
 * Infer category from title keywords when line is clear but collection mapping
 * doesn't give enough detail (e.g. a WiLLev product in the WiLLstudio fixture col).
 * Also used as fallback for products only in the catch-all collection.
 */
function inferCategory(title, handles) {
  const t = title.toLowerCase();
  // base-cover check before generic 'cover' to avoid false matches
  if (/base cover/.test(t)) return 'base-cover';
  if (/pole|mast/.test(t)) return 'pole';
  if (/arm|bracket|crossarm|bullhorn|upsweep|spoke|hook/.test(t)) return 'arm';
  if (/cover/.test(t)) return 'base-cover';
  if (/charging|evse|pedestal/.test(t)) return 'ev-charging';
  if (/control|wireless/.test(t)) return 'controls';
  if (/accessory|adapter|cap|bolt|anchor/.test(t)) return 'accessory';
  // Derive from collection (highest-specificity first)
  const mappedCols = handles
    .map(h => LINE_COLLECTION_MAP[h])
    .filter(Boolean)
    .sort((a, b) => b.specificity - a.specificity);
  if (mappedCols.length > 0) return mappedCols[0].category;
  return 'fixture';
}

/**
 * Determine productClass.
 * 'assembly-part': fixtures, arms, poles, base covers, crossarms that mount on a
 *                  pole system — i.e., the parts of a WiLLstudio pole system.
 * 'standalone': everything else (area lights, EVSEs, controls, sportslighters, etc.)
 *
 * WiLLstudio standalone luminaires (bollards, wall mounts, ceiling pendants,
 * floods/spots) do NOT mount on the pole system → productClass 'standalone'.
 * Negative keywords: bollard, wall mount, ceiling, flood, spot (when not in
 * an arm/pole context).
 */
const STANDALONE_FIXTURE_PATTERN = /bollard|wall\s+mount|ceiling|flood|spot/i;

function classifyProduct(title, line, category) {
  // Only WiLLstudio pole-system parts are assembly-parts.
  if (line !== 'WiLLstudio') return 'standalone';

  // Base covers are always assembly-parts
  if (category === 'base-cover') return 'assembly-part';

  const assemblyCategories = ['arm', 'pole'];
  if (assemblyCategories.includes(category)) return 'assembly-part';

  if (category === 'fixture') {
    // WiLLstudio fixtures that are NOT pole-top luminaires go standalone.
    // Affected: DWX flood/spot, RXB/SXB bollard, WM1/WM2 wall mounts,
    //           pendant ceiling mounts (non-pole-top).
    if (STANDALONE_FIXTURE_PATTERN.test(title)) return 'standalone';
    return 'assembly-part';
  }

  // Also check title keywords for decorative crossarms/arms that might be cat=arm
  const t = title.toLowerCase();
  if (/arm|bracket|crossarm|hook|shepherds|pendant arm|upsweep|suspension/.test(t)) return 'assembly-part';
  if (/decorative.*pole|decorative.*base/.test(t)) return 'assembly-part';
  return 'standalone';
}

/**
 * Drop-ship detection: products WITHOUT a WiLL/NAFCO brand prefix in the title
 * are third-party or generic accessories → dropShip: true.
 * Exception: products in `tesla-ntx-order-form` are WiLL-sold EV hardware
 * (WiLL resells Tesla EV charging products under the WiLLev brand umbrella)
 * → dropShip: false regardless of title prefix.
 */
function isDropShip(title, collectionHandles) {
  // Tesla collection members are always in-house (WiLLev sold)
  if (collectionHandles.includes('tesla-ntx-order-form')) return false;
  return titleBrandPrefix(title) === null;
}

/**
 * Non-product filter: Shopify stores sometimes place install galleries, design
 * library concept cards, and newsroom posts inside product collections.
 * These are never purchasable; exclude them from the inventory.
 * Signal: presence of 'Featured Installs', 'Design Library', 'Careers', or
 * 'Newsroom' in the product's Shopify tags.
 */
const NON_PRODUCT_TAGS = new Set(['Featured Installs', 'Design Library', 'Careers', 'Newsroom', 'Apparel']);
function isNonProduct(tags) {
  return (tags || []).some(t => NON_PRODUCT_TAGS.has(t));
}

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadFromCache(cacheDir) {
  console.log(`Loading from cache: ${cacheDir}`);

  // Load all products pages
  const allProducts = [];
  for (let page = 1; page <= 10; page++) {
    const fPath = join(cacheDir, `products-p${page}.json`);
    if (!existsSync(fPath)) break;
    const data = JSON.parse(readFileSync(fPath, 'utf8'));
    const prods = data.products || [];
    if (prods.length === 0) break;
    allProducts.push(...prods);
    console.log(`  products-p${page}.json: ${prods.length} products`);
  }
  console.log(`  Total raw products: ${allProducts.length}`);

  // Load per-collection product lists
  const collectionProducts = {}; // handle → products[]
  for (const handle of Object.keys(LINE_COLLECTION_MAP)) {
    const fPath = join(cacheDir, 'collections', `${handle}.json`);
    if (!existsSync(fPath)) {
      console.warn(`  WARNING: Missing collection cache file: ${handle}.json`);
      continue;
    }
    const data = JSON.parse(readFileSync(fPath, 'utf8'));
    collectionProducts[handle] = data.products || [];
    console.log(`  collection/${handle}: ${collectionProducts[handle].length} products`);
  }

  return { allProducts, collectionProducts };
}

async function loadFromNetwork() {
  console.log('Fetching from network...');

  // Fetch all product pages
  const allProducts = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${BASE_URL}/products.json?limit=250&page=${page}`;
    console.log(`  GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const data = await res.json();
    const prods = data.products || [];
    if (prods.length === 0) break;
    allProducts.push(...prods);
  }
  console.log(`  Total raw products: ${allProducts.length}`);

  // Fetch per-collection product lists
  const collectionProducts = {};
  for (const handle of Object.keys(LINE_COLLECTION_MAP)) {
    const url = `${BASE_URL}/collections/${handle}/products.json?limit=250`;
    console.log(`  GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  WARNING: HTTP ${res.status} for collection ${handle}`);
      collectionProducts[handle] = [];
      continue;
    }
    const data = await res.json();
    collectionProducts[handle] = data.products || [];
  }

  return { allProducts, collectionProducts };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Parse args
  const args = argv.slice(2);
  let cacheDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-cache' && args[i + 1]) {
      cacheDir = resolve(args[i + 1]);
      i++;
    }
  }

  const { allProducts, collectionProducts } = cacheDir
    ? await loadFromCache(cacheDir)
    : await loadFromNetwork();

  // Build handle → collections[] map from the line collections
  const handleToCollections = {}; // handle → Set<collectionHandle>
  for (const [colHandle, products] of Object.entries(collectionProducts)) {
    for (const p of products) {
      if (!handleToCollections[p.handle]) handleToCollections[p.handle] = new Set();
      handleToCollections[p.handle].add(colHandle);
    }
  }

  // Build a raw product lookup by handle (from bulk products pages)
  const productsByHandle = {};
  for (const p of allProducts) {
    productsByHandle[p.handle] = p;
  }

  // Normalize: iterate over handles found in line collections (dedupe by handle)
  const inventory = [];
  const seen = new Set();

  for (const [colHandle, products] of Object.entries(collectionProducts)) {
    for (const rawProduct of products) {
      const handle = rawProduct.handle;
      if (seen.has(handle)) continue;
      seen.add(handle);

      // Merge with bulk data if available (bulk pages have same fields)
      const p = productsByHandle[handle] || rawProduct;

      // Skip non-products (install galleries, design library cards, newsroom posts)
      if (isNonProduct(p.tags)) continue;

      const collectionHandles = [...(handleToCollections[handle] || [colHandle])];
      const { line, category } = assignLine(p.title, collectionHandles);
      const dropShip = isDropShip(p.title, collectionHandles);
      const productClass = classifyProduct(p.title, line, category);

      const firstImage = (p.images && p.images.length > 0) ? p.images[0].src : null;
      const variantCount = (p.variants || []).length;

      const bodyText = stripHtml(p.body_html || '');
      const excerpt = bodyText.length > 300 ? bodyText.slice(0, 297) + '...' : bodyText;

      // id: Shopify numeric product id (stringified) from raw data; fall back to handle
      const id = p.id != null ? String(p.id) : handle;

      inventory.push({
        handle,
        id,
        title: p.title,
        line,
        category,
        productClass,
        dropShip,
        productUrl: `${BASE_URL}/products/${handle}`,
        image: firstImage,
        variantCount,
        excerpt,
      });
    }
  }

  // Sort by line, then title
  inventory.sort((a, b) => {
    if (a.line < b.line) return -1;
    if (a.line > b.line) return 1;
    return a.title.localeCompare(b.title);
  });

  // Print per-line counts
  const lineCounts = {};
  const lineDropShip = {};
  for (const item of inventory) {
    lineCounts[item.line] = (lineCounts[item.line] || 0) + 1;
    if (item.dropShip) lineDropShip[item.line] = (lineDropShip[item.line] || 0) + 1;
  }
  console.log('\n── Per-line counts ──────────────────────────────');
  for (const [line, count] of Object.entries(lineCounts).sort()) {
    const ds = lineDropShip[line] || 0;
    console.log(`  ${line.padEnd(14)} ${String(count).padStart(3)} products  (${ds} drop-ship)`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(inventory.length).padStart(3)} products`);
  console.log('─────────────────────────────────────────────────\n');

  // Write output
  mkdirSync('docs', { recursive: true });
  const output = {
    generated: new Date().toISOString(),
    source: cacheDir ? `cache:${cacheDir}` : BASE_URL,
    heuristics: {
      lineAssignment: 'Title brand prefix (WiLLstudio®/NAFCO®/WiLLsport®/WiLLev™/WiLLcloud™) takes priority; highest-specificity collection handle is the fallback (nafco-site-area-copy is catch-all, specificity=1).',
      dropShip: 'Products without a WiLL/NAFCO brand prefix in the title are marked dropShip:true (third-party or generic accessories). Exception: all products in tesla-ntx-order-form are WiLL-sold EV hardware → dropShip:false.',
      productClass: 'assembly-part = WiLLstudio arms/poles/base-covers + pole-top fixtures that mount on a WiLLstudio pole system. WiLLstudio standalone luminaires (bollard, wall mount, ceiling, flood, spot) are standalone. All other products are standalone.',
    },
    totalProducts: inventory.length,
    perLineCounts: lineCounts,
    products: inventory,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${inventory.length} products to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
