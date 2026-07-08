---
tags: [phase0, spec, claude-code]
created: 2026-07-08
---

# Phase 0 — Claude Code Brief

> Drop this into the project repo as `CLAUDE.md` (or paste as the kickoff prompt). Full context: [[Phase 0 — 3D Configurator Gameplan]].

## Project

WiLL 3D Pole Configurator — a standalone web page where customers assemble a light pole from WiLL's existing WiLLstudio catalog (pole + base cover + arm + fixture + finish) and view it in a live 3D window.

## Stack

- Vite + React + TypeScript
- Three.js via React Three Fiber + drei (`OrbitControls`, `Environment`, `useGLTF`)
- zustand for configurator state
- No backend. Static site, deployable to Vercel/Netlify. No localStorage — config lives in state + URL.

## Core architecture rule

All catalog knowledge lives in `public/catalog.json`. Components never hardcode part lists. The current selection is a single serializable `config` object — this object later becomes the platform's structured config JSON, so keep it clean:

```json
{
  "configId": "uuid",
  "pole": "sacramento-14",
  "baseCover": "bc-fluted",
  "arm": "sh1-shepherds-hook",
  "fixture": "gvx-pendant",
  "finish": "matte-black",
  "rev": 1
}
```

## catalog.json shape

Each part: `id`, `slot` (pole|baseCover|arm|fixture), `name`, `family`, `heightFt`/`dims`, `sockets` (e.g. `{"top": "tenon-3in"}`), `compatibleSockets`, `finishes[]`, `model` (GLB path), `thumbnail`, `productUrl` (willbrands.com page).

Compatibility = socket matching only. A fixture with `mount: "pendant"` only attaches to arms exposing `pendant`. Filter the UI so invalid combos are unselectable — never render a broken assembly.

## 3D scene requirements

- Ground plane, soft shadows, neutral HDRI environment
- Orbit + zoom, sensible min/max distance; camera framing follows assembled height
- Optional human silhouette (~6 ft) for scale toggle
- Parts assemble by attaching each GLB at named socket positions (from catalog data, not hardcoded offsets)
- Finish swap = swap one shared PBR material (color + roughness/metalness), instant
- Real units: 1 unit = 1 meter; poles are 10–16 ft, get scale right

## Asset pipeline (document in repo as ASSETS.md)

CAD (STEP/SolidWorks) → Blender (or CAD converter) → GLB:

1. Import STEP, decimate to visual quality (target < 500 KB per part with Draco)
2. Origin at the part's lower attachment point; +Y up
3. Name empty nodes for sockets: `socket_top`, `socket_arm`, `socket_fixture`
4. Single material slot named `finish` on paintable surfaces
5. Export GLB with Draco compression

Until real GLBs arrive, build against parametric placeholder primitives generated in code (cylinder pole, torus base, box fixture) behind the same catalog interface — the app must not block on assets.

## UI

Left panel: stepper (Pole → Base Cover → Arm → Fixture → Finish) with thumbnails and names; each step filtered by compatibility. Right: 3D window. Below/side: config summary (part names + links to product pages) and two actions:

- **Share** — config serialized into URL query params; loading that URL restores the build
- **Request a Quote** — link to https://willbrands.com/pages/request-a-quote with the config summary prefilled/attached (query param or copyable text block)

Style: clean, dark-neutral, matches willbrands.com feel (theme blue `#1434ff` as accent). Mobile: 3D window above panel, still usable.

## Initial kit (verify CAD availability, then lock)

- Poles: Sacramento, Washington, Williamsburg (decorative aluminum anchor base)
- Base covers: 2–3 from Decorative Base Covers line
- Arms: SH1 Shepherds Hook, Decorative Upsweep, PM1 Pendant Arm
- Fixtures: DRX Post Top, TEX Post Top, GVX Pendant
- Finishes: 4–6 standard WiLLcoat colors (confirm palette with team)

## Explicitly out of scope

AI/intent parsing, CAD/BIM file download, pricing, photometrics, EPA/structural validation, user accounts, CMS/Shopify integration, nighttime lighting simulation. If it's tempting, it's Phase 1+.

## Milestones

M0 skeleton with placeholders → M1 one real GLB through the pipeline → M2 full kit + sockets + compatibility → M3 finishes, share URL, quote handoff, deploy.

## Definition of done

A customer opens a URL, builds any valid combination, orbits it at correct scale, shares the link, and submits the configuration as a quote request.
