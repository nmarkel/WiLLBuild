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
  'fiberglass-light-poles':   { line: 'NAFCO', category: 'pole',           specificity: 10 }, // pages/products lists fiberglass poles under NAFCO
  'light-pole-accessories':   { line: 'NAFCO', category: 'accessory',      specificity: 9  }, // pages/products lists pole accessories under NAFCO
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

/**
 * ── Official site taxonomy ────────────────────────────────────────────────────
 * Mirror of https://willbrands.com/pages/products (fetched 2026-07-20): each
 * brand line lists its official product categories in page order. An entry
 * points at either a single product handle (`product`) or a Shopify collection
 * handle (`collection`) whose members all belong to that category.
 *
 * `category` becomes the display category on catalog parts (CatalogNav pills,
 * PhotoCard chips), replacing the machine slug — which is preserved separately
 * as `categorySlug` for classification and family derivation.
 *
 * Resolution order per product:
 *   1. exact product-handle entry
 *   2. title brand prefix fixes the line; first same-line collection entry
 *      (page order) supplies the category
 *   3. first matching collection entry (page order) supplies line + category
 *   4. legacy heuristics (LINE_COLLECTION_MAP + title keywords), category
 *      label humanized via FALLBACK_CATEGORY_LABEL
 */
const SITE_TAXONOMY = [
  // ── NAFCO® Commercial ──
  { line: 'NAFCO', category: 'CHX Cobrahead',                      product: 'nafco-chx-cobrahead' },
  { line: 'NAFCO', category: 'SHX Shoebox',                        product: 'nafco-shx-shoebox' },
  { line: 'NAFCO', category: 'SLX Slim Area',                      product: 'slx' },
  { line: 'NAFCO', category: 'WCX Wall Mount',                     product: 'nafco-wcx-wall-mount' },
  { line: 'NAFCO', category: 'Light Poles - Aluminum',             collection: 'aluminum-light-poles', slug: 'pole' },
  { line: 'NAFCO', category: 'Light Poles - Steel',                collection: 'steel-light-poles', slug: 'pole' },
  { line: 'NAFCO', category: 'Light Poles - Fiberglass',           collection: 'fiberglass-light-poles', slug: 'pole' },
  { line: 'NAFCO', category: 'Brackets + Arms',                    collection: 'brackets-arms', slug: 'arm' },
  { line: 'NAFCO', category: 'NTX Prewired Pole Lighting',         product: 'nafco-ntx-pole-slim-area-light' },
  { line: 'NAFCO', category: 'Pre-Cast Concrete Light Pole Bases', product: 'nafco-pre-cast-concrete-light-pole-bases' },
  { line: 'NAFCO', category: 'Light Pole Accessories',             collection: 'light-pole-accessories', slug: 'accessory' },
  // ── WiLLsport® Sports & Large-Area ──
  { line: 'WiLLsport', category: 'KBX Lighting System',                  product: 'willsport-kbx-lighting-system' },
  { line: 'WiLLsport', category: 'HSX Sportslighter',                    product: 'willsport-hsx-sportslighter' },
  { line: 'WiLLsport', category: 'GTX High-Output Area',                 product: 'willsport-gtx-high-output-area' },
  { line: 'WiLLsport', category: 'HDX High Bay',                         product: 'willsport-hdx-high-bay-sports' },
  { line: 'WiLLsport', category: 'HDX Area / Flood / Sports',            product: 'willsport-hdx-area-flood-sports' },
  { line: 'WiLLsport', category: 'EBX Slim High Bay',                    product: 'willsport-ebx-slim-high-bay' },
  { line: 'WiLLsport', category: 'Sports Poles + Crossarms',             product: 'sports-poles-cross-arms' },
  { line: 'WiLLsport', category: 'Sports Poles + Crossarms',             collection: 'light-poles-crossarms', slug: 'pole' },
  { line: 'WiLLsport', category: 'Sports & Large Area Brackets',         product: 'willsport-sports-large-area-brackets-arms' },
  { line: 'WiLLsport', category: 'PDX Power Distribution & Controls Hub', product: 'willsport-pdx-sports-large-area-power-distribution-controls-hub' },
  { line: 'WiLLsport', category: 'RPCX Remote Power Control',            product: 'willsport-rpcx-sports-large-area-remote-power-control' },
  { line: 'WiLLsport', category: 'Wrestling Dual Light Packages',        product: 'willsport-wrestling-dual-light-packages' },
  // ── WiLLstudio® Architectural & Decorative ──
  { line: 'WiLLstudio', category: 'RXB / SXB Bollard',          product: 'willstudio-rxb-sxb-bollard' },
  { line: 'WiLLstudio', category: 'DRX Post Top & Area',        product: 'willstudio-drx-post-top-area' },
  { line: 'WiLLstudio', category: 'GVX Pendant',                product: 'willstudio-gvx-pendant' },
  { line: 'WiLLstudio', category: 'MVX Coach',                  product: 'willstudio-mvx-coach' },
  { line: 'WiLLstudio', category: 'TEX Post Top & Area',        product: 'willstudio-tex-post-top-area' },
  { line: 'WiLLstudio', category: 'DWX Flood & Spot',           product: 'willstudio-dwx-flood-spot' },
  { line: 'WiLLstudio', category: 'Decorative Light Poles',     collection: 'decorative-light-poles', slug: 'pole' },
  { line: 'WiLLstudio', category: 'Decorative Brackets & Arms', collection: 'decorative-brackets-arms', slug: 'arm' },
  { line: 'WiLLstudio', category: 'Decorative Base Covers',     product: 'willstudio-decorative-base-covers' },
  // ── WILLev™ Charging Site Infrastructure ──
  { line: 'WiLLev', category: 'EVSE L2 Charging Pedestals',    product: 'willev-evse-charging-pedestals' },
  { line: 'WiLLev', category: 'NTX Prewired Pole Lighting',    product: 'willev-ntx-pole-slim-area-light' },
  // ── WiLLcloud® Software & Controls ──
  { line: 'WiLLcloud', category: 'GFD Sports & Entertainment Controls',     product: 'gfd-wireless-controls' },
  { line: 'WiLLcloud', category: 'WiLLcloud+ Lighting Management Platform', product: 'willcloud-plus' },
];

const TAXONOMY_BY_PRODUCT = new Map(
  SITE_TAXONOMY.filter(e => e.product).map(e => [e.product, e]),
);

/** Human label for a machine category slug when no site-taxonomy entry applies. */
const FALLBACK_CATEGORY_LABEL = {
  fixture: 'Fixtures',
  arm: 'Brackets & Arms',
  pole: 'Poles',
  'base-cover': 'Base Covers',
  accessory: 'Accessories',
  controls: 'Controls',
  'ev-charging': 'EV Charging',
  other: 'Other',
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
function assignTaxonomy(handle, title, collectionHandles) {
  // Machine slug via the legacy heuristics — still drives productClass and family.
  const legacy = assignLine(title, collectionHandles);
  const categorySlug = legacy.category;
  const brand = titleBrandPrefix(title);

  // 1. Exact product-handle entry on the products page
  const exact = TAXONOMY_BY_PRODUCT.get(handle);
  if (exact) return { line: exact.line, category: exact.category, categorySlug };

  // 2/3. Collection entries in page order; when a product sits in several
  // taxonomy collections, prefer the one whose slug hint matches the
  // product's machine type (a bullhorn arm in both decorative-light-poles and
  // decorative-brackets-arms belongs under the arms category).
  const colEntries = SITE_TAXONOMY.filter(
    e => e.collection && collectionHandles.includes(e.collection),
  );
  const pick = entries =>
    entries.find(e => !e.slug || e.slug === categorySlug) ?? entries[0] ?? null;
  if (brand) {
    const sameLine = pick(colEntries.filter(e => e.line === brand));
    return {
      line: brand,
      category: sameLine ? sameLine.category : FALLBACK_CATEGORY_LABEL[categorySlug] ?? categorySlug,
      categorySlug,
    };
  }
  const best = pick(colEntries);
  if (best) {
    return { line: best.line, category: best.category, categorySlug };
  }

  // 4. Legacy fallback with a humanized label
  return {
    line: legacy.line,
    category: FALLBACK_CATEGORY_LABEL[categorySlug] ?? categorySlug,
    categorySlug,
  };
}

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
const STANDALONE_FIXTURE_PATTERN = /bollard|wall.*mount|wall\s+tenon|ceiling|flood|spot/i;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with polite pacing + retry on 429/5xx (honors Retry-After, up to 6 attempts). */
async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    console.log(`  GET ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || attempt * 15000;
      console.log(`  HTTP ${res.status} — waiting ${wait / 1000}s (attempt ${attempt}/6)`);
      await sleep(wait);
      continue;
    }
    return res;
  }
}

async function loadFromNetwork() {
  console.log('Fetching from network...');

  // Fetch all product pages
  const allProducts = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${BASE_URL}/products.json?limit=250&page=${page}`;
    const res = await fetchJson(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const data = await res.json();
    const prods = data.products || [];
    if (prods.length === 0) break;
    allProducts.push(...prods);
    await sleep(2000);
  }
  console.log(`  Total raw products: ${allProducts.length}`);

  // Fetch per-collection product lists
  const collectionProducts = {};
  for (const handle of Object.keys(LINE_COLLECTION_MAP)) {
    const url = `${BASE_URL}/collections/${handle}/products.json?limit=250`;
    const res = await fetchJson(url);
    if (!res.ok) {
      console.warn(`  WARNING: HTTP ${res.status} for collection ${handle}`);
      collectionProducts[handle] = [];
      continue;
    }
    const data = await res.json();
    collectionProducts[handle] = data.products || [];
    await sleep(2000);
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
      const { line, category, categorySlug } = assignTaxonomy(handle, p.title, collectionHandles);
      const dropShip = isDropShip(p.title, collectionHandles);
      const productClass = classifyProduct(p.title, line, categorySlug);

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
        categorySlug,
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

  // Ordered official categories per line (page order, deduped) — consumed by
  // merge-inventory.mjs to write catalog.json's `categories` nav-ordering map.
  const taxonomy = {};
  for (const e of SITE_TAXONOMY) {
    if (!taxonomy[e.line]) taxonomy[e.line] = [];
    if (!taxonomy[e.line].includes(e.category)) taxonomy[e.line].push(e.category);
  }

  // Write output
  mkdirSync('docs', { recursive: true });
  const output = {
    generated: new Date().toISOString(),
    source: cacheDir ? `cache:${cacheDir}` : BASE_URL,
    heuristics: {
      category: 'Official category from the pages/products site taxonomy (exact product handle, else collection membership in page order); categorySlug keeps the machine slug for classification. Unmatched products get a humanized slug label.',
      lineAssignment: 'Title brand prefix (WiLLstudio®/NAFCO®/WiLLsport®/WiLLev™/WiLLcloud™) takes priority; then the pages/products taxonomy entry; highest-specificity collection handle is the fallback (nafco-site-area-copy is catch-all, specificity=1).',
      dropShip: 'Products without a WiLL/NAFCO brand prefix in the title are marked dropShip:true (third-party or generic accessories). Exception: all products in tesla-ntx-order-form are WiLL-sold EV hardware → dropShip:false.',
      productClass: 'assembly-part = WiLLstudio arms/poles/base-covers + pole-top fixtures that mount on a WiLLstudio pole system. WiLLstudio standalone luminaires (bollard, wall mount, ceiling, flood, spot) are standalone. All other products are standalone.',
    },
    totalProducts: inventory.length,
    perLineCounts: lineCounts,
    taxonomy,
    products: inventory,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${inventory.length} products to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
