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

Blender's remaining job is **converting** real CAD → web GLB (decimate, sockets, finish material slot) — not authoring. Real GLBs (used by the render rig) flow through this path for the parts listed in `scripts/render-rig/real-parts.json` (23 entries as of Phase 0.10.5 — all 8 WiLLstudio pole heights, the 5 official base covers, the core fixtures/arms). The geometry-service resolves real STEP for CAD/BIM downloads from a separate, smaller list (`geometry-service/app/realgeom.py`'s `BASE_FILES`, 14 files — e.g. only `alum-pole-12` among the 8 pole heights, since the other heights aren't yet on real geometry in that pipeline). Real-CAD-backed catalog parts overall went from 9 (Phase 0.10) to **26 of 117** as of Phase 0.10.5. Every other part renders from its photo-informed placeholder solid until its STEP lands, and Cole's renders drop into the same `public/renders/manifest.json` slots with no app change.

## Multi-arm & banner position renders (Phase 0.8, Workstream A/B)

Radial attachments (arms, fixtures, banner arms) can't be faked by pasting one flat PNG — each mount azimuth is a different view. The rig renders each such part once per **discrete mount azimuth** by rotating the part about the vertical (+Y) axis under the fixed camera (`renderPart(partId, finishId, yawDeg)` in `page/main.ts`), and stores each under an `az<deg>` manifest angle key (0° reuses `hero`). The consumer (`src/lib/composite.ts`) picks the per-azimuth render for each radial position and z-orders it by camera depth (arms reaching away from the camera draw behind the pole).

The azimuth set originally covered only the union of actual mount arrangements (single / twin@180° / triple@120° / quad@90° = 6 angles). **As of Phase 0.10.5 that partial-coverage model is gone: every catalog part ships the full 8-position compass** — `hero` + `az45`/`az90`/`az135`/`az180`/`az225`/`az270`/`az315` (a uniform 45°-step ring) — regardless of whether the part is radial. This also backs the viewer's whole-assembly `viewYaw` rotation (`CompositeViewer.tsx`), which needed every part, not just radial ones, to have a full compass. `src/lib/composite.coverage.test.ts` is the enforcement gate: zero exemptions, one bug ticket per gap, never a special-cased carve-out (the former `REAL_RENDER_PARTS`/`CORE_FINISH_IDS` partial-coverage list from Phase 0.9 is removed).

- **117 catalog parts** × **8 angles** × **13 finishes** (per-component finish, Phase 0.10.5 — see CLAUDE.md Status) = **12,168 WebP renders total**, **~36.5 MB committed** in `public/renders/` (was 1665 at Phase 0.9, 955 at Phase 0.8, 525 at Phase 0.5).
- Rig camera: `pxPerMeter` 360 as of Phase 0.10.5 (was `PX_PER_M=180` through Phase 0.9 — the rig was re-baked at higher resolution alongside the coverage expansion), azimuth 35°/elevation 6°, unchanged.

Regenerate a line's layers with `npm run render-rig -- --line <WiLLstudio|NAFCO|WiLLsport>` (writes a `manifest-<slug>.json` shard) then `npm run render-manifest` (merges all shards → `public/renders/manifest.json`).

### Multi-arm + banner exposed on NAFCO & WiLLsport (Phase 0.9, Workstream A4)

Radial arm-count + banner arms, previously WiLLstudio-only, were added **additively** to the NAFCO & WiLLsport builders — WiLLstudio kept everything. This is a catalog + asset change, no viewer/compositor code change:

- `arrangements: [1,2,3,4]` added to every NAFCO & WiLLsport **pole** and to their **generic / single-arm** arms. Pre-counted NAFCO SKUs (ABH-2/3/4, SPX-2/3/4, UPX-2 — the count is baked into the product) and the tenon-adapter / direct-mount pseudo-arms are deliberately **left single** (no `arrangements`), so you can't radially multiply a "quad bracket". This mirrors WiLLstudio, where only the "No Arm — Direct Pole Mount" lacks `arrangements`.
- New banner parts `nafco-ba1-banner-arm` and `willsport-ba1-banner-arm` (cloned from `willstudio-ba1-banner-arm`).
- The az-angle position renders for those lines' radial parts + banners were baked by re-running the rig for `--line NAFCO` and `--line WiLLsport` (they predated the Phase 0.8 az logic and had hero-only shards).

## Generated-vs-source decision (Phase 0.9, Workstream C — decided 2026-08-03)

**Decision: the render WebPs (`public/renders/*.webp` + `manifest*.json`) and the spec-parse outputs (`scripts/spec-parse/`) are COMMITTED, tracked assets — not regenerated by a build/deploy step.**

Rationale: the frontend is a static site (see CLAUDE.md "Stack"). Committing the baked layers means `npm run build` → deploy needs no headless-Chrome render rig or Python spec-parser in CI; the viewer's assets ship as-is. The trade-off is repo size — **~36.5 MB of WebP as of Phase 0.10.5** (was ~7.5 MB at Phase 0.9, when the render set was 1665 files); at this scale that is still acceptable and Git LFS is not warranted, though this is the largest jump yet and worth a periodic check as coverage keeps growing (flagged for human confirmation post-0.10.5). They remain **regenerable** — the offline rig (`scripts/render-rig/`, a devDependency using Puppeteer + three) and `scripts/spec-parse/` reproduce them deterministically — but the committed copies are the source of truth the app reads. Revisit (Git LFS or a build step) only if the render set grows meaningfully past this.

## Status

26 of 117 catalog parts are backed by real CAD (Engineering's SolidWorks STEP exports, see "Geometry sourcing" above), up from 9 at Phase 0.10; all other parts render from parametric placeholder solids until their STEP arrives (drops into the same manifest slots — the app never blocks on assets). Every part, real-CAD or placeholder, ships the full 8-angle × 13-finish render set (`public/renders/manifest.json`; 12,168 entries, ~36.5 MB) — coverage no longer varies by geometry source.
