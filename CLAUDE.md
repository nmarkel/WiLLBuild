# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WiLL 3D Pole Configurator — a standalone web page where customers assemble a light pole from WiLL's WiLLstudio catalog (fixture + arm + pole + base cover + finish) and view it in a live 3D window. Full spec: `Phase 0 — Claude Code Brief.md` (stack/architecture still governs). Phase 0.1 change spec: `/Users/nickmarkel/Documents/Design Assistant/Phase 0.1 — Update Gameplan.md` (outside repo).

**Status: 0.1 — real catalog, fixture-first flow, output tray, describe-box parser; placeholder primitives until M1 GLBs.** Next milestone is M1: first real GLB through the asset pipeline (`ASSETS.md`).

## Commands

- `npm run dev` — dev server
- `npm run test` — vitest; run a single file with `npx vitest run src/lib/compat.test.ts`
- `npm run lint` — oxlint
- `npm run build` — `tsc -b` typecheck + vite build
- If a native-binding error appears for rolldown/oxlint (npm optional-deps bug), install the `-darwin-arm64` binding package explicitly.

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
- `src/components/Scene.tsx` — R3F canvas, camera framing follows pole height
- `src/components/DescribeBox.tsx` — "Describe Your Product" input wired to `parse.ts`
- `src/components/OutputTray.tsx` — downloads gallery: PNG canvas snapshot gated behind a name+email modal (logged via `leads.ts`); disabled placeholders for spec sheet PDF/DWG/STEP/IES with audience labels

## Stack

- Vite + React + TypeScript
- Three.js via React Three Fiber + drei (`OrbitControls`, `Environment`, `useGLTF`)
- zustand for configurator state
- No backend. Static site (Vercel/Netlify). No localStorage for config — config lives in state + URL. (Exception: `src/lib/leads.ts` logs contact-gate leads to localStorage as a stopgap.)

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

3. **Compatibility = socket matching only.** Each catalog part has `sockets` and `compatibleSockets`. Selection order is fixture-first (`SLOT_ORDER` in `src/lib/compat.ts`): Fixture → Arm → Pole → Base Cover → Finish. Current socket rules: post tops (DRX/TEX) mount `tenon-2-3/8` (Decorative Upsweep or Direct Pole Mount), GVX Pendant mounts `pendant` (pendant arms only), MVX Coach mounts `arm-mount` (upsweep). Filter the UI so invalid combos are unselectable — never render a broken assembly.
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

LLM/AI intent parsing (the describe box is a deterministic keyword parser, not AI), CAD/BIM file download (output tray shows disabled placeholders only), pricing, photometrics, EPA/structural validation, user accounts, CMS/Shopify integration, nighttime lighting simulation.

## Milestones

M0 skeleton with placeholders → M1 one real GLB through the pipeline → M2 full kit + sockets + compatibility → M3 finishes, share URL, quote handoff, deploy.

**Definition of done:** a customer opens a URL, builds any valid combination, orbits it at correct scale, shares the link, and submits the configuration as a quote request.
