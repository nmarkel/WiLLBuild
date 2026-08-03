# Asset Pipeline

How WiLL CAD parts become web-ready GLBs for the configurator.

**Pipeline: CAD (STEP/SolidWorks) → Blender (or CAD converter) → GLB**

## Per-part checklist

1. Import the STEP file into Blender; decimate to visual quality. Target **< 500 KB per part** after Draco compression.
2. Place the origin at the part's **lower attachment point**, with **+Y up**.
3. Model in **real units: 1 unit = 1 meter** (poles are 10–16 ft — get scale right).
4. Add named empty nodes for sockets where other parts attach: `socket_top`, `socket_arm`, `socket_fixture`.
5. Use a **single material slot named `finish`** on all paintable surfaces — the app swaps one shared PBR material for instant finish changes.
6. Export GLB **with Draco compression** into `public/models/`.

## Wiring a GLB into the catalog

In `public/catalog.json`, set the part's `model` to its path (e.g. `models/gvx-pendant.glb`) and add a `thumbnail`. Socket positions in the catalog must match the socket empties in the GLB. Until a real GLB exists, `model` is `null` and the app renders the part's `placeholder` primitive — the app must never block on assets.

## Geometry quality bar (Phase 0.2)

HDRI/image-based lighting is unforgiving — it exposes geometry quality directly in reflections and shading. GLBs must meet this bar:

- **Clean normals** — no flipped or unwelded normals; smooth shading set up correctly.
- **No faceting on curved pole surfaces** — turned/revolved parts need sufficient radial segments so cylinders and tapers read as smooth under environment lighting.
- **UVs suitable for AO baking** — non-overlapping, sensibly packed UVs so ambient occlusion can be baked per part.

## Geometry sourcing — Cole's STEP (Phase 0.8, Workstream B — locked 2026-07-28)

**All real product geometry comes from Cole exporting STEP from the existing SolidWorks models — never AI-generated 3D.** Text/image→3D (ChatGPT + Claude) was evaluated and is unusable for precise luminaires; the accurate geometry already exists in CAD. AI's role for *new* products (Mode 3 / Phase 2) is a concept **image** that Cole turns into CAD — not geometry generation.

Both tracks consume the same source: the offline render rig (`scripts/render-rig/`) bakes the viewer's WebP layers, and the geometry-service (`geometry-service/`) emits the STEP/DWG/IFC/RFA downloads — both from the one canonical part geometry. So multi-arm makes "render from real geometry" non-optional: the same CAD that powers the downloads generates the multi-arm position renders. Cole's ask stays "give geometry," not "hand-shoot every arm at every angle in every finish."

Blender's remaining job is **converting** real CAD → web GLB (decimate, sockets, finish material slot) — not authoring. Real GLBs already flow through this path for `alum-pole-12`, `bc-round`, `sh1-shepherds-hook`, `gvx-pendant` (see `scripts/render-rig/real-parts.json`); every other part renders from its photo-informed placeholder solid until its STEP lands, and Cole's renders drop into the same `public/renders/manifest.json` slots with no app change.

## Multi-arm & banner position renders (Phase 0.8, Workstream A/B)

Radial attachments (arms, fixtures, banner arms) can't be faked by pasting one flat PNG — each mount azimuth is a different view. The rig renders each such part once per **discrete mount azimuth** by rotating the part about the vertical (+Y) axis under the fixed camera (`renderPart(partId, finishId, yawDeg)` in `page/main.ts`), and stores each under an `az<deg>` manifest angle key (0° reuses `hero`). The consumer (`src/lib/composite.ts`) picks the per-azimuth render for each radial position and z-orders it by camera depth (arms reaching away from the camera draw behind the pole).

The azimuth set is exactly the union across single / twin@180° / triple@120° / quad@90° = **{0, 90, 120, 180, 240, 270}** — 6 angles. This keeps the asset set **bounded and pre-bakeable**, not a per-config explosion:

- **17 radial parts** (12 arms + 4 fixtures + 1 banner arm, WiLLstudio) × 6 angles × 5 finishes = **510** renders
- **89 single-view parts** × 5 finishes = **445** renders
- **955 WebP total** in `public/renders/` (was 525 at Phase 0.5)

Regenerate with `npm run render-rig -- --line WiLLstudio` then `npm run render-manifest`.

## Status

Real GLBs exist for `alum-pole-12`, `bc-round`, `sh1-shepherds-hook`, `gvx-pendant`; all other parts render from parametric placeholder solids until their STEP arrives (drops into the same manifest slots — the app never blocks on assets).
