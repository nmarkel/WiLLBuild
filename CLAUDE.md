# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WiLL 3D Pole Configurator — a standalone web page where customers assemble a light pole from WiLL's WiLLstudio catalog (fixture + arm + pole + base cover + finish) and view it in a live 3D window. Full spec: `Phase 0 — Claude Code Brief.md` (stack/architecture still governs). Phase 0.1 change spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.1 — Update Gameplan.md` (outside repo).

**Status: 0.3 — live CAD/BIM pipeline (`geometry-service/`: STEP/DXF/IFC/PDF/zip), full willbrands.com catalog (103 parts, 5 lines), catalog nav + standalone product viewer, 561 wizard combos; placeholder primitives until M1 GLBs.** Phase 0.3 spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.3 — CAD-BIM Output Pipeline.md`; plans in `docs/superpowers/plans/`. Next milestone is M1: first real GLB through the asset pipeline (`ASSETS.md`).

## Commands

- `npm run dev` — dev server
- `npm run test` — vitest; run a single file with `npx vitest run src/lib/compat.test.ts`
- `npm run lint` — oxlint
- `npm run build` — `tsc -b` typecheck + vite build
- `./geometry-service/run.sh` — CAD/BIM service on :8000 (Python 3.13 venv at `geometry-service/.venv`); tests: `cd geometry-service && .venv/bin/pytest tests/ -q` (fast) or `-m slow tests/test_matrix.py` (full 561-combo × 4-format matrix, ~25 min)
- `node scripts/fetch-catalog-inventory.mjs` / `node scripts/merge-inventory.mjs` — regenerate the willbrands.com inventory (`docs/catalog-inventory.json`), merged catalog and `catalog-assets.md` (both idempotent)
- If a native-binding error appears for rolldown/oxlint (npm optional-deps bug), install the `-darwin-arm64` binding package explicitly.

## geometry-service rules (Phase 0.3)

- **Adapter boundary is sacred:** engines (build123d/ezdxf/ifcopenshell/fpdf2) are imported only inside `geometry-service/app/adapters/` (and the kit in `app/kit/`). `app/titleblock.py`/`app/spec_template.py` are re-export shims. Boundary check: `grep -rn "import ezdxf\|import fpdf\|import ifcopenshell\|from build123d" geometry-service/app --include="*.py" | grep -v "app/adapters/\|app/kit/"` must be empty.
- **Determinism:** same config → byte-identical output (config hash in filenames; no wall clock anywhere in generated artifacts — pinned STEP header/IFC GUIDs/zip dates/PDF metadata). `DXF_ROUTE=direct|projection` swaps the DXF engine route (boundary proof: `geometry-service/docs/adapter-swap-note.md`).
- **Labeling:** every generated file carries the concept-starter disclaimer + config ID (enforced by tests per format).
- The kit reads dims/sockets from `public/catalog.json` — one source of truth with the viewer. fpdf2 is latin-1: non-ASCII in part names goes through `_latin1()` in `app/adapters/_spec_template.py`.
- HTTP contract (frozen, see `docs/superpowers/plans/2026-07-09-phase03-00-master.md`): `POST /generate {config, formats[], renderPng?}` → `{configHash, files[], warnings[]}` | 422 string detail; `GET /files/{name}`; `GET /health`. Standalone products (pole/arm/baseCover all `''`) get PDF only.

## Code map

- `src/types.ts` — `Catalog`, `CatalogPart`, `PoleConfig` (the serializable config object)
- `src/lib/compat.ts` — socket-matching compatibility; `SLOT_ORDER` is fixture-first (Fixture → Arm → Pole → Base Cover → Finish) so filtering flows fixture → arm → pole; `repairConfig` (fixes downstream selections on upstream change), `defaultConfig`, `configStatus()` (Standard if the config matches a catalog `referenceAssembly` — list currently empty — else Configurable)
- `src/lib/url.ts` — config ↔ URL query params (share links)
- `src/lib/parse.ts` — deterministic keyword parser for the "Describe Your Product" box; matches part/finish `keywords` in `public/catalog.json` plus a pole-height regex. Acceptance phrase: "I want a 10k lm decorative pendant light on a 20ft pole with shepherds hook arm in a black finish" → GVX + SH1 + 20 ft + matte black. Tests: `src/lib/parse.test.ts`
- `src/lib/summary.ts` — shared config summary text + `SUMMARY_ROWS`
- `src/lib/leads.ts` — contact-gate lead log; stored in localStorage (key `willbuild-leads`) as a stopgap — the "no localStorage" rule applies to config state only
- `src/store.ts` — zustand store; every selection change runs `repairConfig` and re-syncs the URL
- `src/components/Assembly.tsx` — attaches parts at catalog socket positions (physical assembly still stacks pole-up); one shared PBR material for instant finish swaps
- `src/components/PlaceholderPart.tsx` — parametric primitives rendered while `model` is null
- `src/components/Scene.tsx` — R3F canvas: ground-projected street HDRI (day) with dimmed-panorama night preset, sun/moon light, shadow catcher + contact shadows, SMAA/N8AO/Bloom post stack, idle auto-orbit, camera framing follows pole height. Day/night `mode` lives in the store; night adds a lit ground disc (the projected skybox is unlit) and `FixtureLight` in Assembly.tsx — emissive lens + point/spot at the fixture's catalog `lightOffset`. Night is a conceptual preview, not photometric (guardrails).
- `src/components/DescribeBox.tsx` — "Describe Your Product" input wired to `parse.ts`
- `src/components/OutputTray.tsx` — live downloads gallery: PNG snapshot + STEP/DXF(or DWG)/IFC/PDF/zip cards calling the geometry-service via `src/lib/geometry.ts`, gated behind the contact modal (`leads.ts`); cards degrade to "coming soon" when the service is down; IES stays a disabled placeholder
- `src/lib/geometry.ts` — geometry-service client (`VITE_GEOMETRY_URL`, default `http://localhost:8000`); throws user-facing `GeometryError`
- `src/components/CatalogNav.tsx` — collapsed-by-default "Browse full catalog" nav (line tabs → categories → product cards; "External product" badge on `dropShip`); careful: `.panel` is a flex column — nav children need `flex-shrink: 0`
- `src/components/ProductViewer.tsx` / `PhotoCard.tsx` — standalone product view (`?product=<id>` URL mode, `view` in the store): tier-2 parts get a slim 3D canvas, tier-3 a photo-card, deliverables scoped to spec-sheet PDF
- `geometry-service/` — FastAPI CAD/BIM service; `app/kit/` parametric build123d solids, `app/adapters/` STEP/DXF/DWG/IFC/PDF/bundle
- `scripts/` + `docs/catalog-inventory.json` + `catalog-assets.md` — willbrands.com inventory pipeline and 3D-coverage table (P1 modeled tier 2; P2/P3 photo-cards)

## Stack

- Vite + React + TypeScript
- Three.js via React Three Fiber + drei (`OrbitControls`, `Environment`, `useGLTF`)
- zustand for configurator state
- Frontend is still a static site; the only backend is the colocated `geometry-service/` (FastAPI, localhost-only CORS for now — no deploy story yet). No localStorage for config — config lives in state + URL. (Exception: `src/lib/leads.ts` logs contact-gate leads to localStorage as a stopgap.)

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

3. **Compatibility = socket matching only.** Each part has `mount` (what it attaches to) and `sockets` (what it carries). Selection order is fixture-first (`SLOT_ORDER` in `src/lib/compat.ts`): Fixture → Arm → Pole → Base Cover → Finish. Socket rules: post tops (DRX/TEX) mount `tenon-2-3/8` (direct pole mount, crossarms, bullhorns, supported arms — NOT the upsweep, which is arm-mount only per H3b), GVX Pendant mounts `pendant` (pendant arms, shepherd hooks, suspension brackets), MVX Coach mounts `arm-mount` (upsweeps). Rules live in catalog socket data, never component code. Filter the UI so invalid combos are unselectable — never render a broken assembly.
4. **Catalog part shape:** `id`, `slot` (pole|baseCover|arm|fixture), `name`, `family`, `heightFt`/`dims`, `sockets`, `compatibleSockets`, `finishes[]`, `keywords[]` (describe-box matching; finishes have them too), `model` (GLB path), `thumbnail`, `productUrl` (real willbrands.com page). Catalog root also has `finishesProvisional: true` (WiLLcoat palette unconfirmed — flagged in the Finish step UI) and `referenceAssemblies[]` (drives the Standard/Configurable status chip).
5. **In-house products only.** Fixtures: DRX Post Top & Area, TEX Post Top & Area, MVX Coach, GVX Pendant. Arms: SH1 Shepherds Hook, Decorative Upsweep, PA1/PM1 Pendant Arms, plus a "Direct Pole Mount" tenon-adapter pseudo-arm. Poles: WiLLstudio Decorative Aluminum (12/14/16/20 ft, ids `alum-pole-NN`). Base covers: fluted/round.
6. **Don't block on assets.** Until real GLBs arrive, use parametric placeholder primitives generated in code (cylinder pole, torus base, box fixture) behind the same catalog interface.

## 3D scene requirements

- Ground plane, soft shadows, neutral HDRI environment
- Orbit + zoom with sensible min/max distance; camera framing follows assembled height
- Optional ~6 ft human silhouette scale toggle
- Parts assemble by attaching each GLB at named socket positions from catalog data — no hardcoded offsets
- Finish swap = swap one shared PBR material (color + roughness/metalness), instant
- Real units: 1 unit = 1 meter; poles are 10–16 ft — get scale right

## Asset pipeline

Document in repo as `ASSETS.md`. CAD (STEP/SolidWorks) → Blender → GLB:

1. Decimate to visual quality (target < 500 KB per part with Draco)
2. Origin at the part's lower attachment point; +Y up
3. Named empty nodes for sockets: `socket_top`, `socket_arm`, `socket_fixture`
4. Single material slot named `finish` on paintable surfaces
5. Export GLB with Draco compression

## UI

- Left panel: stepper (Fixture → Arm → Pole → Base Cover → Finish, from `SLOT_ORDER`) with thumbnails and names; each step filtered by compatibility
- Right: 3D window; below/side: config summary (part names + product-page links) with the config ID and a status chip from `configStatus()` (Standard/Configurable)
- **Share** — config serialized into URL query params; loading that URL restores the build
- **Request a Quote** — link to https://willbrands.com/pages/request-a-quote with config summary prefilled (query param or copyable text block)
- Style: official WiLL brand (Brand-Identity Guidelines 2020), light UI. Palette (CSS variables in `src/index.css`): Gunmetal Gray `#42413D` (chrome/primary text), Yellow Light `#FFCF2E` (selected states + primary CTAs only, always with gunmetal text), Gunmetal Silver `#E6E7E8` (panels/dividers/muted), dark yellow `#7F6717` only alongside yellow; white base with approved silver (`#FFFFFF→#E6E7E8`) and gray (`#58595B→#42413D`) gradients. **Blue (e.g. `#1434ff`) is prohibited — not a WiLL brand color.** Fonts: Roboto 400/500/700 (main), Open Sans 300 (accent text); logo font is never faked. Logo asset: `public/will-logo.png` (reversed white-on-dark lockup — keep it on the gunmetal header bar, min 150px wide, clear space ½ logo height). Mobile: 3D window above panel, still usable.

## Explicitly out of scope (Phase 1+)

LLM/AI intent parsing (the describe box is a deterministic keyword parser, not AI), pricing, photometrics (IES card stays disabled), EPA/structural validation, user accounts, CMS/Shopify integration (the inventory scripts only read Shopify's public JSON), photometric nighttime simulation (night view stays conceptual), native Revit RFA (IFC ships instead — APS deferred to Phase 3), manufacturing-fidelity CAD (outputs are concept starter models).

## Milestones

M0 skeleton with placeholders → M1 one real GLB through the pipeline → M2 full kit + sockets + compatibility → M3 finishes, share URL, quote handoff, deploy.

**Definition of done:** a customer opens a URL, builds any valid combination, orbits it at correct scale, shares the link, and submits the configuration as a quote request.
