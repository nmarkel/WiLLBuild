# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WiLL 3D Pole Configurator — a standalone web page where customers assemble a light pole from WiLL's WiLLstudio catalog (fixture + arm + pole + base cover + finish) and view it in a live 3D window. Full spec: `Phase 0 — Claude Code Brief.md` (stack/architecture still governs). Phase 0.1 change spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.1 — Update Gameplan.md` (outside repo).

**Status: 0.10 (part number as the primary output + real-CAD ingest) — the configured WiLL PART NUMBER is now the headline deliverable: `[Family]-[Design]-[Fit]-[Finish][-Options]` (e.g. `WP-SS3-40F-BK`), resolved per component by `src/lib/partNumber.ts` and its Python mirror `geometry-service/app/partnumber.py`, driven entirely by catalog ordering data (`docs/ordering-matrix.json` → `scripts/merge-ordering.mjs`) plus the 0.8 machine-parsed spec sheets. Products with no supplied matrix resolve to NO number ("ordering matrix pending"), never a guess; unchosen columns render as `?` and mark the number incomplete. Surfaced in a `PartNumbers` panel card, per-step chips, the summary/quote text, and the spec-sheet + concept-card PDFs. Configurator flow is Sternberg-style (choose a part → configure it → Next): steps are Fixture → Arm → Pole → Options → Finish, with per-part ordering selections in `config.partOptions`; the Options field is multi-select (no "quote" flagging) and base cover + banner are Options, not steps. Arms are family + count → design code (SH1 single-only; SS/AR 1–4; SD/HS 1–2; crossarm fixed 2) and triple/quad mount on the 90° drilled tenon (3@90, retiring the 0.8 120° renders). Fixture CAD gained step-downs + chamfered flush transitions (`geometry-service/app/kit/detail.py`). Engineering's released WiLLstudio STEP set is ingested (`scripts/step-to-glb/ingest.py` → GLB → render rig): 14 parts now render from REAL CAD, provenance in `docs/real-geometry.json`, coverage in `viewer-assets.md`/`ASSETS.md`; the zip bundle ships `factory-cad/<part number>.step`. Branch `phase-0.10` off `Dev`.** Phase 0.10 spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.10 — Sternberg Flow, Options & Geometry Detail.md` + `WiLLstudio Ordering Matrix & Part Numbers.md`; docs: `docs/part-numbers.md`, `docs/real-geometry.json`.

**Underlying 0.5 (image-based viewer switchover) — the live three.js/R3F 3D viewer is REMOVED from the app (`grep -rn "three\|@react-three" src/` is empty; three.js is a devDependency used only by the offline render rig). Every brand tab (WiLLstudio/NAFCO/WiLLsport builders + WiLLev/WiLLcloud showrooms) and both product types now render through an image-compositing viewer: assembly products stack pre-rendered transparent WebP layers positioned by projecting catalog socket offsets through a shared render rig's linear map (`src/lib/composite.ts`); standalone products show a single render. 525 interim WebP layers (105 parts × 5 finishes) live in `public/renders/` with `manifest.json`; a full-catalog coverage test (`src/lib/composite.coverage.test.ts`) proves zero fallback. Interim layers are rig-rendered from the photo-informed placeholder solids (Sales-drive `17.Renderings` not locally reachable); Cole's SolidWorks renders drop into the same manifest slots later — no app code change. Feature parity kept: finish swap, night view (with "Conceptual — not a photometric simulation" label), human-scale silhouette, image zoom (no free orbit — deliberate). Branch `phase-0.5` off `Dev`.** Phase 0.5 spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.5 — Image-Based Viewer Switchover.md`; plan + coverage doc: `docs/superpowers/plans/2026-07-21-phase05-image-viewer.md`, `viewer-assets.md`. Prior 0.4: WiLLstudio brand route, Tesla-style `BrandSwitcher`, `brand` field in config JSON + catalog, hero card (`herocard`), Revit mock (`.rfa` via mock APS). Underlying 0.3: STEP/DXF/IFC/PDF/zip pipeline, 105-part catalog, 561 combos.

## Commands

- `npm run dev` — dev server
- `npm run test` — vitest; run a single file with `npx vitest run src/lib/compat.test.ts`
- `npm run lint` — oxlint
- `npm run build` — `tsc -b` typecheck + vite build
- `./geometry-service/run.sh` — CAD/BIM service on :8000 (Python 3.13 venv at `geometry-service/.venv`); tests: `cd geometry-service && .venv/bin/pytest tests/ -q` (fast) or `-m slow tests/test_matrix.py` (full 561-combo × 4-format matrix, ~25 min)
- `node scripts/fetch-catalog-inventory.mjs` / `node scripts/merge-inventory.mjs` — regenerate the willbrands.com inventory (`docs/catalog-inventory.json`), merged catalog and `catalog-assets.md` (both idempotent). Part `category` values are the official willbrands.com/pages/products taxonomy (`SITE_TAXONOMY` in the fetch script — update it if the site page changes); the machine slug lives on as `categorySlug` in the inventory. Catalog root `categories` maps each line to its site-ordered category list (drives CatalogNav pill order); merge updates taxonomy fields on existing non-curated entries in place (wizard parts keep their `line`).
- `node scripts/merge-ordering.mjs` — merge `docs/ordering-matrix.json` into the catalog (owns `catalog.ordering`, `parts[].ordering`, `finishes[].code`, and `arrangements` for matrix-covered arm families). Idempotent.
- Real-CAD ingest (offline, needs the WiLLdrive STEP set copied into `scripts/render-rig/real-assets/step/`): `cd scripts/step-to-glb && ../../geometry-service/.venv/bin/python ingest.py [--fixtures] [--manifest]` → GLBs + `docs/real-geometry.json`; then `npm run render-rig -- --parts <ids>`, `npm run render-manifest`, `node scripts/build-viewer-assets.mjs`. Full recipe in `ASSETS.md`.
- If a native-binding error appears for rolldown/oxlint (npm optional-deps bug), install the `-darwin-arm64` binding package explicitly.

## geometry-service rules (Phase 0.3)

- **Adapter boundary is sacred:** engines (build123d/ezdxf/ifcopenshell/fpdf2/httpx) are imported only inside `geometry-service/app/adapters/` (and the kit in `app/kit/`). `app/titleblock.py`/`app/spec_template.py` are re-export shims. Boundary check: `grep -rn "import ezdxf\|import fpdf\|import ifcopenshell\|from build123d\|import httpx" geometry-service/app --include="*.py" | grep -v "app/adapters/\|app/kit/"` must be empty.
- **Determinism:** same config → byte-identical output (config hash in filenames; no wall clock anywhere in generated artifacts — pinned STEP header/IFC GUIDs/zip dates/PDF metadata). `DXF_ROUTE=direct|projection` swaps the DXF engine route (boundary proof: `geometry-service/docs/adapter-swap-note.md`).
- **Labeling:** every generated file carries the concept-starter disclaimer + config ID (enforced by tests per format).
- The kit reads dims/sockets from `public/catalog.json` — one source of truth with the viewer. fpdf2 is latin-1: non-ASCII in part names goes through `_latin1()` in `app/adapters/_spec_template.py`.
- HTTP contract (frozen, see `docs/superpowers/plans/2026-07-09-phase03-00-master.md`): `POST /generate {config, formats[], renderPng?}` → `{configHash, files[], warnings[]}` | 422 string detail; `GET /files/{name}`; `GET /health`. Standalone products (pole/arm/baseCover all `''`) get PDF only. CORS is env-driven (`ALLOWED_ORIGINS`); fly.io deploy config in `geometry-service/fly.toml` + `geometry-service/Dockerfile` (build context = repo root, port 8080). New formats: `herocard` (concept card PDF, fpdf2 via herocard_adapter.py), `rfa` (mock APS `.rfa` via rfa_adapter.py + aps_client.py; real Design Automation scaffold gated on `APS_CLIENT_ID`/`APS_CLIENT_SECRET`).

## Code map

- `src/types.ts` — `Catalog`, `CatalogPart`, `PoleConfig` (the serializable config object; includes `brand: ProductLine` field, default `"WiLLstudio"`)
- `src/lib/compat.ts` — socket-matching compatibility; `SLOT_ORDER` is fixture-first so filtering flows fixture → arm → pole; `repairConfig` (fixes downstream selections on upstream change; 0.10: leaves a deliberate empty `baseCover` alone, clamps `armCount` to the family's FIRST allowed count, folds legacy `specOptions` into `partOptions` and drops codes that aren't in a part's matrix via `repairPartOptions`), `defaultConfig`, `configStatus()`; `armAzimuths` is the 90°-drilled-tenon table (1→[0], 2→[0,180], 3→[0,90,180], 4→[0,90,180,270]) and `allowedArmCounts` never force-adds single (a crossarm is a fixed pair)
- `src/lib/url.ts` — config ↔ URL query params (share links); brand validated against allowed `ProductLine` values
- `src/lib/routes.ts` — path routing: `/studio/design` (WiLLstudio builder), `/studio/product/:id` (standalone product viewer)
- `src/components/BrandSwitcher.tsx` — Tesla-style brand switcher; non-WiLLstudio brands hidden in the WiLLstudio flow
- `src/lib/parse.ts` — deterministic keyword parser for the "Describe Your Product" box; matches part/finish `keywords` in `public/catalog.json` plus a pole-height regex. Acceptance phrase: "I want a 10k lm decorative pendant light on a 20ft pole with shepherds hook arm in a black finish" → GVX + SH1 + 20 ft + matte black. Tests: `src/lib/parse.test.ts`
- `src/lib/summary.ts` — shared config summary text (0.10: LEADS with the part numbers) + `SUMMARY_ROWS`; `armArrangementLabel` reads Triple (3 @ 90°)
- `src/lib/partNumber.ts` — **Workstream 0**: the part-number resolver. `resolvePartNumber`/`resolveAssemblyPartNumbers` build `[Family]-[Design]-[Fit]-[Finish][-Options]` from either a part's transcribed `ordering` block or its parsed spec-sheet columns; fit is DERIVED from the host pole shaft/socket OD, finish from `config.finish`; unchosen columns become `?` (`complete: false`), no-matrix parts return `unavailable`. Also `singleSelectColumns`/`mergedMultiSelectFields` (the split Options columns are merged into one field), `designsForCount`, `partNumbersText`. Full doc: `docs/part-numbers.md`
- `src/lib/banner.ts` — Workstream C: derives the banner's LABELLED dimensions (panel height, top/bottom bar height above grade) from the catalog placeholder + shaft height, plus `formatFtIn`/`formatIn`
- `src/lib/leads.ts` — contact-gate lead log; stored in localStorage (key `willbuild-leads`) as a stopgap — the "no localStorage" rule applies to config state only
- `src/store.ts` — zustand store; every selection change runs `repairConfig` and re-syncs the URL; `setPartOption`/`togglePartAddOn` (per-part ordering selections), `setBaseCover` ('' = no cover, it's an Option now); `registerSnapshot`/`snapshot` let the mounted viewer register a PNG-export fn for OutputTray
- `src/lib/composite.ts` — pure compositing engine (no three): `RenderManifest`/`RenderAsset`/`CompositeLayout` types; `projectOffset` applies the rig's `worldToImage` 2×3 map (world meters, +Y up → pixel offset, y down); `resolveAssemblyLayout` walks catalog sockets (`attachSocket`) fixture-first — same walk the old 3D Assembly did — and places layers by projecting socket offsets, reporting `missing` parts instead of throwing; `resolveRenderAsset` (exact finish → first available → undefined); `SLOT_Z` draw order pole<baseCover<arm<fixture; `HERO_ANGLE`; `MULTI_ARM_AZIMUTHS` is now [90,180,270] (0.10 retired the 120°/240° renders). Tests: `composite.test.ts`, coverage gate `composite.coverage.test.ts` (reads real catalog+manifest, asserts every part × 5 finishes + every builder combo composites with 0 missing)
- `src/lib/renders.ts` — fetches `public/renders/manifest.json` once (cached promise); `useRenderManifest()` (undefined=loading, null=unavailable → fallback), `renderUrl(file)`
- `src/lib/snapshot.ts` — `compositeToBlob(layout, {night, pxPerMeterY, showScale?})` draws a `CompositeLayout` onto a ≥1920×1080 canvas → PNG Blob (day/night bg, night glow+pool at `lightPx`, optional human silhouette); pure `fitScale` helper is unit-tested. DOM/canvas-2D only
- `src/components/CompositeViewer.tsx` — assembly image viewer (drop-in replacement for the old `<Scene>`): stacks absolutely-positioned `<img>` layers from `resolveAssemblyLayout`, scaled by a ResizeObserver `fitScale × zoom`; wheel/button zoom + drag pan (reset on assembly change); ground-shadow ellipse; night `.night` class dims layers + warm glow/pool at `lightPx`; human-scale SVG silhouette; registers `compositeToBlob` as the snapshot. Falls back to `RenderFallback` on missing renders — never a broken viewer
- `src/components/RenderFallback.tsx` — "Preview render coming" fallback listing missing part names (photo thumbnails when present)
- `src/components/PlaceholderPart.tsx` — REMOVED in 0.5 (was the R3F parametric primitives); its geometry switch lives on only in the offline rig's `specToObject` port
- `src/components/DescribeBox.tsx` — "Describe Your Product" input wired to `parse.ts`
- `src/components/Panel.tsx` — the Sternberg flow: steps Fixture → Arm → Pole → **Options** → Finish; each open step = choose the part, then `PartConfigure` it, then a "Next: <step>" hand-off; header carries the component's live part-number chip
- `src/components/PartConfigure.tsx` — per-part configure block: arm family + count chips (showing the design code they resolve), the design dropdown when a count is ambiguous, single-select ordering columns, and the multi-select **Options** field (no "quote" wording — Round 4 reversed 0.8's flagging)
- `src/components/OptionsStep.tsx` — assembly-level Options: base cover and banner arm as multi-select entries (each reveals its own controls)
- `src/components/PartNumbers.tsx` — the headline output card (copy-all, per-row segment breakdown) + `PartNumberChip` for step headers
- `src/components/SpecOptions.tsx` — REMOVED in 0.10 (its dropdowns moved into `PartConfigure`, per part)
- `src/components/OutputTray.tsx` — live downloads gallery: PNG snapshot (from the viewer's registered `snapshot` fn) + STEP/DXF(or DWG)/IFC/PDF/zip cards calling the geometry-service via `src/lib/geometry.ts`, gated behind the contact modal (`leads.ts`); cards degrade to "coming soon" when the service is down; IES stays a disabled placeholder
- `src/lib/geometry.ts` — geometry-service client (`VITE_GEOMETRY_URL`, default `http://localhost:8000`); throws user-facing `GeometryError`
- `src/components/CatalogNav.tsx` — collapsed-by-default "Browse full catalog" nav (line tabs → categories → product cards; "External product" badge on `dropShip`); careful: `.panel` is a flex column — nav children need `flex-shrink: 0`
- `src/components/ProductViewer.tsx` / `PhotoCard.tsx` — standalone product view (`view` in the store): `StandaloneRender` shows a single manifest render with zoom + finish chips (gated on available render variants); no render → `<PhotoCard renderComing>`; deliverables scoped to spec-sheet PDF
- `scripts/render-rig/` — OFFLINE asset generator (not shipped in the app bundle): a plain-three.js rig page driven by Puppeteer renders each catalog part's placeholder solid into trimmed transparent WebP layers under a shared orthographic camera (`PX_PER_M=180`, azimuth 35°/elevation 6°), one per part per finish, plus `manifest-<slug>.json` shards. `npm run render-rig -- [--line <ProductLine>] [--parts id,id]`; `npm run render-manifest` merges shards → `public/renders/manifest.json` (asserts identical rig blocks, sorts keys). `node scripts/build-viewer-assets.mjs` regenerates `viewer-assets.md`. Determinism: no wall clock; `specToObject` faithfully ports the old `PlaceholderPart` geometry switch
- `geometry-service/` — FastAPI CAD/BIM service; `app/kit/` parametric build123d solids, `app/adapters/` STEP/DXF/DWG/IFC/PDF/bundle
- `geometry-service/app/partnumber.py` — Python mirror of `src/lib/partNumber.ts` (same catalog data, same strings; both test suites pin the same expected codes). Feeds the spec sheet + concept card, which now carry a bold **Part Number** column
- `geometry-service/app/kit/detail.py` — Workstream D fixture detail: size-gated chamfers (flush transitions), a stepped-down lower band on housing-sized boxes, filleted lathe-profile corners. Fixtures only — poles/covers/arms/banner build byte-identically to 0.9. Every operation is guarded (a failed fillet degrades, never crashes a download)
- `geometry-service/app/realgeom.py` + `app/kit/real_import.py` — real-CAD resolution (part → Engineering's STEP, design code → that SKU's file) and import into the kit frame (Y-up→Z-up, origin re-based per part, BREP cache). **Kit use is opt-in via `REAL_GEOMETRY_IN_KIT=1`** — measured: a master parses in 10-20 s but fusing several real B-reps did not finish in 10 min, so downloads stay on the parametric path; the real CAD reaches customers as render layers + `factory-cad/<part number>.step` in the zip
- `scripts/step-to-glb/` — offline STEP→GLB converter (OCP) + `ingest.py`, the Phase 0.10 real-CAD ingest driver (mapping table, origin/frame modes, `--manifest` writes `docs/real-geometry.json`)
- `scripts/` + `docs/catalog-inventory.json` + `catalog-assets.md` — willbrands.com inventory pipeline and 3D-coverage table (P1 modeled tier 2; P2/P3 photo-cards)

## Stack

- Vite + React + TypeScript
- Viewer is pure DOM: stacked `<img>` layers + canvas-2D snapshot (`src/lib/composite.ts`/`snapshot.ts`). No three.js/R3F in the app bundle (0.5 switchover). `three` + Puppeteer are devDependencies used only by the offline `scripts/render-rig/` asset generator
- zustand for configurator state
- Frontend is a static site; the only backend is the colocated `geometry-service/` (FastAPI). CORS is env-driven (`ALLOWED_ORIGINS`); fly.io deploy prepped in `geometry-service/fly.toml` + `geometry-service/Dockerfile` + `docs/DEPLOY.md` (actual `fly deploy` is a manual user step). No localStorage for config — config lives in state + URL. (Exception: `src/lib/leads.ts` logs contact-gate leads to localStorage as a stopgap.)

## Core architecture rules

1. **All catalog knowledge lives in `public/catalog.json`.** Components never hardcode part lists, socket offsets, or compatibility logic.
2. **The current selection is a single serializable `config` object** — it later becomes the platform's structured config JSON, so keep it clean:

```json
{
  "configId": "uuid",
  "pole": "alum-pole-20",
  "baseCover": "bc-fluted",
  "arm": "sh1-shepherds-hook",
  "fixture": "gvx-pendant",
  "finish": "matte-black",
  "rev": 1
}
```

3. **Compatibility = socket matching only.** Each part has `mount` (what it attaches to) and `sockets` (what it carries). Selection order is fixture-first (`SLOT_ORDER` in `src/lib/compat.ts`): Fixture → Arm → Pole → Base Cover → Finish (the UI stepper shows Base Cover inside **Options** since 0.10). Socket rules: post tops (DRX/TEX) mount `tenon-2-3/8` (direct pole mount, crossarms, bullhorns, supported arms — NOT the upsweep, which is arm-mount only per H3b), GVX Pendant mounts `pendant` (pendant arms, shepherd hooks, suspension brackets), MVX Coach mounts `arm-mount` (upsweeps). Rules live in catalog socket data, never component code. Filter the UI so invalid combos are unselectable — never render a broken assembly.
4. **Catalog part shape:** `id`, `slot` (pole|baseCover|arm|fixture), `name`, `family`, `heightFt`/`dims`, `sockets`, `compatibleSockets`, `finishes[]`, `keywords[]` (describe-box matching; finishes have them too), `model` (GLB path), `thumbnail`, `productUrl` (real willbrands.com page). Catalog root also has `finishesProvisional: true` (WiLLcoat palette unconfirmed — flagged in the Finish step UI) and `referenceAssemblies[]` (drives the Standard/Configurable status chip).
5. **In-house products only.** Fixtures: DRX Post Top & Area, TEX Post Top & Area, MVX Coach, GVX Pendant. Arms: SH1 Shepherds Hook, Decorative Upsweep, PA1/PM1 Pendant Arms, plus a "Direct Pole Mount" tenon-adapter pseudo-arm. Poles: WiLLstudio Decorative Aluminum (12/14/16/20 ft, ids `alum-pole-NN`). Base covers: fluted/round.
6. **Don't block on assets.** The viewer never renders geometry at runtime. Every part shows a pre-rendered image layer (interim: rig renders of the placeholder solids; final: Cole's SolidWorks renders into the same manifest slots). Missing render → labeled "Preview render coming" fallback, never a broken viewer.

## Compositing viewer requirements (0.5 — replaces the old 3D scene)

- **Assembly products:** stack transparent WebP layers in z-order (pole < baseCover < arm < fixture) from `resolveAssemblyLayout`. Layers align because every layer is rendered against ONE shared rig (fixed ortho camera/lighting/scale) and positioned by projecting catalog socket offsets through the rig's `worldToImage` map — no hardcoded offsets, same socket walk as the old 3D assembly.
- **Standalone products:** one hero render (`resolveRenderAsset`). Asset model is keyed by angle (`angles.hero`) so front/45°/side can be added later; one hero angle ships now (no free orbit — deliberate tradeoff).
- Finish swap = swap the layer set for that finish id (instant; all 5 finishes pre-rendered per part).
- Night view (conceptual, labeled "not a photometric simulation"), ~1.83 m human-scale silhouette overlay, and image zoom carry over from the 3D viewer. Orbit is gone.
- Real units: the rig renders at 1 world meter = `rig.pxPerMeter` px; the app never re-derives camera math — it consumes `worldToImage`/`pxPerMeterY` from the manifest.
- Asset generation lives entirely in `scripts/render-rig/` (offline, devDeps). Catalog knowledge stays in `public/catalog.json` + `public/renders/manifest.json`; components never hardcode offsets.

## Asset pipeline

Document in repo as `ASSETS.md`. CAD (STEP/SolidWorks) → Blender → GLB:

1. Decimate to visual quality (target < 500 KB per part with Draco)
2. Origin at the part's lower attachment point; +Y up
3. Named empty nodes for sockets: `socket_top`, `socket_arm`, `socket_fixture`
4. Single material slot named `finish` on paintable surfaces
5. Export GLB with Draco compression

## UI

- Left panel: stepper (Fixture → Arm → Pole → Base Cover → Finish, from `SLOT_ORDER`) with thumbnails and names; each step filtered by compatibility
- Right: image-compositing viewer (layered WebP render); below/side: config summary (part names + product-page links) with the config ID and a status chip from `configStatus()` (Standard/Configurable)
- **Share** — config serialized into URL query params; loading that URL restores the build
- **Request a Quote** — link to https://willbrands.com/pages/request-a-quote with config summary prefilled (query param or copyable text block)
- Style: official WiLL brand (Brand-Identity Guidelines 2020), light UI. Palette (CSS variables in `src/index.css`): Gunmetal Gray `#42413D` (chrome/primary text), Yellow Light `#FFCF2E` (selected states + primary CTAs only, always with gunmetal text), Gunmetal Silver `#E6E7E8` (panels/dividers/muted), dark yellow `#7F6717` only alongside yellow; white base with approved silver (`#FFFFFF→#E6E7E8`) and gray (`#58595B→#42413D`) gradients. **Blue (e.g. `#1434ff`) is prohibited — not a WiLL brand color.** Fonts: Roboto 400/500/700 (main), Open Sans 300 (accent text); logo font is never faked. Logo asset: `public/will-logo.png` (reversed white-on-dark lockup — keep it on the gunmetal header bar, min 150px wide, clear space ½ logo height). Mobile: viewer above panel, still usable.

## Explicitly out of scope (Phase 1+)

LLM/AI intent parsing (the describe box is a deterministic keyword parser, not AI), pricing, photometrics (IES card stays disabled), EPA/structural validation, user accounts, CMS/Shopify integration (the inventory scripts only read Shopify's public JSON), photometric nighttime simulation (night view stays conceptual), Revit `.rfa` that loads in Revit (mock APS ships in Phase 0.4; real Design Automation requires the Autodesk developer account — deferred, adapter scaffold in `rfa_adapter.py` + `aps_client.py`), manufacturing-fidelity CAD (outputs are concept starter models).

## Milestones

M0 skeleton with placeholders → M1 one real GLB through the pipeline → M2 full kit + sockets + compatibility → M3 finishes, share URL, quote handoff, deploy. **0.5 retired the runtime-3D track (M1's CAD→GLB was never achieved): the viewer is now pre-rendered image compositing; realism now scales with render quality, not runtime geometry.**

**Definition of done:** a customer opens a URL, builds any valid combination, views it at correct scale in the compositing viewer (finish swap / night / human-scale / zoom), shares the link, and submits the configuration as a quote request.
