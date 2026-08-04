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

- **45 radial parts** (arms + fixtures + banner arms across the WiLLstudio, NAFCO & WiLLsport builder lines) × 6 angles × 5 finishes = **1350** renders
- **63 single-view parts** (poles, base covers, standalone) × 5 finishes = **315** renders
- **1665 WebP total** in `public/renders/` (was 955 at Phase 0.8, 525 at Phase 0.5)

Regenerate a line's layers with `npm run render-rig -- --line <WiLLstudio|NAFCO|WiLLsport>` (writes a `manifest-<slug>.json` shard) then `npm run render-manifest` (merges all shards → `public/renders/manifest.json`).

### Multi-arm + banner exposed on NAFCO & WiLLsport (Phase 0.9, Workstream A4)

Radial arm-count + banner arms, previously WiLLstudio-only, were added **additively** to the NAFCO & WiLLsport builders — WiLLstudio kept everything. This is a catalog + asset change, no viewer/compositor code change:

- `arrangements: [1,2,3,4]` added to every NAFCO & WiLLsport **pole** and to their **generic / single-arm** arms. Pre-counted NAFCO SKUs (ABH-2/3/4, SPX-2/3/4, UPX-2 — the count is baked into the product) and the tenon-adapter / direct-mount pseudo-arms are deliberately **left single** (no `arrangements`), so you can't radially multiply a "quad bracket". This mirrors WiLLstudio, where only the "No Arm — Direct Pole Mount" lacks `arrangements`.
- New banner parts `nafco-ba1-banner-arm` and `willsport-ba1-banner-arm` (cloned from `willstudio-ba1-banner-arm`).
- The az-angle position renders for those lines' radial parts + banners were baked by re-running the rig for `--line NAFCO` and `--line WiLLsport` (they predated the Phase 0.8 az logic and had hero-only shards).

## Generated-vs-source decision (Phase 0.9, Workstream C — decided 2026-08-03)

**Decision: the render WebPs (`public/renders/*.webp` + `manifest*.json`) and the spec-parse outputs (`scripts/spec-parse/`) are COMMITTED, tracked assets — not regenerated by a build/deploy step.**

Rationale: the frontend is a static site (see CLAUDE.md "Stack"). Committing the baked layers means `npm run build` → deploy needs no headless-Chrome render rig or Python spec-parser in CI; the viewer's assets ship as-is. The trade-off is repo size (~7.5 MB of WebP); at this scale that is acceptable and Git LFS is not warranted. They remain **regenerable** — the offline rig (`scripts/render-rig/`, a devDependency using Puppeteer + three) and `scripts/spec-parse/` reproduce them deterministically — but the committed copies are the source of truth the app reads. Revisit (Git LFS or a build step) only if the render set grows past tens of MB.

## Real-CAD ingest (Phase 0.10 — 2026-08-04)

Engineering's released WiLLstudio STEP set (`/Volumes/WiLLdrive/Engineering/Marketing-Engineering/STEP-Website/WiLLstudio`, 26 files / 380 MB) is now ingested. **The filenames are ordering codes** (`SS3-40F.STEP` = Side Shepherds Hook, 3 arms, 4" flush pole fit), which is why the ingest is also the provenance record for part numbers.

**Pipeline (offline, one command per batch):**

```
cp <drive>/*.STEP scripts/render-rig/real-assets/step/        # gitignored
cd scripts/step-to-glb
../../geometry-service/.venv/bin/python ingest.py             # small/medium parts
../../geometry-service/.venv/bin/python ingest.py --fixtures  # the 22-87 MB masters
../../geometry-service/.venv/bin/python ingest.py --manifest  # docs/real-geometry.json
cd ../.. && npm run render-rig -- --parts <ids>               # WebP layers
npm run render-manifest && node scripts/build-viewer-assets.mjs
```

- **STEP → GLB** (`scripts/step-to-glb/convert.py`, OCP): tessellated to a per-part tolerance (0.5–1.5 mm — this is the "decimate" step; there is no mesh simplifier in the offline chain), origin at the part's lower attachment point, and **colour-aware** for fixtures so only the paintable `will-body` primitive takes the finish while lens/LED/PCB keep their STEP-authored colours. That `will-body` primitive IS the finish material slot this document's checklist asks for.
- **Frames:** the masters are Y-up (SolidWorks), except the bollard + flood, which are modelled Z-up — those are stood up at conversion time (`rotateX`). Reach direction is corrected per part (`rotateY` in `real-parts.json`) so every arm reaches +X, the axis the assembly rotates about the pole.
- **Sockets:** real geometry corrected the catalog again (the 0.6/PoC pattern): SS1 fixture socket `[0.6,0.42,0]` → `[0.622,0.676,0]`, AR1 `[0.7,0.14,0]` → `[0.61,0.143,0]` (both measured from the real hook tube-end centre plus the 92 mm pendant-stem insertion already calibrated on the real SH1), and the banner's bar centres to a symmetric ±0.625 m.
- **What ships:** only the ~4 KB WebP layers + the tracked manifests. STEP (380 MB) and GLB (140 MB) stay gitignored, exactly as since the 0.6 spike.
- **Coverage table:** `viewer-assets.md` (generated) marks every part **real CAD** vs **placeholder** and lists the unmapped files; `docs/real-geometry.json` carries per-file sha256 + mapping.

**CAD downloads.** `app/realgeom.py` resolves a part (and its configured design code) to real CAD, and the zip bundle ships Engineering's own STEP per component named by part number (`factory-cad/WP-SS3-40F-BK.step` IS the released 3-arm assembly). Building the *assembly* solid from real B-reps is opt-in (`REAL_GEOMETRY_IN_KIT=1`) and off by default: parsing a master costs 10–20 s and fusing several did not finish in 10 minutes, so STEP/DXF/IFC/RFA stay on the fast parametric path.

## Status

**Real CAD (14 parts):** `alum-pole-12`, `sh1-shepherds-hook`, `willstudio-side-shepherds-hook-pole-top-brackets`, `willstudio-suspension-arm-pole-top-brackets`, `bc-round`, `bc-fluted`, `aluminum-light-pole-base-covers`, `willstudio-ba1-banner-arm`, `gvx-pendant`, `drx-post-top`, `tex-post-top`, `mvx-coach`, `willstudio-rxb-sxb-bollard`, `willstudio-dwx-flood-spot`.

**Still placeholder (94 parts):** every NAFCO / WiLLsport / WiLLev / WiLLcloud product, plus the WiLLstudio parts with no released STEP yet (the remaining arms, the inventory poles, and the fluted/round covers' sibling styles). Real CAD drops into the same manifest slots — the app never blocks on assets. Unmapped real files (`FH-4R`, `PH-4R`, `SC1-4R`, `SC2-4R`) are recorded in `docs/real-geometry.json` awaiting a code confirmation from Tyler/Cole.
