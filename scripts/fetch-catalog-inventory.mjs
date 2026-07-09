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
 *   2. Collection handle   →  fallback per the map below
 * ── Drop-ship heuristic ────────────────────────────────────────────────────────
 * WiLL's in-house lines carry the brand name in the title (® or ™ mark).
 * Products in line collections WITHOUT such a brand prefix are third-party
 * accessories or generic products sourced externally → dropShip: true.
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
 *   value = { line, category }
 *
 * Products may appear in multiple collections; line is resolved via title-prefix
 * first, then this map as fallback.
 *
 * Aluminum/steel pole collections contain no branded prefixes in their titles,
 * so they're NAFCO (commercial poles) unless a product also appears in a
 * WiLLstudio context (handled by title-prefix priority in assignLine()).
 */
const LINE_COLLECTION_MAP = {
  // ── WiLLstudio ──────────────────────────────────────────────────────────────
  architectural:              { line: 'WiLLstudio', category: 'fixture' },
  'decorative-light-poles':   { line: 'WiLLstudio', category: 'pole' },
  'decorative-brackets-arms': { line: 'WiLLstudio', category: 'arm' },
  'fiberglass-light-poles':   { line: 'WiLLstudio', category: 'pole' }, // generic fiberglass — no brand prefix; keep WiLLstudio context
  'light-pole-accessories':   { line: 'WiLLstudio', category: 'accessory' },
  // ── NAFCO ───────────────────────────────────────────────────────────────────
  'nafco-site-area-copy':     { line: 'NAFCO', category: 'fixture' },
  'light-poles-arms':         { line: 'NAFCO', category: 'pole' },      // commercial poles & arms
  'site-area':                { line: 'NAFCO', category: 'fixture' },
  'brackets-arms':            { line: 'NAFCO', category: 'arm' },
  'aluminum-light-poles':     { line: 'NAFCO', category: 'pole' },
  'steel-light-poles':        { line: 'NAFCO', category: 'pole' },
  // ── WiLLsport ───────────────────────────────────────────────────────────────
  willsport:                  { line: 'WiLLsport', category: 'fixture' },
  'light-poles-crossarms':    { line: 'WiLLsport', category: 'pole' },  // Sports Poles & Cross Arms
  // ── WiLLev ──────────────────────────────────────────────────────────────────
  willev:                     { line: 'WiLLev', category: 'ev-charging' },
  'tesla-ntx-order-form':     { line: 'WiLLev', category: 'ev-charging' },
  // ── WiLLcloud ───────────────────────────────────────────────────────────────
  'willcloud-lighting-controls': { line: 'WiLLcloud', category: 'controls' },
  'controls-accessories':     { line: 'WiLLcloud', category: 'controls' },
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
 * Priority: title-brand > collection.
 */
function assignLine(title, collectionHandles) {
  const brand = titleBrandPrefix(title);
  if (brand) {
    // Find a matching collection entry for category context
    const col = collectionHandles.find(h => {
      const entry = LINE_COLLECTION_MAP[h];
      return entry && entry.line === brand;
    });
    const category = col ? LINE_COLLECTION_MAP[col].category : inferCategory(title, collectionHandles);
    return { line: brand, category };
  }
  // Fallback: first collection in priority order that's in our map
  for (const handle of collectionHandles) {
    const entry = LINE_COLLECTION_MAP[handle];
    if (entry) return { ...entry };
  }
  return { line: 'Other', category: 'other' };
}

/**
 * Infer category from title keywords when line is clear but collection mapping
 * doesn't give enough detail (e.g. a WiLLev product in the WiLLstudio fixture col).
 */
function inferCategory(title, handles) {
  const t = title.toLowerCase();
  if (/pole|mast/.test(t)) return 'pole';
  if (/arm|bracket|crossarm|bullhorn|upsweep|spoke|hook/.test(t)) return 'arm';
  if (/base cover|cover/.test(t)) return 'base-cover';
  if (/charging|evse|pedestal/.test(t)) return 'ev-charging';
  if (/control|wireless/.test(t)) return 'controls';
  if (/accessory|adapter|cap|bolt|anchor/.test(t)) return 'accessory';
  // Derive from collection
  for (const h of handles) {
    if (LINE_COLLECTION_MAP[h]) return LINE_COLLECTION_MAP[h].category;
  }
  return 'fixture';
}

/**
 * Determine productClass.
 * 'assembly-part': fixtures, arms, poles, base covers, crossarms that mount on a
 *                  pole system — i.e., the parts of a WiLLstudio pole system.
 * 'standalone': everything else (area lights, EVSEs, controls, sportslighters, etc.)
 */
function classifyProduct(title, line, category) {
  // Only WiLLstudio pole-system parts are assembly-parts.
  if (line !== 'WiLLstudio') return 'standalone';
  const assemblyCategories = ['fixture', 'arm', 'pole', 'base-cover'];
  if (assemblyCategories.includes(category)) return 'assembly-part';
  // Also check title keywords for decorative crossarms/arms that might be cat=arm
  const t = title.toLowerCase();
  if (/arm|bracket|crossarm|hook|shepherds|pendant arm|upsweep|suspension/.test(t)) return 'assembly-part';
  if (/decorative.*pole|decorative.*base/.test(t)) return 'assembly-part';
  return 'standalone';
}

/**
 * Drop-ship detection: products WITHOUT a WiLL/NAFCO brand prefix in the title
 * are third-party or generic accessories → dropShip: true.
 */
function isDropShip(title) {
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
      const dropShip = isDropShip(p.title);
      const productClass = classifyProduct(p.title, line, category);

      const firstImage = (p.images && p.images.length > 0) ? p.images[0].src : null;
      const variantCount = (p.variants || []).length;

      const bodyText = stripHtml(p.body_html || '');
      const excerpt = bodyText.length > 300 ? bodyText.slice(0, 297) + '...' : bodyText;

      inventory.push({
        handle,
        id: handle,
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
      lineAssignment: 'Title brand prefix (WiLLstudio®/NAFCO®/WiLLsport®/WiLLev™/WiLLcloud™) takes priority; collection handle is the fallback.',
      dropShip: 'Products without a WiLL/NAFCO brand prefix in the title are marked dropShip:true (third-party or generic accessories).',
      productClass: 'assembly-part = WiLLstudio fixtures/arms/poles/base-covers that mount on a WiLLstudio pole system. All other products are standalone.',
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
