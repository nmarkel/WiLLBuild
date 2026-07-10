# Phase 0.3 Plan 04 — Full catalog (Workstreams F + G) + standalone viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every product on willbrands.com is in `catalog.json` with line/category/URL/drop-ship flag; two product classes (assembly parts vs standalone); category navigation above the wizard; standalone products open in a single-product viewer (3D where a model exists, photo-card otherwise); coverage tracked in `catalog-assets.md`.

**Architecture:** willbrands.com is Shopify → inventory via `https://willbrands.com/products.json?limit=250&page=N` (+ `/collections.json`) — no HTML scraping. New catalog fields are additive; the wizard keeps filtering on `slot`, so standalone entries (new `productClass`) are invisible to it by construction. Viewer mode lives in the zustand store and the URL (`?product=<id>` vs today's config params).

**Tech Stack:** curl/jq for inventory (scratchpad), React for nav/viewer, existing Scene/PlaceholderPart for Tier-2 3D.

Global constraints: see `2026-07-09-phase03-00-master.md`. **Drop-ship items get an "External product" badge** (scope-deviation hedge — see master).

---

### Task 1: Workstream F inventory — pull the live product list

**Files:**
- Create: `scripts/fetch-catalog-inventory.mjs` (node, no deps: fetch → `scratch/inventory.json`; committed so it's rerunnable)
- Create: `docs/catalog-inventory.json` (normalized snapshot, committed)

- [ ] **Step 1:** Fetch all pages of `https://willbrands.com/products.json?limit=250&page=N` until an empty `products` array; also `https://willbrands.com/collections.json`. For each product keep: `handle`, `title`, `product_type`, `vendor`, `tags`, first image `src`, variants (title/option values), body_html stripped to text (first 300 chars), URL `https://willbrands.com/products/<handle>`.
- [ ] **Step 2:** Normalize into `docs/catalog-inventory.json`: assign `line` (NAFCO | WiLLsport | WiLLstudio | WiLLev | WiLLcloud | Other) and `category` from collections/tags/product_type/title; `dropShip: vendor !== 'WiLL'`-style heuristic — inspect actual vendor values first and write the real mapping into the script; `productClass`: `assembly-part` for fixtures/arms/poles/base covers/crossarms that mount on a pole system, else `standalone`.
- [ ] **Step 3:** Sanity: count per line printed by the script; verify a handful of URLs open (spot-check 5 with curl -I). Commit: `git commit -am "F: willbrands.com inventory snapshot + fetch script"`

### Task 2: Data model — two product classes in types + catalog

**Files:**
- Modify: `src/types.ts`, `public/catalog.json`, `src/lib/compat.ts` (only if a type guard is needed), tests

**Interfaces (produced):**

```ts
export type ProductLine = 'NAFCO' | 'WiLLsport' | 'WiLLstudio' | 'WiLLev' | 'WiLLcloud' | 'Other'
export type ProductClass = 'assembly-part' | 'standalone'
export type AssetTier = 1 | 2 | 3            // 1 CAD-converted GLB, 2 parametric, 3 photo-card

export interface CatalogPart {
  // existing fields unchanged, plus:
  line: ProductLine
  category: string                            // e.g. 'Area & Site', 'High Bay', 'EV', 'Controls'
  productClass: ProductClass
  dropShip: boolean
  tier: AssetTier
  photo?: string                              // product photo URL/path for photo-card + thumbnails
  slot: Slot                                  // UNCHANGED for assembly parts
  // standalone entries: slot stays a valid Slot value? NO — widen:
}
export type Slot = 'pole' | 'baseCover' | 'arm' | 'fixture'
// widen part.slot to `Slot | 'standalone'` via a new field-level type `PartSlot`
export type PartSlot = Slot | 'standalone'    // CatalogPart.slot: PartSlot
// `mount`, `sockets`, `placeholder` become optional for standalone (placeholder?: PlaceholderSpec)
```

- [ ] **Step 1: Failing tests:** `partsForSlot(catalog, 'fixture')` never returns standalone entries; `repairConfig`/`compatibleParts` behave identically to today on the enriched catalog (existing tests keep passing once fields are added); a standalone entry without `placeholder` type-checks.
- [ ] **Step 2:** Update `types.ts` (as above; `partsForSlot` keeps its `p.slot === slot` filter which excludes `'standalone'` naturally). Enrich the existing 15 parts in `catalog.json`: `line: 'WiLLstudio'` (fixtures/poles/base covers) — arms too; `productClass: 'assembly-part'`; `dropShip: false`; `tier: 2`.
- [ ] **Step 3:** `npm run test && npm run lint && npm run build` green. Commit: `git commit -am "F: two product classes in the data model; existing kit enriched"`

### Task 3: Merge the full inventory into catalog.json (+ coverage checklist)

**Files:**
- Create: `scripts/merge-inventory.mjs` (inventory → catalog entries; idempotent — existing 15 curated entries win by id/handle match)
- Modify: `public/catalog.json`
- Create: `catalog-assets.md` (repo root — spec names it)

- [ ] **Step 1:** Generate standalone/assembly entries for every inventory product not already curated: id from handle, name, line, category, productClass, dropShip, `tier: 3`, `photo` (remote Shopify CDN URL is fine for 0.3), `productUrl`, `keywords` from title words, `finishes: []` (finish swap only where a real palette applies — leave empty = viewer hides finish UI), `model: null`, no placeholder.
- [ ] **Step 2:** Run merge; validate `catalog.json` parses and `npm run test` still green (wizard unaffected). Spot-check counts vs Task 1's per-line counts — must match 100% (DoD 9 "every product").
- [ ] **Step 3:** Generate `catalog-assets.md`: table product × line × class × tier × status (`3D parametric` / `photo-card` / `GLB pending CAD`), plus the P1→P3 batch priorities from the spec. Make `merge-inventory.mjs` also emit this table so it never drifts.
- [ ] **Step 4:** Commit: `git commit -am "F: full willbrands.com catalog in catalog.json + catalog-assets.md coverage table"`

### Task 4: Category navigation above the wizard + view modes

**Files:**
- Create: `src/components/CatalogNav.tsx`
- Modify: `src/store.ts`, `src/App.tsx`, `src/lib/url.ts`, `src/index.css`, tests `src/lib/url.test.ts`

**Interfaces (produced):**

```ts
// store.ts
export type ViewMode = { kind: 'builder' } | { kind: 'product'; productId: string }
interface ConfiguratorState { /* existing */ view: ViewMode; openProduct(id: string): void; openBuilder(): void }
// url.ts — `?product=<id>` serializes product mode; config params (existing) imply builder mode.
```

- [ ] **Step 1: Failing tests** in `url.test.ts`: `?product=hdx-high-bay` round-trips to product view; config params still round-trip builder view; product param wins if both present.
- [ ] **Step 2:** `CatalogNav.tsx`: horizontal line tabs (NAFCO / WiLLsport / WiLLstudio / WiLLev / WiLLcloud) → category groups → product cards (photo, name, "External product" badge when `dropShip`). Pole-system assembly parts get one card: **"Pole System Builder"** → `openBuilder()`. Standalone card → `openProduct(id)`. Selected states yellow-on-gunmetal per brand.
- [ ] **Step 3:** `App.tsx`: nav renders above the panel; `view.kind === 'product'` swaps the left panel for the product panel (Task 5) and the 3D window for the standalone viewer. Builder view = exactly today's UI.
- [ ] **Step 4:** `npm run test && npm run lint && npm run build`; browser sanity pass; commit: `git commit -am "G/F: catalog navigation layer + builder/product view modes in store + URL"`

### Task 5: Standalone product viewer (3D or photo-card) + deliverables

**Files:**
- Create: `src/components/ProductViewer.tsx`, `src/components/PhotoCard.tsx`
- Modify: `src/components/OutputTray.tsx` (accept a narrower deliverable set), `src/index.css`

**Interfaces:**
- Consumes: `partById`, `Scene`'s canvas conventions (reuse `Canvas` + `Environment` + `CameraRig` — extract shared bits from `Scene.tsx` only if trivially separable; otherwise a slim parallel canvas is acceptable for 0.3), Tier data from catalog.
- Produces: tier 1/2 → 3D viewer (single part at origin, finish chips when `finishes.length > 0`, orbit, day/night reuse); tier 3 → `PhotoCard` (product photo, specs from inventory text, productUrl link) — **never a broken/empty 3D canvas** (DoD 9).

- [ ] **Step 1:** Implement `ProductViewer` (branch on `tier`): 3D path renders `PlaceholderPart` when `placeholder` exists or GLB when `model` set; photo path renders `PhotoCard`. Downloads panel: PNG render (3D tiers only) + Spec Sheet PDF; STEP/DXF cards shown as "CAD unavailable for this product" per the spec's CAD-coverage note (geometry-service kit is pole-system-scoped in 0.3).
- [ ] **Step 2:** Wire OutputTray: add prop `formats?: OutputFormat[]` defaulting to the full builder set; ProductViewer passes `['pdf']`. The PDF for standalone products needs a config-shaped payload — send `{configId: crypto.randomUUID(), pole:'', baseCover:'', arm:'', fixture: productId, finish: finishId||'', rev:1}` and have the geometry-service `validate_config` accept single-product configs when `pole === ''` (add that tolerance + a pdf-only path to plan 02's service in a small follow-up commit there: standalone → spec sheet from catalog data + photo, skip AssemblyDims).
- [ ] **Step 3:** Verify in browser: open an HDX high bay (or any standalone) from nav → photo-card renders; a tier-2 product shows 3D; deliverables behave (DoD 10).
- [ ] **Step 4:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "G: standalone product viewer with photo-card fallback + scoped deliverables"`

### Task 6: Workstream G — Tier-2 parametric models for P1 products

P1 = pole-system parts that extend the current builder (crossarms, additional arms/poles/base covers found in the inventory). DoD 9 requires **100% of P1 in 3D** (tier 1 or 2).

**Files:**
- Modify: `public/catalog.json` (placeholder specs + sockets for each P1 part), `catalog-assets.md` regen, possibly `src/types.ts` PlaceholderSpec (only if a genuinely new primitive is needed — prefer composing `group`/`lathe`/`tube`/`prism`)

- [ ] **Step 1:** From `catalog-assets.md`, list P1 products still at tier 3. For each: model a placeholder from its product photo (same technique as the 0.1 parts — lathe profiles / tube sweeps / prism groups, meters, origin at lower attachment), assign sockets per its mount type so it participates in the wizard, flip `tier` to 2, `productClass` to `assembly-part`.
- [ ] **Step 2:** Add compat tests for each new mount pairing introduced (e.g. crossarm hosting two fixtures is OUT of scope — single-fixture socket only in 0.3; note that in catalog-assets.md).
- [ ] **Step 3:** Browser pass: each P1 part selectable and renders sanely at scale; screenshot the funkiest three.
- [ ] **Step 4:** Regenerate `catalog-assets.md`; `npm run test && npm run lint && npm run build`; commit: `git commit -am "G: tier-2 parametric models for all P1 pole-system products"`
- [ ] **Step 5 (P2/P3 note):** P2 (NAFCO/WiLLsport area + sports fixtures) and P3 (WiLLev, controls) stay tier 3 photo-cards in 0.3 unless time remains — record the cut line in `catalog-assets.md`.
