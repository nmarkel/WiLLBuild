# Phase 0.3 Plan 01 — Workstream H: Scene & Assembly Fixes (H1–H5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 0.2 defects: night mode gets an environment + real fixture light pool + conceptual label (H1), no stray shadows (H2), clean upsweep arm + mount-type rules so post-tops can't take arms (H3), camera fits the assembly (H4), context-neutral HDRI + restored contact shadow (H5).

**Architecture:** All rules changes are catalog-data changes (`public/catalog.json`); `src/lib/compat.ts` logic is already socket-driven and mostly stays untouched. Scene changes live in `src/components/Scene.tsx` / `Assembly.tsx` / `App.tsx`.

**Tech Stack:** React Three Fiber, drei, three.js, vitest. Verify visually with the claude-in-chrome `verify` flow at `localhost:5173` (day + night screenshots).

Global constraints: see `2026-07-09-phase03-00-master.md`.

---

### Task 1: H3b — Mount-type rules: post-top fixtures can't take arms (catalog data + tests)

**Files:**
- Modify: `public/catalog.json` (upsweep part, direct-mount part)
- Test: `src/lib/compat.test.ts`

**Interfaces:**
- Consumes: existing `compatibleParts(catalog, config, slot)` from `src/lib/compat.ts` — unchanged.
- Produces: catalog where the only arm hosting `tenon-2-3/8` is `direct-mount`.

The bug: `upsweep` exposes **two sockets at the same position** — `top: tenon-2-3/8` and `side: arm-mount` — so DRX/TEX (post-tops) mount on the upsweep, inverted. Per spec: post-top → direct tenon only; coach → arm-mount; pendant → pendant arms.

- [ ] **Step 1: Write failing tests** in `src/lib/compat.test.ts` (load the real catalog JSON the way existing tests do):

```ts
describe('mount-type rules (H3b)', () => {
  it('post-top fixtures only get the direct mount in the arm step', () => {
    const cfg = { ...base, fixture: 'drx-post-top' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['direct-mount'])
  })
  it('coach fixtures only get the upsweep', () => {
    const cfg = { ...base, fixture: 'mvx-coach' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['upsweep'])
  })
  it('pendants only get pendant arms', () => {
    const cfg = { ...base, fixture: 'gvx-pendant' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['sh1-shepherds-hook', 'pa1-pendant-arm', 'pm1-pendant-arm'])
  })
  it('repairConfig moves a post-top off an arm onto the direct mount', () => {
    const cfg = { ...base, fixture: 'drx-post-top', arm: 'upsweep' }
    expect(repairConfig(catalog, cfg).arm).toBe('direct-mount')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/lib/compat.test.ts` — expect the new tests FAIL (upsweep leaks into post-top arms).
- [ ] **Step 3:** Edit `public/catalog.json`: in the `upsweep` part, delete the `"top"` socket entirely, keep only `"side": {"type": "arm-mount", ...}`. In `direct-mount`, rename `"name"` to `"No Arm — Direct Pole Mount"` (spec asks for an explicit "No arm / direct mount" option) and add `"no arm"` to its keywords if missing.
- [ ] **Step 4:** `npx vitest run` — all pass (fix any existing test that asserted the old upsweep sockets).
- [ ] **Step 5:** Commit: `git add -A && git commit -m "H3b: mount-type filtering via socket data — post-tops direct-mount only"`

### Task 2: H3a — Upsweep geometry + fixture orientation at the tip

**Files:**
- Modify: `public/catalog.json` (`upsweep` placeholder + side socket position)

**Interfaces:**
- Consumes: `PlaceholderSpec kind:'tube'` (CatmullRom through points) in `PlaceholderPart.tsx`; `Assembly.tsx` positions fixture group at the arm's socket.
- Produces: upsweep that leaves the pole horizontally, sweeps up ~35°, ends with a vertical tangent; socket at the exact tube end.

The malformed S-hook comes from too-few CatmullRom control points (the spline overshoots) and the socket floating 0.02 m off the tube end.

- [ ] **Step 1:** Replace the upsweep `placeholder.points` with a denser sweep ending vertical, and align the socket to the final point:

```json
"placeholder": { "kind": "tube", "radiusM": 0.03, "points": [
  [0, 0, 0], [0.14, 0.015, 0], [0.28, 0.06, 0], [0.40, 0.14, 0],
  [0.47, 0.25, 0], [0.50, 0.36, 0], [0.50, 0.44, 0] ] },
"sockets": { "side": { "type": "arm-mount", "position": [0.50, 0.44, 0] } }
```

- [ ] **Step 2:** Run `npm run dev`, select MVX Coach (auto-selects upsweep). Screenshot via the verify flow: the arm must exit the pole cleanly, no kinks/loops; the MVX lantern must sit upright on the arm tip. Adjust points if the spline still wobbles (more intermediate points, keep the last two collinear-vertical).
- [ ] **Step 3:** `npm run test && npm run lint && npm run build`.
- [ ] **Step 4:** Commit: `git commit -am "H3a: rebuild upsweep sweep + socket at tube tip"`

### Task 3: H2 — Per-mode light rig audit (no stray shadows)

**Files:**
- Modify: `src/components/Scene.tsx`, `src/components/Assembly.tsx`

**Interfaces:**
- Produces: day = HDRI + shadow-casting sun; night = fixture spot (casts the only shadow) + faint moon/ambient (no shadow).

- [ ] **Step 1:** In `Scene.tsx`, the `directionalLight` keeps `castShadow` only in day mode: `castShadow={!night}`. Night keeps its faint `#9db4d6` moon fill at 0.15 intensity but casts nothing.
- [ ] **Step 2:** In `Assembly.tsx` `FixtureLight`, set `castShadow` on the `spotLight` with `shadow-mapSize={[1024,1024]}` and `shadow-bias={-0.0005}` so the pole/arm silhouette on the ground comes **from the fixture**, matching the glow direction.
- [ ] **Step 3:** Verify at night in the browser: exactly one shadow family, radiating away from the fixture head. Day unchanged.
- [ ] **Step 4:** Commit: `git commit -am "H2: night shadows come from the fixture, sun casts only by day"`

### Task 4: H1 — Night mode environment + light pool + conceptual label

**Files:**
- Modify: `src/components/Scene.tsx`, `src/App.tsx`, `src/index.css`
- Add: `public/hdri/<night>.hdr` (see Task 6 — download both HDRIs in one go there if easier; keep commits separate by concern)

**Interfaces:**
- Consumes: `mode: SceneMode` from the store (exists), `FixtureLight` (exists, Task 3 made it shadow-casting).
- Produces: night keeps a visible environment; warm CCT pool on the ground; overlay label.

- [ ] **Step 1:** Download a ground-level **night** HDRI from Poly Haven (CC0), 2k `.hdr`, into `public/hdri/`. Candidates in order: `moonless_golf_2k.hdr`, `satara_night_2k.hdr`, `preller_drive_2k.hdr` — `curl -fL -o public/hdri/moonless_golf_2k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/moonless_golf_2k.hdr"`. Pick the first that downloads and looks like plausible dark outdoor ground when projected.
- [ ] **Step 2:** In `Scene.tsx`, night no longer drops the ground projection. Use the night file with ground projection ON and modest intensity:

```tsx
<Environment
  files={import.meta.env.BASE_URL + (night ? 'hdri/moonless_golf_2k.hdr' : 'hdri/<day file, Task 6>')}
  background
  ground={{ height: 5, radius: 40, scale: 70 }}
  environmentIntensity={night ? 0.25 : 1}
  backgroundIntensity={night ? 0.5 : 1}
/>
```

Keep the lit ground disc (projected skybox is unlit — it can't catch the pool) but drop its opacity into a blend: `color '#17181c'`, and verify the fixture's spot pools warmly on it. Raise `FixtureLight` spot `intensity` if the pool reads weak against the HDRI ground (try 150 → 250).
- [ ] **Step 3:** In `App.tsx`, add a persistent overlay while `mode === 'night'` inside `.viewport`:

```tsx
{mode === 'night' && (
  <div className="night-disclaimer">Conceptual night preview — not a photometric simulation</div>
)}
```

Style in `index.css`: absolute, bottom-left, gunmetal `#42413D` text on translucent silver `rgba(230,231,232,.85)`, 12px Roboto, 6px radius, pointer-events none. **No blue.**
- [ ] **Step 4:** Verify in browser (night): environment visible (not a void), warm pool under the fixture, label present, emissive lens still blooms. Screenshot day + night.
- [ ] **Step 5:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "H1: night environment + fixture light pool + conceptual label"`

### Task 5: H4 — Camera fits the assembly on load and on config change; zoom works

**Files:**
- Modify: `src/components/Scene.tsx` (`CameraRig`)

**Interfaces:**
- Consumes: nothing new — compute the assembly's real bounding box from the scene graph instead of guessing from pole height.
- Produces: `CameraRig` that frames pole + arm + fixture with margin, re-fits on any config change, sensible zoom limits.

- [ ] **Step 1:** Replace the height heuristic with a measured fit. Give the `<Assembly>` group a ref (lift it: render `<group ref={assemblyRef}>` around `<Assembly/>` in `Scene.tsx`), then in `CameraRig`:

```tsx
function CameraRig({ configKey, assemblyRef }: { configKey: string; assemblyRef: RefObject<THREE.Group | null> }) {
  // ...existing autorotate state...
  useEffect(() => {
    const c = controls.current, g = assemblyRef.current
    if (!c || !g) return
    const id = requestAnimationFrame(() => {           // wait one frame so new parts are mounted
      const box = new THREE.Box3().setFromObject(g)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      c.target.set(0, center.y, 0)
      const fitDist = (Math.max(size.y, size.x * 1.4) / 2) / Math.tan((42 * Math.PI) / 360) * 1.25
      const dir = camera.position.clone().sub(c.target)
      if (dir.lengthSq() < 0.01) dir.set(1, 0.2, 1)
      dir.setLength(fitDist)
      camera.position.copy(c.target).add(dir)
      c.minDistance = size.y * 0.35
      c.maxDistance = size.y * 4
      c.update()
    })
    return () => cancelAnimationFrame(id)
  }, [configKey, camera, assemblyRef])
```

`configKey` = the existing `shadowKey` string (pole/arm/fixture/baseCover) minus finish/mode — pass from `Scene`.
- [ ] **Step 2:** Investigate "scroll-zoom appears disabled": with the pointer over the canvas, wheel must dolly. If page scroll swallows it, ensure the canvas container has `touch-action: none` and nothing sets `enableZoom={false}` (it doesn't today — likely the old `minDistance={heightM*0.5}` felt like a lock at default framing; the new limits fix that). Confirm by testing.
- [ ] **Step 3:** Verify in browser: on load the whole assembly (incl. fixture head) is in frame; switch 12 ft ↔ 20 ft pole and DRX ↔ GVX — refits each time; wheel zooms in/out between limits.
- [ ] **Step 4:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "H4: camera fits measured assembly bounds; zoom limits from real size"`

### Task 6: H5 — Context-neutral day HDRI + contact-shadow restore

**Files:**
- Modify: `src/components/Scene.tsx`
- Add: `public/hdri/<day>.hdr`; Delete: `public/hdri/urban_street_04_2k.hdr` (after swap verified)

- [ ] **Step 1:** Download a US-plausible / context-neutral ground-level day HDRI (CC0, 2k). Candidates in order: `abandoned_parking_2k.hdr` (overcast parking lot — context-neutral paved), `outdoor_workshop_2k.hdr`, `goegap_road_2k.hdr`. Same `dl.polyhaven.org` URL pattern as Task 4. The pole must plant on clear pavement — tune `Environment ground={{height, radius, scale}}` so no signage/vehicles crowd the subject.
- [ ] **Step 2:** Swap the day `files=` path (Task 4's snippet already parameterized it). Delete the old UK street HDRI.
- [ ] **Step 3:** Contact shadow restore: `ContactShadows` already re-keys on config; verify it's visible from all orbit angles in day mode. If it vanishes at grazing angles, raise `opacity` to 0.6 and `far` to 4.5, and confirm the shadow-catcher plane (`shadowMaterial`) still receives the sun shadow with the new HDRI's sun direction — adjust `SUN_POSITION` to roughly match the new HDRI's visible sun/brightest region so cast shadow and sky agree.
- [ ] **Step 4:** Verify in browser day + night, orbit fully around. Screenshot.
- [ ] **Step 5:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "H5: context-neutral day HDRI, contact shadow restored"`

### Task 7: Full H acceptance pass (DoD 11)

- [ ] **Step 1:** Browser pass against DoD 11 checklist: night = environment + warm pool + label; one consistent shadow family per mode; upsweep clean with MVX upright at tip; DRX/TEX arm step shows only "No Arm — Direct Pole Mount"; camera fits on load + after every config change.
- [ ] **Step 2:** `npm run test && npm run lint && npm run build` all green. Fix anything found; commit fixes as `H: acceptance pass fixes`.
