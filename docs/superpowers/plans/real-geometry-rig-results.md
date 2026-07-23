# Real-Geometry Render Rig PoC — Results

**Date:** 2026-07-23 · **Branch:** `real-geometry-rig` · **Plan:** `2026-07-23-real-geometry-render-rig.md`

## Outcome: SUCCESS — recommend productionizing (scoped rollout)

Cole's real STEP geometry now renders through the existing offline render rig into the
same `manifest.json` slots. The WiLLstudio target assembly (round pole + CL2 base + SH1
shepherd's hook + GVX pendant) composites in the viewer as a coherent, real product,
finish-swappable, with **zero change to the app, compositor, viewer, or manifest schema**.

## What shipped (branch `real-geometry-rig`, 8 commits off 24c2e0f)

- **Offline STEP→GLB converter** (`scripts/step-to-glb/`): monolithic mode (pole/base/hook)
  + color-aware mode (fixture) reading STEP authored colors via OCP XCAF.
- **Rig extension** (`scripts/render-rig/page/main.ts`): loads real GLBs via `GLTFLoader`,
  applies the finish only to `will-body` primitives, keeps authored colors on `will-fixed-*`.
- **Driver** (`generate.mjs` + `real-parts.json`): preloads each GLB as base64; degrades to
  placeholder on missing/corrupt GLB.
- **Corrected sockets** (`public/catalog.json`) + a "mount" origin mode for the hook.

## Conversion + render stats

| Part | STEP | GLB (offline) | Finish mode | Shipped WebP (matte-black) |
|------|------|---------------|-------------|----------------------------|
| Pole RSAA-4040-12 → `alum-pole-12` | 15 KB | 6.9 KB | uniform | 4 KB (31×670) |
| Base CL2-4R → `bc-round` | 7.9 MB | 1.5 MB | uniform | 4 KB (91×119) |
| Hook SH1-40F → `sh1-shepherds-hook` | 386 KB | 180 KB | uniform | 4 KB (77×169) |
| Fixture GVX (master asm) → `gvx-pendant` | 87 MB | 25 MB | **color-aware** (8 prims: 2 body / 6 fixed) | 4 KB (99×100) |

**The headline number:** shipped WebPs are ~4 KB each — the *same order as the placeholder
layers they replace*. All geometry weight (incl. the 25 MB fixture GLB) stays offline; the
browser payload does not grow. This is exactly what the 0.5 image-based architecture was
built to exploit: realism scales with the offline layer source at no runtime cost. The
"GLB is 16–42 MB" blocker from Phase 0.6 Test E does not apply — GLB is a rig input, never shipped.

## Finish behavior (color-aware fixture)

Verified in-app across finishes: the fixture **housing** recolors with the selected finish
(matte-black ↔ silver ↔ …) while the **lens/LED/PCB keep their STEP-authored colors**
(Task-3 pixel sampling: housing pixel swings 65→238→184 across matte-black/gloss-white/silver;
a fixed-color region stays ~124–127). Pole/base/hook recolor uniformly, which is correct —
they are single-color powder-coated aluminum.

## Alignment

Parts composite via catalog socket offsets projected through the shared rig map (unchanged
mechanism). Two real-geometry adjustments were needed and made:
- **Corrected sockets** from the real geometry: pole top `[0,3.6576,0]` (12.00 ft exact),
  hook fixture socket `[0,0.729,-0.513]` (replacing the placeholder `[0.63,0.45,0]`, which
  Phase 0.6 Test F had flagged as wrong-axis + ~20–40% off).
- **"mount" origin mode** for the hook: its pole-gripping collar is modeled on the CAD's
  native X/Z axis, but bbox-centering (origin="base") shoved the collar ~0.23 m off the pole
  axis because the hook reaches ~0.5 m in −Z. The "mount" mode trusts native X/Z and only
  floors Y. After this, the collar sits coaxially on the pole top and the gooseneck rises
  cleanly to the fixture (verified visually; screenshots captured during acceptance).

Residual: `bc-round` has no sockets and aligns by origin coincidence (both at ground, coaxial)
— fine for this assembly; give it an explicit base socket if reused elsewhere.

## Before / after (qualitative)

- **Before (placeholder):** pole = tapered parametric cylinder; base = revolved lathe; hook =
  a smooth tube curve; fixture = a generic lathe bell. Reads as "a pole-ish thing."
- **After (real):** the actual straight round extruded pole, the real cast decorative CL2
  base, the true shepherd's-hook gooseneck + mounting collar, and the real GVX pendant with
  molded housing detail and a distinct lens. Reads as the real product.

## Regression status

- `composite.coverage.test.ts`: 12/12 (every part × 5 finishes + every builder combo, 0 missing).
- Full frontend suite: 111/111 (one `compat.test.ts` assertion updated to track the intentional socket change).
- Rig block byte-identical → merge assertion holds; only the 4 real parts' slots changed; no placeholder churn.

## Recommendation for a later phase

1. **Green-light real geometry for the render rig** — it's a clear quality jump at zero
   runtime cost and drops into the same slots as Cole's eventual final renders.
2. **Roll out per assembly, driven by STEP availability.** Each new real part needs: a STEP
   file, a converter run (monolithic, or color-aware if it has meaningful internal colors),
   an entry in `real-parts.json`, and — if it's an asymmetric arm/bracket — a socket/origin
   check like the hook's. Budget a short visual-alignment pass per assembly.
3. **Lighting is the next quality lever** (deliberately held constant here). A studio HDRI /
   soft shadow in the rig would lift realism further without touching the app.
4. **Trim the fixture GLB** (25 MB / ~1.1 M tris) if converter/render time matters at catalog
   scale — prune internal solids; not needed for correctness.
5. **Generalize the "mount" origin** — many arms/brackets will have the same off-axis-bbox
   issue; consider per-part origin metadata in `real-parts.json` rather than a CLI arg.

## Reproduce

```
# convert (geometry-service venv python)
PY=geometry-service/.venv/bin/python
cd scripts/step-to-glb
$PY convert.py ../render-rig/real-assets/step/RSAA-4040-12.STEP ../render-rig/real-assets/glb/alum-pole-12.glb base
$PY convert.py ../render-rig/real-assets/step/CL2-4R.STEP        ../render-rig/real-assets/glb/bc-round.glb base
$PY convert.py ../render-rig/real-assets/step/SH1-40F.STEP       ../render-rig/real-assets/glb/sh1-shepherds-hook.glb mount
$PY -c "from convert import convert_color_aware as c; c('../render-rig/real-assets/step/WD-GVX-PM','../render-rig/real-assets/glb/gvx-pendant.glb',origin='top',tol_mm=1.0)"
# render + merge
cd ../.. && node scripts/render-rig/generate.mjs --line WiLLstudio && node scripts/render-rig/merge-manifests.mjs
# view: /studio/design?pole=alum-pole-12&baseCover=bc-round&arm=sh1-shepherds-hook&fixture=gvx-pendant&finish=matte-black
```
