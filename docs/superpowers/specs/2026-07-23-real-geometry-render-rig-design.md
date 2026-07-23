# Real-Geometry Render Rig — PoC Design

**Date:** 2026-07-23
**Branch:** `real-geometry-rig`
**Status:** Approved design (brainstorming complete) → next: implementation plan
**Related:** `Phase 0.6 — STEP Capability Findings` (Design Assistant vault),
`Rendering Approach — Image-Based Viewer (Decision)`, CLAUDE.md §"Compositing viewer
requirements (0.5)", `scripts/render-rig/`

## Goal

Feed Cole's real SolidWorks STEP geometry into the **existing** offline render rig so it
produces higher-fidelity transparent WebP layers for the four target-assembly parts, which
drop into the **same `public/renders/manifest.json` slots** consumed by the compositing
viewer. This is a **proof of concept** to judge whether the visual-quality jump from
placeholder solids to real geometry is worth productionizing — not a full catalog rollout.

**Non-negotiable invariant:** zero change to the app, the compositor (`src/lib/composite.ts`),
the viewer, or the manifest schema. Only the *layer source* improves — exactly what the 0.5
image-based architecture was built to allow ("realism scales with render quality, not runtime
geometry").

## Why this is the right use of the STEP file

The render rig (`scripts/render-rig/page/main.ts`) already renders each part with three.js
under a **fixed orthographic camera + lighting**, applies a finish material, trims to the
alpha bounding box, and emits a WebP layer plus the `worldToImage` projection the compositor
uses to align layers. The only crude element is the geometry source: `specToObject(part.placeholder,
material)` builds primitive box/cone/lathe solids. Swapping that one call for "load the real
mesh" upgrades quality with no downstream change.

Critically, the "GLB is 16–42 MB" problem from the Phase 0.6 Test E (STEP→GLB) does **not**
apply: here the GLB is an **offline rig input**, loaded once by headless Chrome during asset
generation. The browser still receives only the same small WebP layers it gets today.

## Architecture / pipeline

```
STEP ──(offline: OCP Python)──▶ GLB (local, gitignored)
                                  │
        existing rig page loads via GLTFLoader (not specToObject)
                                  │
   same camera / sun / trim / anchor / worldToImage  ──▶ WebP + manifest shard
                                  │
        merge ──▶ public/renders/manifest.json ──▶ viewer (unchanged)
```

Layer alignment holds because every layer is still rendered against ONE shared rig (fixed
camera/scale) and positioned by projecting catalog socket offsets through the rig's
`worldToImage` map. The rig block in the manifest is byte-identical to today's (same camera),
so `merge-manifests.mjs`'s "identical rig block" assertion passes and layers composite with
existing placeholder layers seamlessly.

## Components (each a small, independently-testable unit)

### 1. `scripts/step-to-glb/convert.py` — STEP → GLB converter (offline, OCP)
- **What it does:** converts one STEP file to one GLB mesh in the rig's coordinate
  conventions (meters, Y-up).
- **Inputs:** STEP path, part id, `--color-aware` flag.
- **Output:** a `.glb` in a local, gitignored asset dir (e.g. `scripts/render-rig/real-assets/`).
- **Monolithic mode (pole, base, hook):** tessellate to a single mesh, no color (the rig
  paints the finish over the whole part). Reuses the Phase 0.6 `real_step.py` tessellation
  approach; converts inches/mm → meters; keeps Y-up.
- **Color-aware mode (GVX fixture):** read STEP authored colors via OCP XCAF
  (`STEPCAFControl_Reader` → `XCAFDoc_ColorTool` over the XDE document), group faces/solids
  by authored `COLOUR_RGB`, emit a **multi-primitive GLB** where each primitive carries its
  authored color, and set a per-primitive flag (glTF material `name` prefix, e.g.
  `will-body-*` vs `will-fixed-*`) marking which primitives are the **aluminum body** (the
  recurring RGB ≈ 0.894 gray) to be repainted with the finish. Non-body primitives (lens,
  LED, PCB, hardware) keep their authored colors.
- **Depends on:** OCP (`cadquery-ocp`, already in the geometry-service venv), a minimal glTF
  writer (hand-written, numpy-only — proven in Phase 0.6 Test E).

### 2. `main.ts` real-geometry branch — GLTFLoader + finish material
- **What it does:** when a catalog part has an optional `realModel` (GLB path), load it via
  three.js `GLTFLoader` instead of calling `specToObject`.
- **Finish application:**
  - Monolithic parts: assign the finish `MeshPhysicalMaterial` (from `makeMaterial(finish)`)
    to all meshes in the GLB.
  - Fixture: assign the finish material only to primitives flagged `will-body-*`; keep the
    authored colors (as a `MeshStandardMaterial` seeded from the primitive color) on
    `will-fixed-*` primitives.
- **Unchanged:** camera, sun, trim, anchor computation, `worldToImage`, WebP encode. The
  real-geometry branch touches only mesh construction + material assignment.
- **Fallback:** if `realModel` is absent, or the GLB is missing / fails to load, fall back to
  `specToObject(part.placeholder, material)` — never a blank layer.

### 3. Corrected socket offsets (assembly alignment)
- **What it does:** measure the real attachment points from the geometry (reusing the Phase
  0.6 `test_f_assembly.py` approach) and write corrected socket offsets for the four PoC parts
  into `public/catalog.json`, so the composited assembly aligns at every joint.
- **Why:** Phase 0.6 Test F showed the catalog's hook→fixture socket offset is on the wrong
  horizontal axis and ~20–40% off in magnitude; without correction the composited GVX would
  float relative to the hook. Pole-top is already exact (2.4 mm), so this is bounded to the
  hook clamp/fixture points and the base.
- **Scope note:** this is about assembly *precision*, not image quality. Limited to the four
  PoC parts; no change to the socket *model* or other parts.

### 4. Driver + catalog wiring
- Add optional `realModel` (GLB path) to the four PoC catalog parts:
  `alum-pole-12` ← `RSAA-4040-12.STEP`, `bc-round` ← `CL2-4R.STEP`,
  `sh1-shepherds-hook` ← `SH1-40F.STEP`, `gvx-pendant` ← `WD-GVX-PM`.
  (Mapping chosen for a compatible, selectable assembly: `alum-pole-12` and the SH1 hook both
  use `tenon-3in`; `bc-round` uses `base-collar`.)
- `generate.mjs` renders the four parts × five finishes; unmatched parts keep placeholder
  rendering. Manifest merge unchanged.

## Data flow

STEP → (offline convert) → GLB (local) → rig page `GLTFLoader` → three.js render with finish
applied → trim to alpha bbox → WebP + anchor → manifest shard → `merge-manifests.mjs` →
`public/renders/manifest.json` → viewer composites (unchanged), finish-swappable.

## Error handling / fallback

- Missing or unreadable `realModel` GLB → placeholder `specToObject` render (no blank layer).
- Empty WebP readback → existing rig error path (logs, skips) unchanged.
- Color-aware conversion risk: XCAF color extraction is the one genuinely new piece. **If it
  proves fiddly, the PoC falls back to uniform finish paint on the fixture too, flagged
  explicitly** — it does not block the PoC. (User-approved fallback.)

## Testing

- **Converter unit test:** output GLB parses (magic/version/chunk lengths), expected primitive
  count, and for the fixture the aluminum-body primitives are flagged.
- **Rig output:** each real part × finish produces a non-empty WebP; manifest shard `rig`
  block equals the current rig block (so merge assertion passes).
- **Regression:** `composite.coverage.test.ts` green (manifest still covers every part ×
  finish + every builder combo with 0 missing); full frontend `npm run test` green;
  geometry-service suite unaffected (untouched).
- **Visual (the actual go/no-go deliverable):** render the real target assembly, screenshot it
  composited in the viewer, and present it **side-by-side with the current placeholder** for
  the quality judgment. Verify finish swap across all 5 finishes and that the assembly aligns
  at every joint.

## Out of scope (YAGNI)

Lighting / HDRI upgrade (current rig lighting kept, to isolate the geometry variable);
decimation / LOD; the other 101 catalog parts; committing GLBs to the repo; shipping GLB to
the browser; photoreal / SolidWorks-Visualize-grade materials; changing the socket *model* or
the compositor.

## Definition of done

The viewer shows the real configured product (round pole + CL2 base + SH1 hook + GVX fixture)
built from real-geometry WebP layers in the existing compositor — finish-swappable across all
five finishes, aligned at every joint — presented side-by-side with the placeholder version
for a go/no-go on rolling real geometry across the catalog. No app/compositor/viewer/manifest-
schema change; all existing tests green.
