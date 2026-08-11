import { describe, expect, it } from 'vitest'
import type { Catalog, PoleConfig } from '../types'
import {
  ASSEMBLY_VIEW_YAWS,
  HERO_ANGLE,
  RENDER_ANGLE_KEYS,
  RENDER_AZIMUTHS,
  angleKeyForAzimuth,
  armDepthProxy,
  availableFocusTargets,
  focusBox,
  projectOffset,
  resolveRenderAsset,
  resolveAssemblyLayout,
  rotateY,
  pointInLayout,
  snapAssemblyYaw,
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
    { id: 'black', name: 'Black', code: 'BK', typeCode: 'FP', hex: '#000', roughness: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1, keywords: [] },
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

  it('armCount=1 is identical to omitting armCount (no regression)', () => {
    const withCount = resolveAssemblyLayout(catalog, manifest, { ...config, armCount: 1 })
    const without = resolveAssemblyLayout(catalog, manifest, config)
    expect(withCount).toEqual(without)
  })
})

// ---- Phase 0.8 (A): radial multi-arm helpers + fan-out ----

describe('angleKeyForAzimuth', () => {
  it('maps 0°/360° to the hero angle and others to az<deg> keys', () => {
    expect(angleKeyForAzimuth(0)).toBe(HERO_ANGLE)
    expect(angleKeyForAzimuth(360)).toBe(HERO_ANGLE)
    expect(angleKeyForAzimuth(180)).toBe('az180')
    expect(angleKeyForAzimuth(90)).toBe('az90')
    expect(angleKeyForAzimuth(-90)).toBe('az270')
  })
})

describe('rotateY', () => {
  it('rotates a reach offset about the vertical axis (matches the rig)', () => {
    const [x, y, z] = rotateY([1, 0.5, 0], 180)
    expect(x).toBeCloseTo(-1, 6)
    expect(y).toBe(0.5)
    expect(z).toBeCloseTo(0, 6)
    // 90° swings +X reach onto the -Z axis (three.js Y-rotation convention).
    const q = rotateY([1, 0, 0], 90)
    expect(q[0]).toBeCloseTo(0, 6)
    expect(q[2]).toBeCloseTo(-1, 6)
  })
})

describe('armDepthProxy', () => {
  const rig35 = { ...rig, azimuthDeg: 35 }
  it('is positive for arms reaching toward the camera, negative for away', () => {
    expect(armDepthProxy(rig35, 0)).toBeGreaterThan(0) // front (single-arm ref)
    expect(armDepthProxy(rig35, 180)).toBeLessThan(0) // twin partner behind
    expect(armDepthProxy(rig35, 90)).toBeLessThan(0)
    expect(armDepthProxy(rig35, 270)).toBeGreaterThan(0)
  })
})

describe('resolveAssemblyLayout — multi-arm', () => {
  // Add az180 renders for the arm + fixture so a twin composites with 0 missing.
  const armAz = asset('renders/arm-az180.webp', 120, 80, [110, 78])
  const fixAz = asset('renders/fix-az180.webp', 90, 70, [45, 5])
  const twinManifest: RenderManifest = {
    rig: { ...rig, azimuthDeg: 35 },
    parts: {
      pole: manifest.parts.pole,
      base: manifest.parts.base,
      arm: { angles: { [HERO_ANGLE]: { finishes: { black: asset('renders/arm.webp', 120, 80, [10, 78]) } }, az180: { finishes: { black: armAz } } } },
      fix: { angles: { [HERO_ANGLE]: { finishes: { black: asset('renders/fix.webp', 90, 70, [45, 5]) } }, az180: { finishes: { black: fixAz } } } },
    },
  }
  const twin: PoleConfig = { ...config, armCount: 2 }

  it('emits one arm + one fixture layer per radial position, with unique ids', () => {
    const layout = resolveAssemblyLayout(catalog, twinManifest, twin)
    expect(layout.missing).toEqual([])
    const ids = layout.layers.map((l) => l.partId).sort()
    expect(ids).toEqual(['arm#0', 'arm#1', 'base', 'fix#0', 'fix#1', 'pole'])
  })

  it('draws the away-facing arm behind the pole and the toward-facing arm in front', () => {
    const layout = resolveAssemblyLayout(catalog, twinManifest, twin)
    const z = Object.fromEntries(layout.layers.map((l) => [l.partId, l.z]))
    // arm#0 = 0° (toward camera → in front), arm#1 = 180° (away → behind).
    expect(z['arm#1']).toBeLessThan(z['pole'])
    expect(z['arm#0']).toBeGreaterThan(z['pole'])
    // Each fixture rides just above its own arm.
    expect(z['fix#0']).toBeGreaterThan(z['arm#0'])
    expect(z['fix#1']).toBeGreaterThan(z['arm#1'])
  })

  it('selects the per-azimuth render (az180 for the twin partner)', () => {
    const layout = resolveAssemblyLayout(catalog, twinManifest, twin)
    const arm1 = layout.layers.find((l) => l.partId === 'arm#1')!
    expect(arm1.asset.file).toBe('renders/arm-az180.webp')
  })

  it('emits one night light per fixture (both twin arms light up)', () => {
    const layout = resolveAssemblyLayout(catalog, twinManifest, twin)
    expect(layout.lightPxs).toHaveLength(2)
    // The two lights sit on opposite sides of the pole (mirrored x about origin).
    const [a, b] = layout.lightPxs!
    expect(Math.sign(a[0] - layout.origin[0])).toBe(-Math.sign(b[0] - layout.origin[0]))
    // Back-compat: lightPx is the primary (first) light.
    expect(layout.lightPx).toEqual(layout.lightPxs![0])
  })

  it('falls back to the nearest available angle when a radial azimuth render is missing', () => {
    // Phase 0.10.5: a hero-only manifest (no az180) no longer breaks the twin —
    // the partner resolves the nearest angle (hero). Missing is reserved for
    // parts with no renders at all.
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    expect(layout.missing).toEqual([])
    expect(layout.layers.filter((l) => l.partId.startsWith('arm'))).toHaveLength(2)
  })
})

describe('view rotation + nearest-angle fallback (Phase 0.10.5)', () => {
  it('nearest angle falls back to hero when the requested azimuth is missing', () => {
    // Synthetic parts carry hero only — a rotated view must not report missing.
    const layout = resolveAssemblyLayout(catalog, manifest, config, 90)
    expect(layout.missing).toEqual([])
    expect(layout.layers.map((l) => l.partId)).toEqual(['pole', 'base', 'arm', 'fix'])
  })

  it('a full-circle rotation is identical to no rotation', () => {
    const a = resolveAssemblyLayout(catalog, manifest, config, 0)
    const b = resolveAssemblyLayout(catalog, manifest, config, 360)
    expect(b).toEqual(a)
  })
})

/**
 * Phase 0.11 (Workstream E) — component focus regions.
 *
 * The focus views are a FRAMING over the composited layers rather than a new
 * set of rendered assets (the rig alpha-crops each part individually at a
 * fixed pxPerMeter, so a "tighter framing" of one part is the same image).
 * What has to be right is which pixels belong to which component.
 */
describe('focusBox (Phase 0.11 E)', () => {
  const layout = resolveAssemblyLayout(catalog, manifest, config)

  it('the assembly focus is the whole box', () => {
    expect(focusBox(layout, 'assembly')).toEqual({
      left: 0,
      top: 0,
      width: layout.width,
      height: layout.height,
    })
  })

  it('a component focus is tighter than the whole assembly', () => {
    const whole = focusBox(layout, 'assembly')!
    const fixture = focusBox(layout, 'fixture')!
    expect(fixture.height).toBeLessThan(whole.height)
    expect(fixture.width).toBeLessThanOrEqual(whole.width)
  })

  it('the focus contains every layer of that component', () => {
    for (const target of ['fixture', 'arm', 'baseCover'] as const) {
      const box = focusBox(layout, target)!
      for (const layer of layout.layers.filter((l) => l.slot === target)) {
        expect(layer.left).toBeGreaterThanOrEqual(box.left)
        expect(layer.top).toBeGreaterThanOrEqual(box.top)
        expect(layer.left + layer.asset.width).toBeLessThanOrEqual(box.left + box.width)
        expect(layer.top + layer.asset.height).toBeLessThanOrEqual(box.top + box.height)
      }
    }
  })

  it('never frames outside the assembly box', () => {
    for (const target of ['assembly', 'fixture', 'arm', 'baseCover'] as const) {
      const box = focusBox(layout, target)!
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.left + box.width).toBeLessThanOrEqual(layout.width + 1e-9)
      expect(box.top + box.height).toBeLessThanOrEqual(layout.height + 1e-9)
    }
  })

  it('a component the config does not have has no focus', () => {
    // A pole-only config: no arm, no fixture, no base cover to frame.
    const poleOnly = resolveAssemblyLayout(catalog, manifest, {
      ...config,
      arm: '',
      fixture: '',
      baseCover: '',
    })
    expect(focusBox(poleOnly, 'arm')).toBeUndefined()
    expect(focusBox(poleOnly, 'fixture')).toBeUndefined()
    expect(availableFocusTargets(poleOnly)).toEqual(['assembly'])
  })

  it('offers every present component, in canonical order', () => {
    expect(availableFocusTargets(layout)).toEqual(['assembly', 'fixture', 'arm', 'baseCover'])
  })

  it('an empty layout offers nothing', () => {
    const empty = { layers: [], width: 0, height: 0, origin: [0, 0] as [number, number], missing: [] }
    expect(focusBox(empty, 'assembly')).toBeUndefined()
    expect(availableFocusTargets(empty)).toEqual([])
  })
})

describe('the canonical view set (Phase 0.11 E)', () => {
  it('snaps any yaw to one of the two full-assembly views', () => {
    expect(snapAssemblyYaw(0)).toBe(0)
    expect(snapAssemblyYaw(44)).toBe(0)
    expect(snapAssemblyYaw(90)).toBe(180)
    expect(snapAssemblyYaw(180)).toBe(180)
    expect(snapAssemblyYaw(269)).toBe(180)
    expect(snapAssemblyYaw(270)).toBe(0)
    expect(snapAssemblyYaw(-90)).toBe(0)
    expect(snapAssemblyYaw(360)).toBe(0)
    expect(snapAssemblyYaw(540)).toBe(180)
  })

  it('the render angle keys match the render azimuths', () => {
    expect(RENDER_ANGLE_KEYS.map((k) => (k === HERO_ANGLE ? 0 : Number(k.slice(2))))).toEqual([
      ...RENDER_AZIMUTHS,
    ])
  })

  it('every view yaw is itself a render azimuth', () => {
    // The pole is drawn at (0 − viewYaw), so each view must be renderable.
    for (const yaw of ASSEMBLY_VIEW_YAWS) {
      expect(RENDER_AZIMUTHS).toContain(((360 - yaw) % 360) as (typeof RENDER_AZIMUTHS)[number])
    }
  })
})
