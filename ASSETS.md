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

Blender's remaining job is **converting** real CAD → web GLB (decimate, sockets, finish material slot) — not authoring. Real GLBs (used by the render rig) flow through this path for the parts listed in `scripts/render-rig/real-parts.json` (23 entries as of Phase 0.10.5 — all 8 WiLLstudio pole heights, the 5 official base covers, the core fixtures/arms). The geometry-service resolves real STEP for CAD/BIM downloads from a separate, smaller list (`geometry-service/app/realgeom.py`'s `BASE_FILES`, 14 files — e.g. only `alum-pole-12` among the 8 pole heights, since the other heights aren't yet on real geometry in that pipeline). Real-CAD-backed catalog parts overall went from 9 (Phase 0.10) to **23 of 117** as of Phase 0.10.5, and remain at 23 after Phase 0.11. This paragraph previously said 26, which contradicted both `real-parts.json` and CLAUDE.md.

Phase 0.11 Workstream I *did* ingest Cole's 8/6 batch — 22 new STEP files copied from Synology, and the five with an unambiguous catalog part (PA1, PM1, FR2, HS1, SD1 — each filename is that part's own `modelCodes` entry) converted cleanly to GLB. They are deliberately **not** wired into the render rig, because mapping them renders them MISALIGNED, which is worse than the placeholder and invisible to the coverage gate (the renders exist, they are just in the wrong place). Two measured mismatches: every real arm reaches along **Z** (bbox z = 0.45–1.44 m, x pinned at ~0.102 m = the 4" pole clamp) while every catalog placeholder reaches along **+X**, so each needs a `rotateY` like `sh1-shepherds-hook` (-90) already has; and the real reaches disagree with the catalog fixture sockets, which were authored against the placeholders (PA1 reaches 0.995 m against a socket at x=0.68; HS1 reaches 1.437 m against x=0.50). Each socket has to be re-derived from the real CAD — the same correction the 0.10 ingest made when it "corrected two arm sockets". Verified in the browser before reverting: the PA1 arm floated clear of both the pole top and its pendant. The STEP files, GLBs and the provenance record in `docs/real-geometry.json` are all in place, so the next pass starts from measurement, not re-ingest. Every other part renders from its photo-informed placeholder solid until its STEP lands, and Cole's renders drop into the same `public/renders/manifest.json` slots with no app change.

## Multi-arm & banner position renders (Phase 0.8, Workstream A/B)

Radial attachments (arms, fixtures, banner arms) can't be faked by pasting one flat PNG — each mount azimuth is a different view. The rig renders each such part once per **discrete mount azimuth** by rotating the part about the vertical (+Y) axis under the fixed camera (`renderPart(partId, finishId, yawDeg)` in `page/main.ts`), and stores each under an `az<deg>` manifest angle key (0° reuses `hero`). The consumer (`src/lib/composite.ts`) picks the per-azimuth render for each radial position and z-orders it by camera depth (arms reaching away from the camera draw behind the pole).

The azimuth set originally covered only the union of actual mount arrangements (single / twin@180° / triple@120° / quad@90° = 6 angles). Phase 0.10.5 replaced that with a uniform 8-position 45° compass. **Phase 0.11 (Workstream E) narrows it again to four — `hero`/`az90`/`az180`/`az270` — without reintroducing any exemption.**

The reason the set shrank is a change to the *view* model, not to coverage. The canonical view set is now **2 full-assembly views 180° apart plus per-component focus views** (Tyler + Nick, 8/10), superseding the 45° orbit. A focus view is a **framing over the composited layers, not a new asset**: the rig alpha-crops each part individually at a fixed `pxPerMeter`, so a "tighter framing" of a single part would re-render a byte-identical image — see `focusBox` in `src/lib/composite.ts`. So the render set is driven purely by what a radial cluster needs *inside* one of the two views: `(armAzimuth + armOrientation − viewYaw) mod 360` over armAzimuths ⊆ {0,90,180,270}, orientation ∈ {0,90,180,270}, viewYaw ∈ {0,180} — exactly those four. `az45`/`az135`/`az225`/`az315` became unreachable and were pruned.

Every part still ships every shipped angle × every finish: 0.10.5's zero-exemptions rule is unchanged, only the set is smaller. `src/lib/composite.coverage.test.ts` is the enforcement gate (the former `REAL_RENDER_PARTS`/`CORE_FINISH_IDS` carve-out from Phase 0.9 stays removed), and it now *also* fails on a stray angle outside the canonical set, so a retired angle cannot linger in the bundle.

**The narrowing was verified, not assumed:** re-running the rig with the new set over four parts spanning real-CAD and placeholder geometry and three slots (`bc-sc1-spun-collar`, `gvx-pendant`, `alum-pole-12`, `upsweep`) reproduced all 16 retained renders **byte-identically**, so pruning the retired angles yields exactly the state a full re-run would.

- **117 catalog parts** × **4 angles** × **13 finishes** = **6,084 WebP renders total**, **19.0 MB committed** in `public/renders/` (was 12,168 / ~36.5 MB at Phase 0.10.5; 1665 at Phase 0.9, 955 at Phase 0.8, 525 at Phase 0.5). The manifest itself halved to 1.7 MB.
- The angle set is duplicated in three places that **must move together**: `COMPASS` in `scripts/render-rig/generate.mjs`, `RENDER_ANGLE_KEYS` in `src/lib/composite.ts`, and `COMPASS` in `src/lib/composite.coverage.test.ts` (which imports the constant rather than re-listing it). `scripts/render-rig/generate.test.mjs` asserts the rig and the app agree.
- Rig camera: `pxPerMeter` 360 as of Phase 0.10.5 (was `PX_PER_M=180` through Phase 0.9 — the rig was re-baked at higher resolution alongside the coverage expansion), azimuth 35°/elevation 6°, unchanged.

Regenerate a line's layers with `npm run render-rig -- --line <WiLLstudio|NAFCO|WiLLsport>` (writes a `manifest-<slug>.json` shard) then `npm run render-manifest` (merges all shards → `public/renders/manifest.json`).

### Multi-arm + banner exposed on NAFCO & WiLLsport (Phase 0.9, Workstream A4)

Radial arm-count + banner arms, previously WiLLstudio-only, were added **additively** to the NAFCO & WiLLsport builders — WiLLstudio kept everything. This is a catalog + asset change, no viewer/compositor code change:

- `arrangements: [1,2,3,4]` added to every NAFCO & WiLLsport **pole** and to their **generic / single-arm** arms. Pre-counted NAFCO SKUs (ABH-2/3/4, SPX-2/3/4, UPX-2 — the count is baked into the product) and the tenon-adapter / direct-mount pseudo-arms are deliberately **left single** (no `arrangements`), so you can't radially multiply a "quad bracket". This mirrors WiLLstudio, where only the "No Arm — Direct Pole Mount" lacks `arrangements`.
- New banner parts `nafco-ba1-banner-arm` and `willsport-ba1-banner-arm` (cloned from `willstudio-ba1-banner-arm`).
- The az-angle position renders for those lines' radial parts + banners were baked by re-running the rig for `--line NAFCO` and `--line WiLLsport` (they predated the Phase 0.8 az logic and had hero-only shards).

## Generated-vs-source decision (Phase 0.9, Workstream C — decided 2026-08-03)

**Decision: the render WebPs (`public/renders/*.webp` + `manifest*.json`) and the spec-parse outputs (`scripts/spec-parse/`) are COMMITTED, tracked assets — not regenerated by a build/deploy step.**

Rationale: the frontend is a static site (see CLAUDE.md "Stack"). Committing the baked layers means `npm run build` → deploy needs no headless-Chrome render rig or Python spec-parser in CI; the viewer's assets ship as-is. The trade-off is repo size — **19.0 MB of WebP as of Phase 0.11** (down from ~36.5 MB at Phase 0.10.5, when the render set was 12,168 files; ~7.5 MB at Phase 0.9). Narrowing the view set halved it, so the post-0.10.5 concern about the size trajectory is relieved for now and Git LFS remains unwarranted. They remain **regenerable** — the offline rig (`scripts/render-rig/`, a devDependency using Puppeteer + three) and `scripts/spec-parse/` reproduce them deterministically — but the committed copies are the source of truth the app reads. Revisit (Git LFS or a build step) only if the render set grows meaningfully past this.

## Status

23 of 117 catalog parts are backed by real CAD (Engineering's SolidWorks STEP exports, see "Geometry sourcing" above), up from 9 at Phase 0.10; all other parts render from parametric placeholder solids until their STEP arrives (drops into the same manifest slots — the app never blocks on assets). Every part, real-CAD or placeholder, ships the full 4-angle x 13-finish render set (`public/renders/manifest.json`; 6,084 entries, 19.0 MB) - coverage does not vary by geometry source. (The 26 figure previously quoted here was stale; `scripts/render-rig/real-parts.json` maps 23 catalog parts, which is what CLAUDE.md already records. Phase 0.11 Workstream I could not raise it: Cole's 8/6 WiLLstudio STEP batch lives on Synology, which is unreachable from this machine - every STEP in the local cache was already ingested.)
