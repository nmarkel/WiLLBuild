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

## Status

No real GLBs yet — all parts currently render as parametric placeholder primitives defined by each part's `placeholder` spec in the catalog (see M1 milestone: first real GLB through the pipeline).
