# WiLL 3D Pole Configurator

A standalone web page where customers assemble a light pole from WiLL's WiLLstudio catalog — fixture + arm + pole + base cover + finish — and view it in a live 3D window. Static site, no backend; the configuration lives in state and the URL.

Baseline spec (stack and architecture still govern): `Phase 0 — Claude Code Brief.md`. Asset pipeline: `ASSETS.md`.

## Stack

Vite · React · TypeScript · Three.js (React Three Fiber + drei) · zustand

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

## Status

**0.1 — real catalog (in-house WiLL products), fixture-first flow, output tray, describe-box parser.** Parts still render as placeholder primitives until M1 brings the first real GLB through the asset pipeline.
