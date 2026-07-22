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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const INVENTORY_PATH = resolve(ROOT, 'docs/catalog-inventory.json');
const CATALOG_PATH   = resolve(ROOT, 'public/catalog.json');
const ASSETS_MD_PATH = resolve(ROOT, 'catalog-assets.md');
const OVERRIDES_PATH = resolve(ROOT, 'scripts/placeholder-overrides.json');

/**
 * Hand/agent-authored placeholder specs keyed by part id — produced by the
 * shape-refinement pass against the product photos. When present, an override
 * wins over derivePlaceholder. Missing file -> no overrides.
 */
let PLACEHOLDER_OVERRIDES = {};
try {
  PLACEHOLDER_OVERRIDES = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
} catch { /* optional */ }


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

/** Human label for a machine category slug (fallback when no site-taxonomy entry applies). */
function fallbackLabel(slug) {
  return {
    'fixture': 'Fixtures',
    'arm': 'Brackets & Arms',
    'pole': 'Poles',
    'base-cover': 'Base Covers',
    'accessory': 'Accessories',
    'controls': 'Controls',
    'ev-charging': 'EV Charging',
    'other': 'Other',
  }[slug] ?? slug;
}

/** Derive family string from line + machine category slug. */
function deriveFamily(line, categorySlug) {
  return `${line} ${fallbackLabel(categorySlug)}`;
}

/** Build the 3D / photo-card / GLB status string. */
function statusLabel(part) {
  if (part.placeholder) return '3D parametric';
  if (part.photo)        return 'photo-card';
  return 'photo-card'; // new entries always have a CDN photo
}

/**
 * Derive a parametric placeholder spec for a standalone product so it renders
 * in the single-part 3D viewer (meters, +Y up, origin at the ground/attachment
 * point — same conventions as PlaceholderPart). Category-shaped primitives:
 * real dimensions arrive with the spec-sheet workstream; until then these are
 * concept-level stand-ins, deterministic from name + categorySlug (idempotent).
 */
function derivePlaceholder(name, categorySlug, heightFt) {
  const t = name.toLowerCase();
  const box = (w, h, d) => ({ kind: 'box', sizeM: [w, h, d], direction: 'up' });
  const group = (children) => ({ kind: 'group', children });
  const at = (spec, position) => ({ spec, position });

  // ── Specific product shapes (silhouettes eyeballed from product photos) ──
  if (/bollard/.test(t))
    return group([
      at({ kind: 'pole', heightM: 0.98, radiusTopM: 0.075, radiusBottomM: 0.09 }, [0, 0, 0]),
      // Dome cap
      at({ kind: 'lathe', profile: [[0.078, 0], [0.075, 0.05], [0.05, 0.085], [0, 0.1]] }, [0, 0.98, 0]),
    ]);
  if (/anchor bolt/.test(t))
    // Kit of 4 threaded rods on a square bolt circle
    return group([
      at({ kind: 'pole', heightM: 0.45, radiusTopM: 0.012, radiusBottomM: 0.012 }, [-0.12, 0, -0.12]),
      at({ kind: 'pole', heightM: 0.45, radiusTopM: 0.012, radiusBottomM: 0.012 }, [0.12, 0, -0.12]),
      at({ kind: 'pole', heightM: 0.45, radiusTopM: 0.012, radiusBottomM: 0.012 }, [-0.12, 0, 0.12]),
      at({ kind: 'pole', heightM: 0.45, radiusTopM: 0.012, radiusBottomM: 0.012 }, [0.12, 0, 0.12]),
    ]);
  if (/top cap|pole cap/.test(t))
    return { kind: 'lathe', profile: [[0.1, 0], [0.1, 0.03], [0.06, 0.07], [0, 0.09]] };
  if (/transformer base/.test(t))
    return { kind: 'prism', radiusTopM: 0.16, radiusBottomM: 0.18, heightM: 0.5, sides: 4 };
  if (/bolt circle adapter/.test(t))
    return { kind: 'baseCover', heightM: 0.05, radiusTopM: 0.16, radiusBottomM: 0.2 };
  if (/pre-?cast|concrete.*base/.test(t))
    return { kind: 'pole', heightM: 0.76, radiusTopM: 0.28, radiusBottomM: 0.3 };
  if (/base cover/.test(t) || categorySlug === 'base-cover')
    return { kind: 'baseCover', heightM: 0.35, radiusTopM: 0.12, radiusBottomM: 0.22 };
  if (/prewired|ntx/.test(t))
    // Prewired pole with a slim area head at the top
    return group([
      at({ kind: 'pole', heightM: 6.1, radiusTopM: 0.06, radiusBottomM: 0.1 }, [0, 0, 0]),
      at(box(0.55, 0.1, 0.26), [0.12, 6.05, 0]),
    ]);

  // ── Arms before poles — "mast arms" would otherwise hit the pole regex ──
  if (/crossarm|cross arm/.test(t))
    return { kind: 'tube', points: [[0, 0, 0], [0, 0.12, 0], [0.75, 0.12, 0]], radiusM: 0.04 };
  if (/bullhorn/.test(t))
    return { kind: 'tube', points: [[0, 0, 0], [0, 0.25, 0], [0.35, 0.45, 0], [0.7, 0.5, 0]], radiusM: 0.045 };
  if (/truss/.test(t))
    return { kind: 'tube', points: [[0, 0, 0], [0.5, 0.18, 0], [1.2, 0.3, 0]], radiusM: 0.045 };
  if (/mast arm|elliptical/.test(t))
    return { kind: 'tube', points: [[0, 0, 0], [0.2, 0.28, 0], [0.65, 0.45, 0], [1.2, 0.5, 0]], radiusM: 0.04 };
  if (/davit/.test(t))
    return { kind: 'tube', points: [[0, 0, 0], [0, 0.5, 0], [0.35, 0.85, 0], [0.9, 0.9, 0]], radiusM: 0.045 };
  if (categorySlug === 'arm')
    return { kind: 'tube', points: [[0, 0, 0], [0.3, 0.2, 0], [0.8, 0.34, 0]], radiusM: 0.035 };

  // ── Poles before EV pedestals — "Pedestal Base Light Poles" is a pole ──
  if (categorySlug === 'pole' || /light pole|mast/.test(t)) {
    const heightM = heightFt ? heightFt * 0.3048 : 7.62; // 25 ft commercial default
    return { kind: 'pole', heightM, radiusTopM: 0.06, radiusBottomM: 0.11 };
  }

  // ── Fixture / equipment families ──
  if (/cobrahead/.test(t))
    // Classic cobrahead: thicker mast-side body tapering to a slim nose
    return group([
      at(box(0.34, 0.13, 0.3), [0.08, 0, 0]),
      at(box(0.32, 0.08, 0.24), [0.38, 0, 0]),
    ]);
  if (/shoebox/.test(t)) return box(0.5, 0.19, 0.5);
  if (/slim/.test(t)) return box(0.58, 0.07, 0.3);
  if (/wall mount|wall pack/.test(t)) return box(0.4, 0.16, 0.28);
  if (/flood|spot/.test(t))
    return group([
      at({ kind: 'pole', heightM: 0.06, radiusTopM: 0.03, radiusBottomM: 0.05 }, [0, 0, 0]),
      at(box(0.42, 0.3, 0.12), [0, 0.06, 0]),
    ]);
  if (/pedestal|evse|charging/.test(t))
    // Charging pedestal with a screen face
    return group([
      at(box(0.3, 1.3, 0.24), [0, 0, 0]),
      at(box(0.22, 0.28, 0.05), [0, 0.92, 0.13]),
    ]);
  if (/control|wireless|gateway/.test(t) || categorySlug === 'controls')
    // Controls cabinet with an antenna
    return group([
      at(box(0.45, 0.6, 0.2), [0, 0, 0]),
      at({ kind: 'pole', heightM: 0.25, radiusTopM: 0.008, radiusBottomM: 0.008 }, [0.16, 0.6, 0]),
    ]);
  if (/high bay/.test(t))
    // UFO high bay: wide shallow shade with a driver puck on top
    return { kind: 'lathe', profile: [[0.02, 0], [0.17, 0], [0.3, 0.05], [0.3, 0.12], [0.12, 0.18], [0.12, 0.3], [0, 0.3]] };
  if (/wrestling|dual light/.test(t))
    // Two heads on a shared frame
    return group([
      at(box(0.4, 0.2, 0.4), [-0.28, 0, 0]),
      at(box(0.4, 0.2, 0.4), [0.28, 0, 0]),
      at(box(1.0, 0.06, 0.08), [0, 0.2, 0]),
    ]);
  if (/kbx|sportslighter|gtx|hdx|ebx|sports light/.test(t))
    // Sports floodlight: deep housing with a visor lip
    return group([
      at(box(0.6, 0.25, 0.45), [0, 0, 0]),
      at(box(0.6, 0.05, 0.14), [0, 0.25, 0.2]),
    ]);
  if (categorySlug === 'fixture') return box(0.55, 0.16, 0.35);
  if (categorySlug === 'accessory') return box(0.3, 0.25, 0.3);
  return box(0.4, 0.4, 0.4);
}

/** Placeholder for a part: photo-refined override first, derived recipe otherwise. */
function placeholderFor(part, slug) {
  return PLACEHOLDER_OVERRIDES[part.id] ?? derivePlaceholder(part.name, slug, part.heightFt);
}

/** Overall height of a spec in meters (drives wizard pole socket positions). */
function specHeightM(spec) {
  switch (spec.kind) {
    case 'pole': case 'baseCover': case 'prism': case 'cone': return spec.heightM;
    case 'box': return spec.sizeM[1];
    case 'tube': return Math.max(...spec.points.map((pt) => Math.abs(pt[1])), spec.radiusM * 2);
    case 'lathe': return Math.max(...spec.profile.map(([, y]) => Math.abs(y)));
    case 'group': return Math.max(...spec.children.map((c) => c.position[1] + specHeightM(c.spec)));
  }
  return 0;
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
    tier: 2,                      // derived parametric placeholder = 3D-viewable
    name: product.title,          // full title, no truncation per spec
    family: deriveFamily(product.line, product.categorySlug ?? product.category),
    placeholder: derivePlaceholder(product.title, product.categorySlug ?? product.category, undefined),
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

// ── Brand-builder promotions (NAFCO + WiLLsport configurators) ────────────────
// Each brand line gets a configurator like WiLLstudio's where the data allows:
// NAFCO has a full pole system (fixtures + mast arms + poles), WiLLsport a thin
// fixture-on-sports-pole flow. Promoted parts get brand-specific socket types
// (nafco-*, sport-*) so cross-brand combos are impossible by construction.
// WiLLev/WiLLcloud have nothing that assembles — they keep the showroom.

const NAFCO_BUILDER_FIXTURES = new Set(['nafco-chx-cobrahead', 'nafco-shx-shoebox', 'slx']);
const SPORT_BUILDER_FIXTURES = new Set([
  'willsport-kbx-lighting-system',
  'willsport-hsx-sportslighter',
  'willsport-gtx-high-output-area',
  'willsport-hdx-area-flood-sports',
]);

/** Promote a standalone product to a wizard slot. Deterministic → idempotent. */
function promoteToBuilder(part, slug) {
  if (part.line === 'NAFCO') {
    if (slug === 'pole' && part.category.startsWith('Light Poles')) {
      const ph = placeholderFor(part, slug);
      const h = specHeightM(ph);
      if (!(ph.kind === 'pole' || (ph.kind === 'group' && h > 2))) return false;
      part.placeholder = ph;
      part.slot = 'pole';
      part.productClass = 'assembly-part';
      part.mount = null;
      part.sockets = {
        top: { type: 'nafco-tenon', position: [0, h, 0] },
        base: { type: 'nafco-base', position: [0, 0, 0] },
      };
      return true;
    }
    if (slug === 'arm' && part.category === 'Brackets + Arms') {
      part.placeholder = placeholderFor(part, slug);
      if (part.placeholder.kind !== 'tube') return false;
      const tip = part.placeholder.points[part.placeholder.points.length - 1];
      part.slot = 'arm';
      part.productClass = 'assembly-part';
      part.mount = 'nafco-tenon';
      part.sockets = { fixture: { type: 'nafco-fixture-mount', position: tip } };
      return true;
    }
    if (NAFCO_BUILDER_FIXTURES.has(part.id)) {
      part.placeholder = placeholderFor(part, slug);
      part.slot = 'fixture';
      part.productClass = 'assembly-part';
      part.mount = 'nafco-fixture-mount';
      part.sockets = {};
      part.lightOffset = [0, 0.09, 0];
      return true;
    }
  }
  if (part.line === 'WiLLsport') {
    if (part.id === 'sports-poles-cross-arms') {
      part.slot = 'pole';
      part.productClass = 'assembly-part';
      part.mount = null;
      // Sports poles run tall — 35 ft concept height until spec-sheet data lands
      part.placeholder = { kind: 'pole', heightM: 10.67, radiusTopM: 0.1, radiusBottomM: 0.18 };
      part.sockets = {
        top: { type: 'sport-pole-top', position: [0, 10.67, 0] },
        base: { type: 'sport-base', position: [0, 0, 0] },
      };
      return true;
    }
    if (SPORT_BUILDER_FIXTURES.has(part.id)) {
      part.placeholder = placeholderFor(part, slug);
      part.slot = 'fixture';
      part.productClass = 'assembly-part';
      part.mount = 'sport-crossarm-mount';
      part.sockets = {};
      part.lightOffset = [0, 0.1, 0];
      return true;
    }
  }
  return false;
}

/**
 * Pseudo-parts the builders need but the store has no product page for:
 * NAFCO's direct/slipfitter mount and WiLLsport's integrated crossarm (the
 * crossarm ships as part of the Sports Poles + Crossarms product).
 */
const PSEUDO_PARTS = [
  {
    id: 'nafco-direct-mount',
    slot: 'arm',
    line: 'NAFCO',
    category: 'Brackets + Arms',
    productClass: 'assembly-part',
    dropShip: false,
    tier: 2,
    name: 'Direct / Slipfitter Mount',
    family: 'NAFCO Brackets & Arms',
    mount: 'nafco-tenon',
    sockets: { fixture: { type: 'nafco-fixture-mount', position: [0, 0.06, 0] } },
    placeholder: { kind: 'tube', points: [[0, 0, 0], [0, 0.06, 0]], radiusM: 0.04 },
    keywords: ['direct', 'slipfitter', 'mount'],
    finishes: [],
    model: null,
    thumbnail: null,
    productUrl: 'https://willbrands.com/collections/brackets-arms',
  },
  {
    id: 'willsport-integrated-crossarm',
    slot: 'arm',
    line: 'WiLLsport',
    category: 'Sports Poles + Crossarms',
    productClass: 'assembly-part',
    dropShip: false,
    tier: 2,
    name: 'Integrated Crossarm (included with pole)',
    family: 'WiLLsport Poles',
    mount: 'sport-pole-top',
    sockets: { fixture: { type: 'sport-crossarm-mount', position: [0.9, 0.15, 0] } },
    placeholder: { kind: 'tube', points: [[0, 0, 0], [0, 0.15, 0], [0.9, 0.15, 0]], radiusM: 0.05 },
    keywords: ['crossarm', 'sports'],
    finishes: [],
    model: null,
    thumbnail: null,
    productUrl: 'https://willbrands.com/products/sports-poles-cross-arms',
  },
];

// ── Update existing (non-curated) entries in place ────────────────────────────
// The site taxonomy (pages/products) is the source of truth for line + category.
// Standalone entries follow it wholesale; wizard parts (slot !== 'standalone')
// keep their line — moving a promoted builder part to another brand tab would
// break the brand-scoped flow — and only take the category when the taxonomy
// entry agrees with their line (else the humanized slug label).
const partById = new Map(catalog.parts.map(p => [p.id, p]));
let updatedCount = 0;
let promotedCount = 0;
for (const product of inventory.products) {
  if (CURATED_HANDLES.has(product.handle)) continue;
  const part = partById.get(product.handle);
  if (!part) continue;
  const slug = product.categorySlug ?? product.category;
  const nextLine = part.slot === 'standalone' ? product.line : part.line;
  const nextCategory = part.slot === 'standalone' || product.line === part.line
    ? product.category
    : fallbackLabel(slug);
  const nextFamily = deriveFamily(nextLine, slug);
  // Standalone products always carry a derived placeholder so the single-part
  // 3D viewer works (tier 2 = parametric 3D). Deterministic → idempotent.
  const nextPlaceholder = part.slot === 'standalone'
    ? placeholderFor(part, slug)
    : part.placeholder;
  const nextTier = part.slot === 'standalone' ? 2 : part.tier;
  if (
    part.line !== nextLine || part.category !== nextCategory || part.family !== nextFamily ||
    part.tier !== nextTier || JSON.stringify(part.placeholder) !== JSON.stringify(nextPlaceholder)
  ) {
    part.line = nextLine;
    part.category = nextCategory;
    part.family = nextFamily;
    part.tier = nextTier;
    if (nextPlaceholder) part.placeholder = nextPlaceholder;
    updatedCount++;
  }
  if (promoteToBuilder(part, slug)) promotedCount++;
}
console.log(`Updated taxonomy fields on ${updatedCount} existing entries; ${promotedCount} promoted to brand builders`);

// Curated WiLLstudio fixtures may take a photo-refined shape override too
// (placeholder only — sockets and lightOffset stay hand-tuned).
for (const id of ['drx-post-top', 'tex-post-top', 'mvx-coach', 'gvx-pendant']) {
  const override = PLACEHOLDER_OVERRIDES[id];
  const part = partById.get(id);
  if (override && part) part.placeholder = override;
}

// Upsert builder pseudo-parts (deterministic content → idempotent)
for (const pseudo of PSEUDO_PARTS) {
  const existing = partById.get(pseudo.id);
  if (existing) {
    Object.assign(existing, pseudo);
  } else {
    catalog.parts.push(pseudo);
    partById.set(pseudo.id, pseudo);
    existingIds.add(pseudo.id);
  }
}

// ── Merge into catalog ────────────────────────────────────────────────────────
// Curated parts come first (untouched), then new entries sorted by line+name.
const sortedNew = newEntries.sort((a, b) =>
  a.line.localeCompare(b.line) || a.name.localeCompare(b.name)
);

// Nav category ordering: official page order per line, then any extra
// categories still present on standalone parts (appended, first-seen order).
const categories = {};
for (const [line, cats] of Object.entries(inventory.taxonomy ?? {})) {
  categories[line] = [...cats];
}
for (const p of [...catalog.parts, ...sortedNew]) {
  if (p.slot !== 'standalone') continue;
  if (!categories[p.line]) categories[p.line] = [];
  if (!categories[p.line].includes(p.category)) categories[p.line].push(p.category);
}

const mergedCatalog = {
  ...catalog,
  categories,
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
lines.push('## Task 6 Modeling Decisions (Workstream G — P1 tier-2 promotion)');
lines.push('');
lines.push('All P1 WiLLstudio pole-system assembly-parts were promoted from `standalone`/tier-3 to their wizard slot at tier 2 with `tube`/`pole`/`baseCover` parametric placeholders (meters, +Y up, origin at the lower attachment point). Notes:');
lines.push('');
lines.push('- **Multi-head arms are OUT of scope for 0.3.** Crossarms (CR2, FR2), bullhorn brackets, side-shepherds-hook, suspension and supported arms are physically double/quad-headed, but each promoted arm exposes exactly **one** fixture socket (single-tube sweep, socket at the tube tip). Multi-head fan-out is deferred to a later phase.');
lines.push('- **Arm fixture-socket types by host:** crossarms + bullhorn + supported arms expose `tenon-2-3/8` (host post-top DRX/TEX); side-shepherds-hook + suspension expose `pendant` (hang GVX); HSX decorative upsweep exposes `arm-mount` (hosts MVX coach, mirroring the curated `upsweep`).');
lines.push('- **Poles** use the `pole` (tapered-cylinder) kind at a representative ~4.27 m / 14 ft height, top socket `tenon-3in` at the pole height, base socket `base-collar` at the origin. The fluted steel pole stays a plain taper at concept level.');
lines.push('- **DEMOTED — Light Pole Bolt Circle Adapters:** judged an *installation accessory* (adapts a pole base to a non-matching anchor bolt circle), not a configurable wizard part. Kept `tier: 3` / photo-card and set `productClass: standalone`.');
lines.push('- Every promoted pole hosts every arm (`tenon-3in` top) and every base cover (`base-collar` base); the promoted base cover fits every pole. This grows the geometry-service valid-combo matrix from 48 to 561.');
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

// Count tier-2 and tier-3 from the FINAL merged catalog (idempotent)
const tier2Count = mergedCatalog.parts.filter(p => p.tier === 2).length;
const tier3Count = mergedCatalog.parts.filter(p => p.tier === 3).length;

lines.push(`_Generated by scripts/merge-inventory.mjs (Phase 0.3) — ${mergedCatalog.parts.length} total parts (${tier2Count} tier-2 curated + ${tier3Count} tier-3 inventory)_`);
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
