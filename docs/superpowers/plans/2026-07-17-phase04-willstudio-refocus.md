# Phase 0.4 — WiLLstudio Refocus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refocus WiLLBuild on WiLLstudio as the flagship, Tesla-style per-brand config: a brand-scoped `/studio/design` route, a hero-card deliverable, and a Revit `.rfa` proof (mock APS now, real APS drop-in later) — the demo-critical slice of the Phase 0.4 spec.

**Architecture:** Frontend stays a static React SPA; we add lightweight path routing (`/studio/design`, `/studio/product/:id`) on top of the existing query-param config, and thread a `brand` field through the config JSON. The geometry-service gains two new format adapters (`herocard`, `rfa`) behind the sacred adapter boundary — `rfa` uses a pluggable APS client (mock default, real Design Automation scaffold guarded by env). Deploy prep (Dockerfile + fly.toml + env-driven CORS) is written but not executed.

**Tech Stack:** Vite + React 19 + TypeScript + zustand (frontend); FastAPI + build123d/ezdxf/ifcopenshell/fpdf2 + httpx (geometry-service, Python 3.13).

## Global Constraints

- **Adapter boundary is sacred.** Geometry/format engines (`build123d`, `ezdxf`, `ifcopenshell`, `fpdf2`) and the APS HTTP client are imported ONLY inside `geometry-service/app/adapters/` (and `app/kit/`). Boundary check must stay empty:
  `grep -rn "import ezdxf\|import fpdf\|import ifcopenshell\|from build123d\|import httpx" geometry-service/app --include="*.py" | grep -v "app/adapters/\|app/kit/"`
- **Determinism:** same config → byte-identical output for all deterministic adapters. Config hash in filenames; no wall clock in generated artifacts. The `rfa` MOCK path must be deterministic; the real APS path is cloud-nondeterministic and is exempt (documented).
- **Labeling:** every generated file carries the concept-starter disclaimer (`app.naming.DISCLAIMER` = `"Concept starter model - not final engineered or manufacturing-released design"`) + config ID. Enforced by a test per new format.
- **No blue** anywhere in UI or PDFs (brand rule). Brand palette: Gunmetal `#42413D`, Yellow `#FFCF2E`, Silver `#E6E7E8`.
- **HTTP contract** additive-only: new formats append to the `formats` Literal; the `{config, formats[], renderPng?}` → `{configHash, files[], warnings[]}` shape is unchanged.
- **All catalog knowledge lives in `public/catalog.json`.** No hardcoded part lists, brand lists derive from catalog `line` where possible.
- **.ies stays deferred** — no IES in the UI except the existing disabled "coming soon" card.
- **No real deploy / no live APS calls this pass.** fly.io config is prep only; APS runs in mock mode (no Autodesk account yet).

---

## File Structure

**Frontend (Workstream 5 — per-brand):**
- `src/types.ts` — add `brand: ProductLine` to `PoleConfig`.
- `src/lib/routes.ts` *(new)* — parse `window.location.pathname` → `{ brand, view }`; build brand paths. Single source of path truth.
- `src/lib/url.ts` — keep config↔query-param; add `brand` to serialized params fallback.
- `src/store.ts` — hold `brand`; `syncUrl`/`syncProductUrl` write brand-aware paths; `loadCatalog` reads route.
- `src/App.tsx` — render a brand switcher; scope builder to active brand.
- `src/components/BrandSwitcher.tsx` *(new)* — Tesla-style brand chooser (only WiLLstudio active; others "coming soon").
- `src/components/CatalogNav.tsx` — scope products to the active brand.
- `public/_redirects` *(new)* — `/* /index.html 200` for SPA deep links on Cloudflare Pages.
- `src/lib/compat.ts` — `defaultConfig` sets `brand: 'WiLLstudio'`.

**Backend (Workstreams 3 + 4):**
- `geometry-service/app/models.py` — add `brand` to `PoleConfig`; extend `formats` Literal with `"herocard"`, `"rfa"`.
- `geometry-service/app/adapters/_spec_template.py` — hero layout + status chip in `concept-card`/`herocard` mode.
- `geometry-service/app/adapters/herocard_adapter.py` *(new)* — `format="herocard"`, calls `render_spec(ctx, mode="concept-card")`.
- `geometry-service/app/adapters/rfa_adapter.py` *(new)* — `format="rfa"`; pluggable APS client.
- `geometry-service/app/adapters/aps_client.py` *(new)* — `ApsClient` protocol, `MockApsClient`, `RealApsClient` (httpx, env-guarded).
- `geometry-service/app/adapters/__init__.py` — register both new adapters.
- `geometry-service/app/catalog.py` — add `config_status(catalog, cfg)` helper (mirrors frontend `configStatus`).
- `geometry-service/app/main.py` — env-driven CORS; `herocard` in `_GEOMETRIC_FORMATS`.
- `geometry-service/tests/test_herocard.py`, `tests/test_rfa.py` *(new)*.

**Frontend deliverable wiring (3 + 4):**
- `src/lib/geometry.ts` — `OutputFormat` gains `'herocard' | 'rfa'`.
- `src/components/OutputTray.tsx` — add "Concept Card" (herocard) and "Revit Family" (rfa) deliverables; reorder per W3 priority.

**Deploy prep (Workstream 6):**
- `geometry-service/Dockerfile` *(new)*, `geometry-service/fly.toml` *(new)*, `geometry-service/.dockerignore` *(new)*.
- `docs/DEPLOY.md` *(new)* — fly.io runbook + `VITE_GEOMETRY_URL` wiring for the deployed frontend.

**Docs:**
- `CLAUDE.md`, `../Design Assistant/12 Open Decisions.md` (APS-deferred decision), memory files.

---

### Task 1: Brand-line field threaded through config JSON

Foundational, small: add `brand` to the config on both sides so routing (Task 2) and downstream files carry it. No behaviour change yet.

**Files:**
- Modify: `src/types.ts` (PoleConfig)
- Modify: `src/lib/compat.ts` (`defaultConfig`)
- Modify: `src/lib/url.ts` (serialize/read `brand`)
- Modify: `src/lib/url.test.ts` (assert brand round-trips)
- Modify: `geometry-service/app/models.py` (PoleConfig `brand`)

**Interfaces:**
- Produces: `PoleConfig.brand: ProductLine` (frontend) and `PoleConfig.brand: str` (backend, default `"WiLLstudio"`, extra fields already ignored by pydantic so old clients still validate).

- [ ] **Step 1:** In `src/types.ts`, add `brand: ProductLine` to `PoleConfig` (after `configId`). Reuse the existing `ProductLine` type.
- [ ] **Step 2:** In `src/lib/compat.ts` `defaultConfig`, set `brand: 'WiLLstudio'`.
- [ ] **Step 3:** In `src/lib/url.ts`, add `'brand'` to a brand-aware param path: `configToParams` writes `brand` only when it is not the default `'WiLLstudio'` (keep share URLs clean); `paramsToPartialConfig` reads it. Keep `PART_KEYS` as-is; handle `brand` separately so it isn't treated as a part slot.
- [ ] **Step 4:** Write a failing test in `src/lib/url.test.ts`: a config with `brand: 'WiLLstudio'` round-trips (default omitted from params but restored by `defaultConfig` merge); a non-default brand round-trips explicitly. Run `npm run test` → expect fail, then pass after Step 3.
- [ ] **Step 5:** In `geometry-service/app/models.py`, add `brand: str = "WiLLstudio"` to `PoleConfig`.
- [ ] **Step 6:** Run `npm run test` and `cd geometry-service && .venv/bin/pytest tests/ -q`. Both green.
- [ ] **Step 7:** Commit: `git commit -am "W5: thread brand-line field through config JSON (frontend + service model)"`

---

### Task 2: Per-brand `/studio/design` routing + brand-scoped flow

Add path routing so the WiLLstudio config lives at `/studio/design`; a Tesla-style brand switcher structures future brands without a generic wizard. Non-WiLLstudio products are not visible inside the WiLLstudio flow.

**Files:**
- Create: `src/lib/routes.ts`, `src/lib/routes.test.ts`
- Create: `src/components/BrandSwitcher.tsx`
- Create: `public/_redirects`
- Modify: `src/store.ts`, `src/App.tsx`, `src/components/CatalogNav.tsx`

**Interfaces:**
- Produces: `routes.ts` exports `parseRoute(pathname: string): { brand: ProductLine; view: ViewMode }`, `builderPath(brand: ProductLine): string` (`/studio/design`), `productPath(brand: ProductLine, id: string): string` (`/studio/product/<id>`), and `BRAND_SLUGS: Record<ProductLine, string | null>` (`WiLLstudio→'studio'`, others `null` until they have a flow).
- Consumes (store): `parseRoute` on load; `builderPath`/`productPath` in `syncUrl`/`syncProductUrl`.

- [ ] **Step 1:** Write `src/lib/routes.test.ts` failing tests: `parseRoute('/studio/design')` → `{brand:'WiLLstudio', view:{kind:'builder'}}`; `parseRoute('/studio/product/hdx-high-bay')` → `{kind:'product', productId:'hdx-high-bay'}`; `parseRoute('/')` → builder default WiLLstudio; `builderPath('WiLLstudio') === '/studio/design'`; unknown brand slug falls back to WiLLstudio builder.
- [ ] **Step 2:** Run `npm run test src/lib/routes.test.ts` → fail (module missing).
- [ ] **Step 3:** Implement `src/lib/routes.ts`. Keep it dependency-free (no react-router). Parse `pathname` by splitting on `/`; map slug→brand via `BRAND_SLUGS`; `design`→builder, `product/<id>`→product. Preserve query string handling in the store (routes own the path, url.ts owns the query).
- [ ] **Step 4:** Run `npm run test src/lib/routes.test.ts` → pass.
- [ ] **Step 5:** Update `src/store.ts`: add `brand: ProductLine` to state (default `'WiLLstudio'`). In `loadCatalog`, call `parseRoute(window.location.pathname)` for the initial view/brand (falling back to query-param product for back-compat). `syncUrl` writes `builderPath(brand) + '?' + configToParams(config)` via `replaceState`; `syncProductUrl` writes `productPath(brand, id)`. `openBuilder`/`openProduct` use the brand.
- [ ] **Step 6:** Create `src/components/BrandSwitcher.tsx`: renders the brand list (from `ProductLine` order `['WiLLstudio','NAFCO','WiLLsport','WiLLev','WiLLcloud']`); WiLLstudio is active/clickable (navigates to `builderPath`), others render disabled with a "Coming soon" tag (Nick: "structure it more like car models"). Gunmetal/yellow styling, no blue.
- [ ] **Step 7:** Update `src/App.tsx`: render `<BrandSwitcher/>` in the panel header area; the builder/product views are unchanged but brand-aware. Update `src/components/CatalogNav.tsx` so the browse nav scopes to the active brand only (hide other line tabs when inside a brand flow) — non-WiLLstudio products are not shown in the WiLLstudio flow (DoD 5).
- [ ] **Step 8:** Create `public/_redirects` containing `/*    /index.html    200`.
- [ ] **Step 9:** Run `npm run test` (all green), `npm run build` (typecheck + build clean), `npm run lint`. Manually confirm `npm run dev` serves `/studio/design` and a share link `/studio/design?fixture=gvx-pendant&...` restores the build (note in report).
- [ ] **Step 10:** Commit: `git commit -am "W5: /studio/design brand route + Tesla-style brand switcher; brand-scoped catalog nav"`

---

### Task 3: Hero card deliverable (backend adapter + hero layout + status; frontend card)

The hero card = a render-forward one-pager: hero render, component list, dims, finish (RAL), config ID, **status** (Standard/Configurable), CTA, disclaimer. Built on the existing `render_spec` concept-card mode.

**Files:**
- Modify: `geometry-service/app/catalog.py` (`config_status`)
- Modify: `geometry-service/app/adapters/_spec_template.py` (hero layout + status in concept-card mode)
- Create: `geometry-service/app/adapters/herocard_adapter.py`
- Modify: `geometry-service/app/adapters/__init__.py`, `geometry-service/app/models.py`, `geometry-service/app/main.py`
- Create: `geometry-service/tests/test_herocard.py`
- Modify: `src/lib/geometry.ts`, `src/components/OutputTray.tsx`

**Interfaces:**
- Consumes: `render_spec(ctx, mode)` (existing), `ctx.summary` (parts/dims/finish), `config_hash`, `DISCLAIMER`.
- Produces: `HeroCardAdapter` with `format="herocard"`, `available()→True`, `generate(ctx)→[<base_name>.pdf]` written distinctly from the spec PDF (suffix `-hero` so both can coexist in a bundle). `config_status(catalog, cfg) -> "Standard" | "Configurable"`.

- [ ] **Step 1:** Add `config_status(catalog, cfg)` to `geometry-service/app/catalog.py`: return `"Standard"` if a `referenceAssemblies` entry matches all of pole/baseCover/arm/fixture, else `"Configurable"` (referenceAssemblies currently empty → always Configurable). Write the assertion into `tests/test_herocard.py`.
- [ ] **Step 2:** In `_spec_template.py`, extend `render_spec` so `mode="concept-card"` produces the hero layout: render occupies the top ~55% full-width band; below it the component list, a dims row, finish (with RAL), and a **status chip** (rounded gunmetal pill, yellow text for "Standard", silver for "Configurable"); footer keeps disclaimer + config ID + quote CTA. `mode="spec"` layout is unchanged. Add `ctx.summary["status"]` read (default computed via a passed-in value — the adapter sets it).
- [ ] **Step 3:** Create `herocard_adapter.py`: `HeroCardAdapter.generate` sets `ctx.summary["status"] = config_status(ctx.catalog, ctx.cfg)`, calls `render_spec(ctx, mode="concept-card")`, writes `ctx.out_dir / f"{ctx.base_name}-hero.pdf"`. Keep determinism (fixed epoch already pinned in template).
- [ ] **Step 4:** Register in `adapters/__init__.py` (add `HeroCardAdapter()` to the tuple that populates `REGISTRY`). Add `"herocard"` to the `formats` Literal in `models.py` and to `_GEOMETRIC_FORMATS` in `main.py` (needs assembly dims).
- [ ] **Step 5:** Write `tests/test_herocard.py`: (a) herocard file is produced and ends `-hero.pdf`; (b) PDF bytes contain the `DISCLAIMER` and `configId` (decode latin-1 / search raw bytes as the spec-sheet test does); (c) determinism — two runs byte-identical; (d) `config_status` returns `"Configurable"` for a normal build. Run `.venv/bin/pytest tests/test_herocard.py -q` → red then green.
- [ ] **Step 6:** Boundary check grep (Global Constraints) → empty. Run full fast suite `.venv/bin/pytest tests/ -q` → green.
- [ ] **Step 7:** Frontend: add `'herocard'` to `OutputFormat` in `src/lib/geometry.ts`. In `OutputTray.tsx` add a `DELIVERABLE_DEFS` entry: `{format:'herocard', title:'Concept Card', formatLabel:'PDF · hero card', audience:'For your client', includeRender:true}`, placed near the top (W3 priority #3, above STEP). Reorder defs so priority reads: Concept Card / Spec Sheet, 2D Drawing (DWG/DXF), Revit Family (Task 4), STEP (labeled "For WiLL Engineering"), IFC, bundle, IES(disabled).
- [ ] **Step 8:** Run `npm run test`, `npm run build`, `npm run lint`. Green.
- [ ] **Step 9:** Commit: `git commit -am "W3: hero (concept) card deliverable with status chip + config_status"`

---

### Task 4: Revit `.rfa` proof — APS adapter with mock + real scaffold; frontend card

Prove the config→Revit pipeline. No Autodesk account yet, so the adapter runs a **mock** APS client that emits a deterministic rudimentary `.rfa` artifact carrying config ID + disclaimer, structured so the **real** Design Automation client drops in behind the same interface once creds exist. IFC remains the immediately Revit-importable BIM file.

**Files:**
- Create: `geometry-service/app/adapters/aps_client.py`
- Create: `geometry-service/app/adapters/rfa_adapter.py`
- Modify: `geometry-service/app/adapters/__init__.py`, `geometry-service/app/models.py`
- Create: `geometry-service/tests/test_rfa.py`
- Modify: `src/lib/geometry.ts`, `src/components/OutputTray.tsx`

**Interfaces:**
- Produces: `ApsClient` Protocol `submit(config_hash: str, params: dict) -> bytes`; `MockApsClient` (deterministic bytes); `RealApsClient` (httpx OAuth + workitem, env-guarded, NOT run in tests). `RfaAdapter` `format="rfa"`, `available()→True`, `generate(ctx)→[<base_name>.rfa]`; selects `RealApsClient` iff `APS_CLIENT_ID` and `APS_CLIENT_SECRET` are set, else `MockApsClient`. Emits warning via `ctx` summary/return when mock is used (surfaced in `/generate` warnings by main.py's existing per-format try/except is not enough — instead the adapter appends to a module-level convention: return the file, and main.py already turns adapter exceptions into warnings; for the mock notice, embed it in the file + document, and add a warning by raising nothing — see Step 4).

- [ ] **Step 1:** Create `aps_client.py`. Define `ApsClient` Protocol. `MockApsClient.submit(config_hash, params)`: build a deterministic `.rfa`-named payload — since a true RFA can only be authored by Revit/APS, the mock writes a documented placeholder container: a small binary-safe header line `WiLL-RFA-MOCK v1` + a JSON manifest (`{configHash, params, disclaimer, note:"Mock APS output — real Design Automation .rfa pending Autodesk account"}`). Deterministic (sorted keys, no timestamps). `RealApsClient.__init__` reads `APS_CLIENT_ID/SECRET/APS_ACTIVITY_ID` from env; `submit` outlines the OAuth→workitem→poll→download flow with `httpx` (import httpx INSIDE this adapter module — boundary rule); guarded so it never runs without creds. Keep it compiling but untested.
- [ ] **Step 2:** Create `rfa_adapter.py`: `RfaAdapter.generate(ctx)` picks the client by env, builds `params` from `ctx.assembly.dims` (overall height, category `"Lighting Fixtures"`, family name from config), calls `submit(config_hash, params)`, writes `ctx.out_dir/f"{ctx.base_name}.rfa"`. When the mock client is used, append a human warning to `ctx.summary.setdefault("warnings", [])` AND ensure main.py surfaces it — simplest: have the adapter write the warning into a `ctx.produced`-adjacent channel. **Concretely:** add an optional `ctx.warnings: list[str]` field to `GenContext` (default empty), have main.py extend the response `warnings` with `ctx.warnings` after dispatch, and the mock path appends `"rfa: mock APS output — real .rfa pending Autodesk developer account"`.
- [ ] **Step 3:** Modify `app/adapters/base.py` `GenContext` to add `warnings: list[str] = field(default_factory=list)`; modify `main.py` to `warnings.extend(ctx.warnings)` before building the response.
- [ ] **Step 4:** Register `RfaAdapter()` in `__init__.py`; add `"rfa"` to the `formats` Literal in `models.py`.
- [ ] **Step 5:** Write `tests/test_rfa.py`: (a) rfa file produced, ends `.rfa`; (b) contains `configId`/config hash and `DISCLAIMER`/mock note; (c) determinism byte-identical (mock); (d) with no env creds the mock client is selected and a warning is emitted; (e) `RealApsClient` is selected when both env vars set (monkeypatch env; do NOT call `.submit`). Run `.venv/bin/pytest tests/test_rfa.py -q` red→green.
- [ ] **Step 6:** Boundary grep must stay empty EXCEPT `import httpx` which is inside `app/adapters/aps_client.py` — update the Global-Constraints grep pattern documentation accordingly (httpx allowed only in adapters, same as engines). Run full fast suite green.
- [ ] **Step 7:** Frontend: add `'rfa'` to `OutputFormat`. In `OutputTray.tsx` add `{format:'rfa', title:'Revit Family', formatLabel:'RFA · Revit family', audience:'For your Revit model', includeRender:false}` as W3 priority #1 (top of the CAD group). Keep the IFC card (relabel audience "For open BIM / import"). When the service returns the mock warning, the existing `tray-warnings` line shows it.
- [ ] **Step 8:** Run `npm run test`, `npm run build`, `npm run lint`; `.venv/bin/pytest tests/ -q`. All green. Boundary grep empty (except aps_client httpx).
- [ ] **Step 9:** Commit: `git commit -am "W4: Revit .rfa adapter with mock APS + real Design Automation scaffold"`

---

### Task 5: fly.io deploy prep (no deploy) + env-driven CORS

Everything the user needs to run `fly deploy` themselves; the service currently only allows localhost CORS and has no container.

**Files:**
- Create: `geometry-service/Dockerfile`, `geometry-service/.dockerignore`, `geometry-service/fly.toml`
- Modify: `geometry-service/app/main.py` (env-driven CORS)
- Create: `docs/DEPLOY.md`

- [ ] **Step 1:** In `main.py`, read `ALLOWED_ORIGINS` (comma-separated) from env and merge with the localhost defaults; pass the union to `CORSMiddleware`. Keep localhost defaults so dev is unaffected. Add a tiny test in an existing test file (or `tests/test_cors.py`) asserting the parsed origin list includes an env-provided origin.
- [ ] **Step 2:** Create `geometry-service/Dockerfile`: base `python:3.13-slim`; install system libs needed by OCP/build123d (`libgl1`, `libglu1-mesa`, `libx11-6`, `libxext6`, `libxrender1`) via apt; `pip install -r requirements.txt`; copy `app/` and `public/catalog.json` path dependency (the service reads `public/catalog.json` — confirm `catalog.py` load path and COPY it); `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]`. Note the image will be large (OCP) — acceptable.
- [ ] **Step 2b:** Confirm how `catalog.py` locates `public/catalog.json` (relative path) and ensure the Dockerfile COPY places it where the code expects; document in DEPLOY.md if the path must be overridden by env in the container.
- [ ] **Step 3:** Create `.dockerignore` (`.venv`, `__pycache__`, `out/`, `tests/`, `*.pyc`).
- [ ] **Step 4:** Create `fly.toml`: app name placeholder `willbuild-geometry`, `internal_port = 8080`, a single shared-cpu-1x VM, `auto_stop_machines`/`auto_start_machines = true` (cost control, ~$5-10/mo per Nick), `[env] ALLOWED_ORIGINS = "https://willbuild.nmarkel.workers.dev"`. Add `DXF_ROUTE` note.
- [ ] **Step 5:** Create `docs/DEPLOY.md`: exact steps — `fly launch --no-deploy` / `fly deploy` from `geometry-service/`, set `ALLOWED_ORIGINS`, then set the frontend build's `VITE_GEOMETRY_URL` to the fly URL and redeploy the Cloudflare Pages/Workers site so the download tray un-degrades. Include the ODA-converter note (DWG stays warned until ODA is added to the image — out of scope this pass) and the APS-env note (set `APS_CLIENT_ID/SECRET/APS_ACTIVITY_ID` once the account exists to flip `rfa` from mock to real).
- [ ] **Step 6:** `docker build` is NOT run here (may be slow/unavailable); instead `.venv/bin/pytest tests/ -q` green and a `python -c "import app.main"` import check pass. Commit: `git commit -am "W6: fly.io deploy prep (Dockerfile, fly.toml, env CORS, runbook) — deploy is manual"`

---

### Task 6: Integration — matrix slice, full build, docs, memory

- [ ] **Step 1:** Run the frontend gate: `npm run test` (all green), `npm run build` (typecheck clean), `npm run lint` (clean).
- [ ] **Step 2:** Run geometry-service fast suite `.venv/bin/pytest tests/ -q` green. Then a determinism/labeling slice for the two new formats across a handful of representative configs (reuse the matrix harness pattern if cheap; otherwise 3-5 configs × {herocard, rfa} asserting file + disclaimer + determinism). Full 561-combo matrix is NOT required for the new PDF/rfa formats (documented — they don't touch STEP/DXF/IFC geometry paths).
- [ ] **Step 3:** Boundary grep empty (engines + httpx only in `app/adapters/`). Record in report.
- [ ] **Step 4:** Manual e2e smoke in `npm run dev` + running service: open `/studio/design`, build a config, download Concept Card (herocard PDF opens, shows status chip + disclaimer) and Revit Family (rfa downloads, tray shows the mock-APS warning). Note results in the report.
- [ ] **Step 5:** Update `CLAUDE.md` status line to Phase 0.4 (brand route, herocard, rfa mock, fly prep). Update `../Design Assistant/12 Open Decisions.md`: record "Revit = APS mock this pass; real .rfa pending Autodesk dev account (DoD 2 deferred)" and "Hosting = fly.io, config prepped, deploy manual". Update the Phase 0.4 doc status if appropriate.
- [ ] **Step 6:** Write/refresh memory files for any non-obvious facts discovered (e.g. adapter-boundary now includes httpx; rfa mock convention).
- [ ] **Step 7:** Commit: `git commit -am "Phase 0.4 demo-critical: integration, docs, decisions"`.

---

## Self-Review

**Spec coverage (demo-critical slice of Phase 0.4):**
- W5 per-brand structure (DoD 5): Tasks 1+2 — brand field in catalog (already present as `line`) + config JSON, `/studio/design` route, non-WiLLstudio hidden in the WiLLstudio flow. ✅
- W3 hero card (DoD 4): Task 3 — PDF with hero render, components, dims, finish (RAL), config ID, status, CTA, disclaimer. ✅ (PNG-of-card deferred; the existing PNG snapshot covers the render image — noted.)
- W4 Revit proof (DoD 2): Task 4 — `.rfa` via mock APS + real scaffold; "loads in Revit" acceptance explicitly deferred to when the Autodesk account exists (recorded in Open Decisions). ✅ (scope: "mock it")
- W6 hosting (DoD 6): Task 5 — fly.io config prepped; actual deploy is the user's step. ✅ (scope: "prep, you deploy")
- .ies deferred (DoD 7): unchanged disabled card. ✅
- Full spec-sheet data (W2) and live deploy/live APS: **out of scope this session** (per user: "demo-critical only"). Recorded, not built.

**Placeholder scan:** No "TBD"/"add error handling" left; each step names files, code shape, and commands.

**Type consistency:** `brand: ProductLine` (frontend) / `brand: str` (backend); `OutputFormat` gains `'herocard'|'rfa'` used consistently in geometry.ts + OutputTray; `config_status` returns the same `'Standard'|'Configurable'` union as the frontend `configStatus`; `GenContext.warnings` added in base.py and consumed in main.py.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-17-phase04-willstudio-refocus.md`. Executing via **subagent-driven-development** (fresh subagent per task + two-stage review), matching this repo's Phase 0.2/0.3 workflow.
