# Phase 0.5 — Image-Based Viewer Switchover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live R3F 3D viewer with a pre-rendered image-compositing viewer for every brand tab and both product types, with the old 3D scene code removed from the active render path.

**Architecture:** A one-time offline **render rig** (plain three.js page driven by Puppeteer, shared orthographic camera/lighting/scale) renders each catalog part's placeholder solid into trimmed transparent WebP layers — one per part per finish — plus a manifest recording each layer's pixel anchor and the rig's world→image linear map. At runtime a pure-TypeScript **compositing engine** (`src/lib/composite.ts`) places layers by projecting catalog socket offsets through that map; React components stack `<img>` layers (assembly) or show a single render (standalone). three.js/R3F leave the app bundle entirely; the rig tool under `scripts/render-rig/` is asset-gen tooling, standing in for Cole's SolidWorks rig until his renders drop into the same manifest slots.

**Tech Stack:** Vite + React + TS (app, unchanged), zustand (unchanged), plain three.js + Puppeteer (offline asset generation only, devDependencies).

## Global Constraints

- **Coverage (non-negotiable):** all 5 brand tabs (WiLLstudio, NAFCO, WiLLsport, WiLLev, WiLLcloud) and both product types (assembly composite, standalone single-image) go through the image pipeline; zero products on the old R3F/placeholder path; old scene code removed from the active render path (grep-verifiable: no `three`/`@react-three` imports under `src/`).
- **Viewer-only:** routing, config JSON, download tray, contact gate, status chip, CAD-download track untouched. All non-viewer tests stay green throughout.
- Missing render → labeled "Preview render coming" fallback, never a broken viewer, never the old primitive. Coverage tracked in `viewer-assets.md` (product × type × angle × finish × status).
- Feature parity: finish swap, night view (with "Conceptual — not a photometric simulation" label), human-scale overlay, zoom. No free orbit (deliberate).
- One hero angle now; the asset model keys layers by angle (`angles.hero`) so front/45°/side can be added later.
- Catalog knowledge stays in `public/catalog.json` + `public/renders/manifest.json`; components never hardcode offsets. Compositing math consumes `attachSocket`/socket data from `src/lib/compat.ts`.
- WiLL brand palette only (no blue). Sales-drive renders (`17.Renderings`) are NOT locally reachable — interim layers are rig-rendered from the photo-informed placeholder solids; document this in `viewer-assets.md`.
- Work on branch `phase-0.5` off `Dev`.

## Key numbers (from catalog.json, 2026-07-21)

- 105 parts: 77 assembly (32 pole / 31 arm / 11 fixture / 3 baseCover), 28 standalone; every part has a `placeholder` spec; `model` is null everywhere.
- 5 catalog finishes (`matte-black`, `statuary-bronze`, `forest-green`, `gloss-white`, `silver`). Only WiLLstudio assembly parts list per-part finishes; the 3D viewer painted **every** part with the selected catalog finish, so the rig renders **every part × all 5 catalog finishes** = 525 layers (finish parity for NAFCO/WiLLsport builders and standalone products).
- Builder brands: WiLLstudio (30 asm + 5 sa), NAFCO (41 asm + 9 sa), WiLLsport (6 asm + 6 sa). Showroom-only: WiLLev (7 sa), WiLLcloud (1 sa).
- All 11 fixtures have `lightOffset` (night glow anchor).

## Manifest format (`public/renders/manifest.json`)

```json
{
  "rig": {
    "version": 1,
    "pxPerMeter": 180,
    "azimuthDeg": 35,
    "elevationDeg": 6,
    "worldToImage": [[147.4, 0, -103.2], [10.8, -179.0, 7.5]],
    "pxPerMeterY": 179.0
  },
  "parts": {
    "alum-pole-20": {
      "angles": {
        "hero": {
          "finishes": {
            "matte-black": { "file": "renders/alum-pole-20--hero--matte-black.webp", "width": 96, "height": 1104, "anchor": [48, 1098] }
          }
        }
      }
    }
  }
}
```

`worldToImage` is the 2×3 linear map from a world offset in meters to a pixel offset (x right, y **down**), derived numerically from the rig camera — the app never re-derives camera math. `anchor` is the pixel inside the (alpha-trimmed) image where the part's **origin** projects. Per-brand generation writes shards `public/renders/manifest-<slug>.json`; a merge script produces the single `manifest.json` the app fetches.

---

### Task 1: Compositing core (`src/lib/composite.ts`) — TDD

**Files:**
- Create: `src/lib/composite.ts`
- Create: `src/lib/composite.test.ts`
- Branch: `git checkout -b phase-0.5`

**Interfaces:**
- Consumes: `attachSocket`, `partById` from `src/lib/compat.ts`; `Catalog`, `PoleConfig`, `CatalogPart` from `src/types.ts`.
- Produces (used by Tasks 3–6): types `RenderManifest`, `RenderAsset`, `CompositeLayout`, `PlacedLayer`; functions `projectOffset(manifest, offset): [number, number]`, `resolveRenderAsset(manifest, partId, finishId, angle?): RenderAsset | undefined`, `resolveAssemblyLayout(catalog, manifest, config): CompositeLayout`, `pointInLayout(layout, manifest, worldOffset): [number, number]`; constants `HERO_ANGLE = 'hero'`, `SLOT_Z`.

- [ ] **Step 1: Write the failing tests** — `src/lib/composite.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Catalog, PoleConfig } from '../types'
import {
  HERO_ANGLE,
  projectOffset,
  resolveRenderAsset,
  resolveAssemblyLayout,
  pointInLayout,
  type RenderManifest,
} from './composite'

/** Rig with a trivial map: x → right px, y → up (so -y px), z ignored. 100 px/m. */
const rig: RenderManifest['rig'] = {
  version: 1,
  pxPerMeter: 100,
  azimuthDeg: 0,
  elevationDeg: 0,
  worldToImage: [
    [100, 0, 0],
    [0, -100, 0],
  ],
  pxPerMeterY: 100,
}

function asset(file: string, w: number, h: number, anchor: [number, number]) {
  return { file, width: w, height: h, anchor }
}

function entry(finishes: Record<string, ReturnType<typeof asset>>) {
  return { angles: { [HERO_ANGLE]: { finishes } } }
}

const manifest: RenderManifest = {
  rig,
  parts: {
    pole: entry({ black: asset('renders/pole.webp', 20, 600, [10, 600]) }),
    base: entry({ black: asset('renders/base.webp', 60, 50, [30, 50]) }),
    arm: entry({ black: asset('renders/arm.webp', 120, 80, [10, 78]) }),
    fix: entry({ black: asset('renders/fix.webp', 90, 70, [45, 5]) }),
  },
}

const catalog: Catalog = {
  finishes: [
    // Only ids matter to the compositor
    { id: 'black', name: 'Black', hex: '#000', roughness: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1, keywords: [] },
  ],
  finishesProvisional: false,
  referenceAssemblies: [],
  parts: [
    {
      id: 'pole', slot: 'pole', name: 'Pole', family: 'P', line: 'WiLLstudio', category: 'pole',
      productClass: 'assembly-part', dropShip: false, tier: 2, mount: null,
      sockets: {
        top: { type: 'arm-mount', position: [0, 6, 0] },
        base: { type: 'base-cover', position: [0, 0, 0] },
      },
      finishes: [], keywords: [], model: null,
      placeholder: { kind: 'pole', heightM: 6, radiusTopM: 0.06, radiusBottomM: 0.1 },
      thumbnail: null, productUrl: '',
    },
    {
      id: 'base', slot: 'baseCover', name: 'Base', family: 'B', line: 'WiLLstudio', category: 'base-cover',
      productClass: 'assembly-part', dropShip: false, tier: 2, mount: 'base-cover', sockets: {},
      finishes: [], keywords: [], model: null,
      placeholder: { kind: 'baseCover', heightM: 0.5, radiusTopM: 0.1, radiusBottomM: 0.2 },
      thumbnail: null, productUrl: '',
    },
    {
      id: 'arm', slot: 'arm', name: 'Arm', family: 'A', line: 'WiLLstudio', category: 'arm',
      productClass: 'assembly-part', dropShip: false, tier: 2, mount: 'arm-mount',
      sockets: { end: { type: 'pendant', position: [1, 0.5, 0] } },
      finishes: [], keywords: [], model: null,
      placeholder: { kind: 'box', sizeM: [1, 0.5, 0.1], direction: 'up' },
      thumbnail: null, productUrl: '',
    },
    {
      id: 'fix', slot: 'fixture', name: 'Fixture', family: 'F', line: 'WiLLstudio', category: 'fixture',
      productClass: 'assembly-part', dropShip: false, tier: 2, mount: 'pendant', sockets: {},
      finishes: [], keywords: [], model: null, lightOffset: [0, -0.3, 0],
      placeholder: { kind: 'box', sizeM: [0.4, 0.3, 0.4], direction: 'down' },
      thumbnail: null, productUrl: '',
    },
  ],
}

const config: PoleConfig = {
  configId: 't', brand: 'WiLLstudio',
  pole: 'pole', baseCover: 'base', arm: 'arm', fixture: 'fix', finish: 'black', rev: 1,
}

describe('projectOffset', () => {
  it('applies the rig linear map (y down)', () => {
    expect(projectOffset(manifest, [1, 0, 0])).toEqual([100, 0])
    expect(projectOffset(manifest, [0, 2, 0])).toEqual([0, -200])
    expect(projectOffset(manifest, [0, 0, 3])).toEqual([0, 0])
  })
})

describe('resolveRenderAsset', () => {
  it('returns the finish-specific asset', () => {
    expect(resolveRenderAsset(manifest, 'pole', 'black')?.file).toBe('renders/pole.webp')
  })
  it('falls back to the first available finish, then undefined', () => {
    expect(resolveRenderAsset(manifest, 'pole', 'nope')?.file).toBe('renders/pole.webp')
    expect(resolveRenderAsset(manifest, 'missing-part', 'black')).toBeUndefined()
  })
})

describe('resolveAssemblyLayout', () => {
  const layout = resolveAssemblyLayout(catalog, manifest, config)

  it('resolves all four layers with no missing parts', () => {
    expect(layout.missing).toEqual([])
    expect(layout.layers.map((l) => l.partId)).toEqual(['pole', 'base', 'arm', 'fix'])
  })

  it('stacks in z-order pole < baseCover < arm < fixture', () => {
    const z = Object.fromEntries(layout.layers.map((l) => [l.partId, l.z]))
    expect(z.pole).toBeLessThan(z.base)
    expect(z.base).toBeLessThan(z.arm)
    expect(z.arm).toBeLessThan(z.fix)
  })

  it('places layers so each anchor sits at the projected socket offset', () => {
    // Pole at origin; arm at pole.top (0,6,0) → projected (0,-600); fixture at arm.end (1,0.5,0) beyond that.
    const pole = layout.layers.find((l) => l.partId === 'pole')!
    const arm = layout.layers.find((l) => l.partId === 'arm')!
    const fix = layout.layers.find((l) => l.partId === 'fix')!
    // Relative to the pole anchor point, the arm anchor is 600px up.
    const poleAnchor = [pole.left + 10, pole.top + 600]
    const armAnchor = [arm.left + 10, arm.top + 78]
    const fixAnchor = [fix.left + 45, fix.top + 5]
    expect(armAnchor[0] - poleAnchor[0]).toBe(0)
    expect(armAnchor[1] - poleAnchor[1]).toBe(-600)
    expect(fixAnchor[0] - armAnchor[0]).toBe(100) // +1m x
    expect(fixAnchor[1] - armAnchor[1]).toBe(-50) // +0.5m y
  })

  it('normalizes the bounding box to non-negative coords and reports origin', () => {
    expect(Math.min(...layout.layers.map((l) => l.left))).toBe(0)
    expect(Math.min(...layout.layers.map((l) => l.top))).toBe(0)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    // World origin maps back to the pole's anchor point.
    const pole = layout.layers.find((l) => l.partId === 'pole')!
    expect(layout.origin).toEqual([pole.left + 10, pole.top + 600])
  })

  it('computes the night light point from the fixture lightOffset', () => {
    // light world = arm socket (0,6,0) + fixture socket (1,0.5,0) + lightOffset (0,-0.3,0)
    const expected = pointInLayout(layout, manifest, [1, 6.2, 0])
    expect(layout.lightPx).toEqual(expected)
  })

  it('reports missing parts instead of throwing', () => {
    const sparse: RenderManifest = { rig, parts: { pole: manifest.parts.pole } }
    const l = resolveAssemblyLayout(catalog, sparse, config)
    expect(l.missing.sort()).toEqual(['arm', 'base', 'fix'])
  })

  it('handles a pole-only config', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, baseCover: '', arm: '', fixture: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId)).toEqual(['pole'])
    expect(l.lightPx).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/composite.test.ts` → FAIL ("Cannot find module './composite'").

- [ ] **Step 3: Implement `src/lib/composite.ts`:**

```ts
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { attachSocket, partById } from './compat'

/** One rendered layer/product image produced by the render rig. */
export interface RenderAsset {
  file: string
  width: number
  height: number
  /** Pixel inside the image where the part's origin projects (x right, y down). */
  anchor: [number, number]
}

export interface RenderManifest {
  rig: {
    version: number
    pxPerMeter: number
    azimuthDeg: number
    elevationDeg: number
    /** 2×3 linear map: world offset (m) → pixel offset (x right, y down). */
    worldToImage: [[number, number, number], [number, number, number]]
    /** Vertical pixels per world meter — sizes overlays (human silhouette, glows). */
    pxPerMeterY: number
  }
  parts: Record<string, { angles: Record<string, { finishes: Record<string, RenderAsset> }> }>
}

export const HERO_ANGLE = 'hero'

/** Draw order for assembly layers (base cover covers the pole root, fixture tops the arm). */
export const SLOT_Z = { pole: 1, baseCover: 2, arm: 3, fixture: 4 } as const

export interface PlacedLayer {
  partId: string
  asset: RenderAsset
  left: number
  top: number
  z: number
}

export interface CompositeLayout {
  layers: PlacedLayer[]
  width: number
  height: number
  /** Pixel position of the world origin (pole base, ground line) inside the box. */
  origin: [number, number]
  /** Part ids in the config that have no render asset (→ fallback UI). */
  missing: string[]
  /** Pixel position of the fixture's light source (night glow), when known. */
  lightPx?: [number, number]
}

/** Project a world-space offset (meters, +Y up) to a pixel offset via the rig map. */
export function projectOffset(
  manifest: RenderManifest,
  offset: [number, number, number],
): [number, number] {
  const [r0, r1] = manifest.rig.worldToImage
  return [
    r0[0] * offset[0] + r0[1] * offset[1] + r0[2] * offset[2],
    r1[0] * offset[0] + r1[1] * offset[1] + r1[2] * offset[2],
  ]
}

/** Pixel position of a world offset inside a normalized layout box. */
export function pointInLayout(
  layout: CompositeLayout,
  manifest: RenderManifest,
  offset: [number, number, number],
): [number, number] {
  const p = projectOffset(manifest, offset)
  return [layout.origin[0] + p[0], layout.origin[1] + p[1]]
}

/**
 * The render for a part in a finish: exact finish first, then any available
 * finish (covers future partial finish sets from the real render rig).
 */
export function resolveRenderAsset(
  manifest: RenderManifest,
  partId: string,
  finishId: string,
  angle: string = HERO_ANGLE,
): RenderAsset | undefined {
  const finishes = manifest.parts[partId]?.angles[angle]?.finishes
  if (!finishes) return undefined
  return finishes[finishId] ?? Object.values(finishes)[0]
}

/**
 * Compose the current config into positioned image layers. World offsets come
 * from catalog socket data (attachSocket) — the same walk Assembly.tsx did in
 * 3D — projected through the rig's linear map, so layers align by construction.
 */
export function resolveAssemblyLayout(
  catalog: Catalog,
  manifest: RenderManifest,
  config: PoleConfig,
): CompositeLayout {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  const placements: { part: CatalogPart; world: [number, number, number]; z: number }[] = []
  let lightWorld: [number, number, number] | undefined

  if (pole) {
    placements.push({ part: pole, world: [0, 0, 0], z: SLOT_Z.pole })
    if (baseCover) {
      const s = attachSocket(baseCover, pole)
      if (s) placements.push({ part: baseCover, world: s.position, z: SLOT_Z.baseCover })
    }
    if (arm) {
      const armSocket = attachSocket(arm, pole)
      if (armSocket) {
        placements.push({ part: arm, world: armSocket.position, z: SLOT_Z.arm })
        if (fixture) {
          const fixSocket = attachSocket(fixture, arm)
          if (fixSocket) {
            const world: [number, number, number] = [
              armSocket.position[0] + fixSocket.position[0],
              armSocket.position[1] + fixSocket.position[1],
              armSocket.position[2] + fixSocket.position[2],
            ]
            placements.push({ part: fixture, world, z: SLOT_Z.fixture })
            if (fixture.lightOffset) {
              lightWorld = [
                world[0] + fixture.lightOffset[0],
                world[1] + fixture.lightOffset[1],
                world[2] + fixture.lightOffset[2],
              ]
            }
          }
        }
      }
    }
  }

  const missing: string[] = []
  const raw: PlacedLayer[] = []
  for (const { part, world, z } of placements) {
    const asset = resolveRenderAsset(manifest, part.id, config.finish)
    if (!asset) {
      missing.push(part.id)
      continue
    }
    const p = projectOffset(manifest, world)
    raw.push({
      partId: part.id,
      asset,
      left: p[0] - asset.anchor[0],
      top: p[1] - asset.anchor[1],
      z,
    })
  }

  if (raw.length === 0) {
    return { layers: [], width: 0, height: 0, origin: [0, 0], missing }
  }

  const minX = Math.min(...raw.map((l) => l.left))
  const minY = Math.min(...raw.map((l) => l.top))
  const maxX = Math.max(...raw.map((l) => l.left + l.asset.width))
  const maxY = Math.max(...raw.map((l) => l.top + l.asset.height))

  const layers = raw
    .map((l) => ({ ...l, left: l.left - minX, top: l.top - minY }))
    .sort((a, b) => a.z - b.z)
  // projectOffset(0,0,0) = (0,0), so the origin lands at (-minX, -minY).
  const origin: [number, number] = [-minX, -minY]
  const layout: CompositeLayout = {
    layers,
    width: maxX - minX,
    height: maxY - minY,
    origin,
    missing,
  }
  if (lightWorld && !missing.length) layout.lightPx = pointInLayout(layout, manifest, lightWorld)
  return layout
}
```

- [ ] **Step 4: Run** `npx vitest run src/lib/composite.test.ts` → PASS. Then `npm run test` (all green) and `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/lib/composite.ts src/lib/composite.test.ts && git commit -m "feat: compositing engine core — rig projection + layer layout from catalog sockets"`

---

### Task 2: Manifest loading + composite snapshot (`src/lib/renders.ts`, `src/lib/snapshot.ts`)

**Files:**
- Create: `src/lib/renders.ts` (fetch/cache manifest, `useRenderManifest` hook, `renderUrl`)
- Create: `src/lib/snapshot.ts` (draw a `CompositeLayout` onto a canvas → PNG Blob; used for the Product Render card and `renderPng` for herocard/spec/bundle)

**Interfaces:**
- Consumes: `RenderManifest`, `CompositeLayout` from Task 1.
- Produces: `fetchRenderManifest(): Promise<RenderManifest | null>`, `useRenderManifest(): RenderManifest | null | undefined` (undefined = loading, null = unavailable), `renderUrl(file: string): string`, `compositeToBlob(layout: CompositeLayout, opts: { night: boolean; pxPerMeterY: number; showScale?: boolean }): Promise<Blob | null>`.

`src/lib/renders.ts`:

```ts
import { useEffect, useState } from 'react'
import type { RenderManifest } from './composite'

let manifestPromise: Promise<RenderManifest | null> | null = null

/** Fetch (once) the render manifest; null when unavailable → fallback UI. */
export function fetchRenderManifest(): Promise<RenderManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}renders/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RenderManifest>) : null))
      .catch(() => null)
  }
  return manifestPromise
}

/** undefined while loading, null when the manifest is unavailable. */
export function useRenderManifest(): RenderManifest | null | undefined {
  const [manifest, setManifest] = useState<RenderManifest | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void fetchRenderManifest().then((m) => {
      if (active) setManifest(m)
    })
    return () => {
      active = false
    }
  }, [])
  return manifest
}

export function renderUrl(file: string): string {
  return import.meta.env.BASE_URL + file
}
```

`src/lib/snapshot.ts` — key requirements: output ≥1920×1080 PNG; light-gray day background `#e6e7e8` / night `#111318`; night dims layers (`ctx.filter = 'brightness(0.42) saturate(0.8)'`) and draws warm radial glow + ground pool at `layout.lightPx`; optional human silhouette (capsule + head, `#8a8d92`, 85% opacity, 1.83 m × `pxPerMeterY` at world x≈1.4 m); soft ground-shadow ellipse at `layout.origin`. Images loaded via `Image` + `renderUrl`, drawn at their placed positions scaled to fit with a 6% margin. Full implementation left to the standard canvas-2D pattern; must be DOM-only (no three.js).

- [ ] Steps: implement both files; unit-test the pure parts you can (e.g. a `fitScale(layout, minW, minH)` helper if extracted) in `src/lib/snapshot.test.ts`; `npm run test && npm run lint`; commit `"feat: render manifest loader + canvas composite snapshot"`.

---

### Task 3: Render-rig asset generator (`scripts/render-rig/`)

**Files:**
- Create: `scripts/render-rig/page/index.html`, `scripts/render-rig/page/main.ts` (plain three.js rig page; NO React)
- Create: `scripts/render-rig/generate.mjs` (vite `createServer` + Puppeteer driver, `--line <ProductLine>` / `--parts id,id` filters, writes `public/renders/*.webp` + `public/renders/manifest-<slug>.json`)
- Create: `scripts/render-rig/merge-manifests.mjs` (shards → `public/renders/manifest.json`, asserts identical `rig` blocks, sorts keys)
- Modify: `package.json` (add `puppeteer` devDependency; keep `three`+`@types/three` as devDependencies; scripts `"render-rig"`, `"render-manifest"`)

**Interfaces:**
- Consumes: `public/catalog.json` (placeholder specs, finishes).
- Produces: layer files `public/renders/<partId>--hero--<finishId>.webp` and manifest shards in the exact format of the plan header; `window.renderPart(partId, finishId) → { dataUrl, width, height, anchorX, anchorY }` and `window.getRig()` in the page.

**Rig page essentials (`main.ts`):**
- `WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })`, ACESFilmic tone mapping, exposure 1.1.
- Environment: `RoomEnvironment` via `PMREMGenerator` (`three/examples/jsm/environments/RoomEnvironment.js`) + `DirectionalLight('#fff5e6', 1.2)` at (8, 12, 6) — same sun direction the old scene used, consistent shading across every part (rig consistency = layer coherence).
- Camera: `OrthographicCamera`, azimuth 35°, elevation 6°, up (0,1,0), positioned per-part at the part's Box3 center + 50 m along the view direction; frustum sized so **1 world meter = exactly `PX_PER_M = 180` canvas pixels** with ~0.3 m margin; canvas capped at 4096 px.
- Geometry: a `specToObject(spec, material)` port of `PlaceholderPart.tsx`'s switch (cylinder/tube/lathe/prism/box/cone/group with identical position/rotation rules — including the prism's `Math.PI/4` Y-rotation and box/cone direction handling). Material: `MeshPhysicalMaterial` from the catalog finish def (color/roughness/metalness/clearcoat/clearcoatRoughness/envMapIntensity, `side: DoubleSide`).
- `renderPart(partId, finishId)`: build object at origin, frame camera, render, read back via 2D canvas, find the alpha bounding box, crop with 6 px padding, compute `anchor` = projected world-origin pixel minus crop offset, return `canvas.toDataURL('image/webp', 0.92)` + metadata.
- `getRig()`: numerically derive `worldToImage` by projecting (0,0,0) and the three unit axes through the camera at the fixed scale; `pxPerMeterY = |column for (0,1,0)|`.

**generate.mjs essentials:** `createServer({ configFile: false, root: <page dir>, publicDir: <repo>/public, server: { port: 0 } })` → `page.goto` → `waitForFunction('window.rigReady')` → loop parts (filtered by `--line`/`--parts`) × all 5 catalog finish ids → `page.evaluate(renderPart)` → write webp from base64 → assemble shard manifest (sorted part keys) → write `manifest-<slug>.json` (slug from a `BRAND_SLUGS` copy: studio/nafco/sport/ev/cloud; no filter → `manifest-all.json`). Log a per-part progress line; exit non-zero if any part fails.

- [ ] Steps: `npm i -D puppeteer` → implement page + scripts → **smoke run**: `npm run render-rig -- --parts alum-pole-20,bc-fluted,sh1-shepherds-hook,gvx-pendant` → visually inspect the 20 webp files (Read tool renders images — check silhouette, transparency, crop, no clipping) → `node scripts/render-rig/merge-manifests.mjs` → verify manifest structure. Commit `"feat: offline render rig — shared ortho camera, per-part per-finish WebP layers + manifest"` (include the smoke assets).

---

### Task 4: `CompositeViewer` + `RenderFallback` (assembly viewer)

**Files:**
- Create: `src/components/CompositeViewer.tsx`
- Create: `src/components/RenderFallback.tsx`
- Modify: `src/index.css` (append `/* ---- image-compositing viewer ---- */` block)

**Interfaces:**
- Consumes: Tasks 1–2 APIs; store `registerSnapshot`, `SceneMode`.
- Produces: `<CompositeViewer catalog config showScale mode />` — drop-in replacement for `<Scene …/>` in `App.tsx`; `<RenderFallback catalog partIds label? />`.

**CompositeViewer behavior:**
- `useRenderManifest()`: `undefined` → `.composite-loading` div; `null` or `layout.missing.length > 0` or zero layers → `<RenderFallback>` (labeled "Preview render coming", lists missing part names with `photo` thumbnails when present — never a broken viewer).
- Stage: absolutely-positioned `<img>` per layer (sorted by z, `draggable={false}`, first paint eager, others lazy), inside `.composite-stage` sized `layout.width × layout.height`, centered in the viewport with `transform: translate(pan) scale(fitScale × zoom)`; `fitScale` from a `ResizeObserver` on the wrapper (fit 80% width / 86% height).
- **Zoom:** wheel (clamped 0.5–4, exponential steps) + `+ / − / ⤢ reset` buttons (`.composite-zoom`, bottom-right); **pan** by pointer-drag when zoomed. Zoom/pan reset when the physical assembly key (`pole-arm-fixture-baseCover`) changes.
- **Ground shadow:** soft radial-gradient ellipse (~2.6 m × 0.6 m via `pxPerMeterY`) centered at `layout.origin`.
- **Night:** viewport gets `.night` (background `#111318`); layer imgs get `filter: brightness(0.42) saturate(0.8)`; at `layout.lightPx` draw an emissive dot + warm radial glow (`rgba(255,217,160,…)`, ~0.9 m radius) and a wide ground pool ellipse at the light's ground projection (`pointInLayout(layout, manifest, [lightWorld.x, 0, lightWorld.z])` — pass the light's world offset through layout via `lightPx` + a `poolPx` computed the same way in `resolveAssemblyLayout` if convenient; otherwise compute in the component from catalog data). The existing "Conceptual night preview" disclaimer in App.tsx stays.
- **Human scale:** inline SVG silhouette (head circle + capsule body, `#8a8d92`, opacity .85), height `1.83 × pxPerMeterY` px, foot at `pointInLayout(layout, manifest, [1.4, 0, 0.6])`.
- **Snapshot:** `useEffect` registers `() => compositeToBlob(layout, { night, pxPerMeterY, showScale })` via `registerSnapshot`; unregister on unmount. OutputTray then keeps working unchanged.

- [ ] Steps: implement both components + CSS; temporarily preview by swapping `<Scene>`→`<CompositeViewer>` locally with `npm run dev` and the Task 3 smoke assets (GVX + SH1 + 20 ft pole + fluted base renders exist) — verify alignment, zoom, night, scale toggle; revert nothing (leave the swap for Task 6 if it's already clean, else stash); `npm run test && npm run lint`; commit `"feat: CompositeViewer — layered image assembly viewer with zoom/night/scale/fallback"`.

---

### Task 5: Standalone single-image path (`ProductViewer.tsx` rework)

**Files:**
- Modify: `src/components/ProductViewer.tsx` — delete `SinglePartCanvas` + `specHeight` + all three/R3F/drei imports; add `StandaloneRender` (single `<img>` from `resolveRenderAsset(manifest, part.id, selectedFinish)`, wheel/buttons zoom, same id-card + photo link overlays; registers a single-image snapshot so the PNG card still works)
- Modify: `src/components/PhotoCard.tsx` — optional `renderComing?: boolean` prop → a "Preview render coming" chip next to the category chip (the labeled fallback)

**Behavior:**
- `useRenderManifest()`; loading → placeholder div; no asset → `<PhotoCard part renderComing />` (+ OutputTray with `showPngCard={false}`).
- Finish chips: keep the existing `FinishChips` component but gate on **available render variants**: show when the part's manifest entry has >1 finishes (all rig-rendered parts have 5 → chips now appear for every standalone product, satisfying DoD finish parity; parts falling back to PhotoCard show none).
- Default selected finish: `part.finishes[0] ?? catalog.finishes[0].id`.
- `showPngCard={Boolean(asset)}`; the synthetic standalone config & OutputTray `formats={['pdf']}` stay exactly as-is.

- [ ] Steps: implement; `npm run dev` → open `/studio/product/<a standalone id>` and a NAFCO product; verify render/chips/fallback; `npm run test && npm run lint`; commit `"feat: standalone products render through the image pipeline"`.

---

### Task 6: Flip the app — remove the R3F path

**Files:**
- Modify: `src/App.tsx` — `import { CompositeViewer }` replaces `Scene`; `<CompositeViewer catalog config showScale mode />` in the builder viewport; night disclaimer + viewport-controls unchanged.
- Delete: `src/components/Scene.tsx`, `src/components/Assembly.tsx`, `src/components/PlaceholderPart.tsx`, `src/components/SnapshotRig.tsx`, `src/three-elements.d.ts`
- Delete: `public/hdri/` (only the old scene consumed the HDRIs)
- Modify: `package.json` — remove `@react-three/drei`, `@react-three/fiber`, `@react-three/postprocessing` entirely; move `three` + keep `@types/three` in devDependencies (rig tool only); `npm install` to sync the lockfile.
- Modify: `src/components/OutputTray.tsx` — minimal seam: drop `grabRawCanvas` (snapshot fn now always registered by the mounted viewer; `const blob = snapshot ? await snapshot() : null`), copy tweak `'PNG · current 3D view'` → `'PNG · current view'`. Nothing else in the tray changes.

- [ ] Steps: make the edits → `grep -rn "three\|@react-three" src/` must return **nothing** → `npm run build` (tsc + vite) passes → `npm run test` green → `npm run dev`: WiLLstudio builder composites (smoke assets), other brands show labeled fallbacks (until Task 7) → commit `"feat!: switch every viewer to image compositing; remove R3F scene from the app"`.

---

### Task 7: Per-brand asset wiring — 5 parallel subagents

Independent per brand (disjoint output files). Each agent, for its brand `<Line>/<slug>` (WiLLstudio/studio, NAFCO/nafco, WiLLsport/sport, WiLLev/ev, WiLLcloud/cloud):

- [ ] Run `npm run render-rig -- --line <Line>` (writes `public/renders/<partId>--hero--<finish>.webp` + `public/renders/manifest-<slug>.json`).
- [ ] Verify: every part of the line has a manifest entry with **all 5 finishes**; visually inspect a sample of the WebPs (each slot type for builder brands; every standalone) for silhouette sanity, transparent background, no clipping, anchor plausibility.
- [ ] Report back: parts rendered, finishes per part, file count/size, any failures or visually broken renders (with part ids).

Agents do **not** touch `manifest.json`, `viewer-assets.md`, or any `src/` file (no shared-file contention).

---

### Task 8: Integration — merge, coverage proof, `viewer-assets.md`

**Files:**
- Create: `scripts/build-viewer-assets.mjs` — reads `public/catalog.json` + `public/renders/manifest.json` → writes repo-root `viewer-assets.md`: header (interim rig assets from placeholder solids; Sales-drive renders not locally reachable; Cole's rig renders replace files in place), then per-brand tables `| product | type | angle | finishes | status |` (status `rendered (interim rig)` / `fallback (photo card)`), plus totals.
- Create: `src/lib/composite.coverage.test.ts` — reads the **real** `public/catalog.json` + `public/renders/manifest.json` via `node:fs`; asserts (a) every catalog part has a hero entry with all 5 finishes; (b) for each builder brand, every valid combo (fixtures × compatibleParts walk from `compat.ts`) × 5 finishes resolves via `resolveAssemblyLayout` with `missing.length === 0` and finite positive box; (c) every standalone part resolves via `resolveRenderAsset`.
- Run: `npm run render-manifest` (merge shards), `node scripts/build-viewer-assets.mjs`.

- [ ] Steps: merge → coverage test green → full `npm run test`, `npm run lint`, `npm run build` → commit `"feat: full-catalog render coverage — manifest merge, coverage test, viewer-assets.md"`.

---

### Task 9: DoD verification + docs

- [ ] **Grep proof:** `grep -rn "three\|@react-three\|PlaceholderPart\|<Canvas" src/` → empty; deleted files gone.
- [ ] **Click-through (Chrome):** all five brand tabs; WiLLstudio + NAFCO + WiLLsport builders composite correctly across several combos (alignment eyeball); WiLLev + WiLLcloud showrooms; standalone product pages; finish swap instant on both types; night view + disclaimer; human scale; zoom; share-URL reload; Product Render PNG download (snapshot); screenshot evidence.
- [ ] **Performance sanity:** production `npm run build && npm run preview` — initial composite ≤2 s broadband-equivalent (bundle no longer ships three.js; layers lazy); finish swap instant (all 5 finish layer sets are small — optionally prefetch sibling finishes on idle).
- [ ] **Docs:** update `CLAUDE.md` (status 0.5, code map: composite.ts/renders.ts/snapshot.ts/CompositeViewer/RenderFallback, render-rig commands, removed 3D scene section → compositing rules), memory notes. Final commit.

## Self-Review notes

- Spec coverage: coverage requirement → Tasks 6–8; architecture → 1–3; parity (finish/night/scale/zoom) → 4–5; assets/manifest/fallback → 3, 5, 8; out-of-scope respected (no CAD-track changes); execution note (engine first, per-brand subagents) → task order.
- DoD 8 (realism eyeball): interim rig renders are placeholder-solid based — the pipeline is switched and coverage proven; the realism ceiling lifts fully when Cole's renders drop into the same manifest slots. Flag this honestly in the final report and `viewer-assets.md`.
- Type consistency: `RenderManifest`/`RenderAsset`/`CompositeLayout`/`resolveAssemblyLayout`/`resolveRenderAsset`/`pointInLayout`/`HERO_ANGLE` used identically across Tasks 1–5 and 8.
