# WiLL 3D Pole Configurator

A web page where customers assemble a light pole from WiLL's WiLLstudio catalog — fixture + arm + pole + base cover + finish — and see it composited live. The configuration lives in state and the URL (no localStorage for config).

Two pieces: a **static frontend**, and a colocated **`geometry-service/`** (FastAPI) that generates the CAD/BIM deliverables — STEP, DXF, IFC, PDF, the handoff bundle — and captures download leads. The README described this as having "no backend" long after the service existed; it is deployed on AWS App Runner (`docs/DEPLOY.md`).

Baseline spec (stack and architecture still govern): `Phase 0 — Claude Code Brief.md`. Asset pipeline: `ASSETS.md`.

## Stack

Vite · React · TypeScript · zustand — plus FastAPI + build123d/OCCT in `geometry-service/`.

**No three.js in the app bundle.** Phase 0.5 retired the runtime R3F viewer: the builder composites pre-rendered transparent WebP layers positioned by projecting catalog socket offsets (`src/lib/composite.ts`), so `grep -rn "three" src/` is empty. `three` and Puppeteer are devDependencies used only by the offline render rig in `scripts/render-rig/`.

## Commands

```sh
npm install       # setup
npm run dev       # dev server
npm run test      # vitest (compatibility + URL serialization)
npm run lint      # oxlint
npm run build     # typecheck + production build
npm run preview   # serve the production build
```

## How it works

- All catalog knowledge lives in `public/catalog.json` — parts, sockets, finishes, placeholder geometry. Components never hardcode part lists.
- The current selection is a single serializable config object (`src/types.ts` → `PoleConfig`), synced to URL query params so any build is shareable.
- Compatibility is socket matching only (`src/lib/compat.ts`) and is fixture-first: the stepper runs Fixture → Arm → Pole → Base Cover → Finish, and filtering flows fixture → arm → pole. A part fits when its `mount` type matches a socket its host exposes. The UI only offers compatible parts, and `repairConfig` fixes downstream selections when an upstream part changes — a broken assembly is never rendered.
- The "Describe Your Product" box (`src/components/DescribeBox.tsx`) uses a deterministic keyword parser (`src/lib/parse.ts`) — catalog keywords plus a pole-height regex, no LLM.
- The output tray (`src/components/OutputTray.tsx`) offers a PNG snapshot of the 3D canvas, gated behind name + email; spec sheet PDF, DWG, STEP, and IES are shown as coming soon.
- Until real GLBs arrive, parts render as parametric placeholder primitives (`placeholder` spec in the catalog) behind the same interface.

## Rendering

The viewport places the assembly on a real street (ground-projected HDRI, day preset) with tuned per-finish powder-coat materials and a post-processing stack (SMAA, ambient occlusion, subtle bloom). A **night view** toggle dims the scene to dusk and lights the luminaire itself — a conceptual preview of the product in use, not a photometric simulation. The Product Render download exports ≥1920×1080 through the full pipeline.

## Status

**0.2 — real catalog, fixture-first flow, output tray, describe-box parser, HDRI streetscape rendering with day/night presets, official WiLL brand treatment.** Parts still render as parametric silhouettes (shaped from product photos) until M1 brings the first real GLB through the asset pipeline.
