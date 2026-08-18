import { describe, expect, it } from 'vitest'
import type { Catalog, PoleConfig } from '../types'
import {
  ASSEMBLY_VIEW_YAWS,
  ASSEMBLY_VIEWS,
  FOCUS_TARGETS,
  HERO_ANGLE,
  RENDER_ANGLE_KEYS,
  RENDER_AZIMUTHS,
  angleKeyForAzimuth,
  armDepthProxy,
  offsetDepthProxy,
  availableFocusTargets,
  availableViews,
  currentViewIndex,
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

// ---- Phase 0.14 (Tyler 8/14): partial builds render from the FIRST pick ----
describe('resolveAssemblyLayout — partial builds', () => {
  it('a lone fixture renders as a component preview (no light data)', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, pole: '', baseCover: '', arm: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId)).toEqual(['fix'])
    // No pole → no ground → no night pool/glow points.
    expect(l.lightPx).toBeUndefined()
  })

  it('fixture + arm without a pole compose via the same socket walk, anchored at origin', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, pole: '', baseCover: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId).sort()).toEqual(['arm', 'fix'])
    // The fixture still hangs at the arm's pendant socket (1, 0.5) relative to
    // the arm mount — identical geometry to the full assembly, just unmoored.
    const arm = l.layers.find((x) => x.partId === 'arm')!
    const fix = l.layers.find((x) => x.partId === 'fix')!
    const armAnchor = [arm.left + 10, arm.top + 78]
    const fixAnchor = [fix.left + 45, fix.top + 5]
    expect(fixAnchor[0] - armAnchor[0]).toBe(100)
    expect(fixAnchor[1] - armAnchor[1]).toBe(-50)
  })

  it('a lone arm renders', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, pole: '', baseCover: '', fixture: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId)).toEqual(['arm'])
  })

  it('a lone base cover renders', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, pole: '', arm: '', fixture: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId)).toEqual(['base'])
  })

  it('fixture + pole with no bracket hovers the fixture above the pole top, awaiting its bracket', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, baseCover: '', arm: '' })
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId).sort()).toEqual(['fix', 'pole'])
    // Fixture anchor sits ABOVE the pole top socket (0,6,0): clearance =
    // hangM (unset here → 0) + 0.15 m → 15 px up in the test rig.
    const pole = l.layers.find((x) => x.partId === 'pole')!
    const fix = l.layers.find((x) => x.partId === 'fix')!
    const poleTopY = pole.top + 600 - 600 // pole anchor is its base; top socket 6m up → anchor px - 600
    const fixAnchorY = fix.top + 5
    expect(fixAnchorY).toBe(poleTopY - 15)
    // It never claims a mount: no light data either (no arm walk ran)…
    expect(l.lightPx).toBeUndefined()
  })

  it('a base cover alongside other parts (no pole) waits for its pole instead of overlapping', () => {
    const l = resolveAssemblyLayout(catalog, manifest, { ...config, pole: '' })
    expect(l.layers.map((x) => x.partId).sort()).toEqual(['arm', 'fix'])
  })

  it('the full assembly is byte-identical to before (partial paths change nothing when complete)', () => {
    const l = resolveAssemblyLayout(catalog, manifest, config)
    expect(l.missing).toEqual([])
    expect(l.layers.map((x) => x.partId)).toEqual(['pole', 'base', 'arm', 'fix'])
    expect(l.lightPx).toBeDefined()
  })
})

// ---- Phase 0.14 (Tyler 8/14): placed shaft accessories render layers ----
describe('resolveAssemblyLayout — placed accessories (renderPartId)', () => {
  // A pole whose options carry a placeable accessory pointing at a render-only
  // accessory part — the shape apply-spec-option-corrections.mjs produces.
  const accManifest: RenderManifest = {
    rig,
    parts: {
      ...manifest.parts,
      acc: {
        angles: {
          [HERO_ANGLE]: {
            finishes: {
              black: asset('renders/acc.webp', 30, 30, [0, 15]),
              white: asset('renders/acc-white.webp', 30, 30, [0, 15]),
            },
          },
        },
      },
    },
  }
  const accCatalog: Catalog = {
    ...catalog,
    parts: [
      ...catalog.parts.map((p) =>
        p.id === 'pole'
          ? {
              ...p,
              options: [
                {
                  key: 'options',
                  label: 'Options',
                  group: 'options-accessories',
                  values: [
                    {
                      code: 'HHUR',
                      label: 'Additional Hand Hole',
                      buildable: null,
                      mapsTo: null,
                      note: null,
                      placeable: true,
                      placement: { minFt: 3, stepIn: 6, multi: true, defaultFt: 3 },
                      renderPartId: 'acc',
                    },
                  ],
                },
              ],
            }
          : p,
      ),
      {
        id: 'acc', slot: 'accessory', name: 'Hand Hole', family: 'HHX', line: 'WiLLstudio',
        category: 'Pole Accessories', productClass: 'assembly-part', dropShip: false, tier: 2,
        mount: 'shaft', sockets: {}, finishes: [], keywords: [], model: null,
        placeholder: { kind: 'box', sizeM: [0.1, 0.1, 0.1], direction: 'up' },
        thumbnail: null, productUrl: '',
      },
    ] as Catalog['parts'],
  }
  const checked: PoleConfig = {
    ...config,
    specOptions: { pole: { options: ['HHUR'] } },
  }

  it('a checked accessory with a stored instance draws its layer at the instance height', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, {
      ...checked,
      accessoryPlacements: { HHUR: [{ heightFt: 10, orientation: 0 }] },
    })
    const acc = l.layers.find((x) => x.partId === 'acc@HHUR#0')!
    expect(acc).toBeDefined()
    // 10 ft = 3.048 m up → 304.8 px above the pole anchor in the test rig.
    const pole = l.layers.find((x) => x.partId === 'pole')!
    const poleAnchorY = pole.top + 600
    const accAnchorY = acc.top + 15
    expect(poleAnchorY - accAnchorY).toBeCloseTo(304.8, 5)
  })

  it('a checked accessory with NO stored placement still draws one instance at its default', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, checked)
    const acc = l.layers.find((x) => x.partId === 'acc@HHUR#0')!
    expect(acc).toBeDefined()
    const pole = l.layers.find((x) => x.partId === 'pole')!
    expect(pole.top + 600 - (acc.top + 15)).toBeCloseTo(3 * 0.3048 * 100, 5)
  })

  it('multiple instances each draw their own layer', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, {
      ...checked,
      accessoryPlacements: { HHUR: [{ heightFt: 4, orientation: 0 }, { heightFt: 8, orientation: 90 }] },
    })
    expect(l.layers.filter((x) => x.partId.startsWith('acc@HHUR#'))).toHaveLength(2)
  })

  it('an unchecked accessory draws nothing', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, {
      ...config,
      accessoryPlacements: { HHUR: [{ heightFt: 10, orientation: 0 }] },
    })
    expect(l.layers.some((x) => x.partId.startsWith('acc@'))).toBe(false)
  })

  it('accessory layers paint in the POLE\'s finish, not the base finish', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, {
      ...checked,
      finishes: { pole: 'white' },
    })
    const acc = l.layers.find((x) => x.partId === 'acc@HHUR#0')!
    expect(acc.asset.file).toBe('renders/acc-white.webp')
  })

  it('needs a pole — no accessory layer floats on a pole-less build', () => {
    const l = resolveAssemblyLayout(accCatalog, accManifest, {
      ...checked,
      pole: '',
      accessoryPlacements: { HHUR: [{ heightFt: 10, orientation: 0 }] },
    })
    expect(l.layers.some((x) => x.partId.startsWith('acc@'))).toBe(false)
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
describe('availableViews live stops (Phase 0.15 A)', () => {
  const layout = resolveAssemblyLayout(catalog, manifest, config)

  it('without live slots the carousel is exactly the 0.14 preset list', () => {
    expect(availableViews(layout)).toEqual(
      ASSEMBLY_VIEWS.filter((v) => focusBox(layout, v.focus) !== undefined),
    )
  })

  it('appends a live stop per web-GLB slot, after the base presets', () => {
    const views = availableViews(layout, ['arm'])
    expect(views.slice(0, -1)).toEqual(availableViews(layout))
    expect(views[views.length - 1]).toEqual({ id: 'arm-live', label: 'Arm', yaw: 0, focus: 'arm' })
    const both = availableViews(layout, ['fixture', 'arm'])
    expect(both.map((v) => v.id)).toContain('fixture-live')
    expect(both.map((v) => v.id)).toContain('arm-live')
  })

  it('offers no live stop for a slot this config does not composite', () => {
    const poleOnly = resolveAssemblyLayout(catalog, manifest, {
      ...config,
      arm: '',
      fixture: '',
      baseCover: '',
    })
    expect(availableViews(poleOnly, ['fixture', 'arm'])).toEqual(availableViews(poleOnly))
  })

  it('currentViewIndex finds a live stop by its focus', () => {
    const views = availableViews(layout, ['arm'])
    expect(currentViewIndex(views, 0, 'arm')).toBe(views.length - 1)
  })
})

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
    expect(availableFocusTargets(layout)).toEqual([
      'assembly',
      'fixture',
      'arm',
      'baseCover',
      'poleTop',
      'poleBottom',
    ])
  })

  /**
   * The composite regions behind Tyler's Pole Top / Pole Bottom carousel stops.
   * These replaced his `zoom: 2.6` + "0.8 m above the foot" constants, so the
   * point of these assertions is that the framing comes from the layers that are
   * actually composited — not from a number that happens to suit one pole.
   */
  describe('composite focus regions (Pole Top / Pole Bottom)', () => {
    it('Pole Top spans the fixture AND the arm together', () => {
      const top = focusBox(layout, 'poleTop')!
      const fixture = focusBox(layout, 'fixture')!
      const arm = focusBox(layout, 'arm')!
      expect(top.left).toBeLessThanOrEqual(Math.min(fixture.left, arm.left))
      expect(top.top).toBeLessThanOrEqual(Math.min(fixture.top, arm.top))
      expect(top.left + top.width).toBeGreaterThanOrEqual(
        Math.max(fixture.left + fixture.width, arm.left + arm.width),
      )
      expect(top.top + top.height).toBeGreaterThanOrEqual(
        Math.max(fixture.top + fixture.height, arm.top + arm.height),
      )
    })

    it('Pole Top sits above Pole Bottom in the layout', () => {
      const top = focusBox(layout, 'poleTop')!
      const bottom = focusBox(layout, 'poleBottom')!
      // y grows downward in layout pixel space.
      expect(top.top).toBeLessThan(bottom.top)
    })

    it('tracks the assembly instead of a fixed world offset', () => {
      // The failure mode of centring "0.8 m above the foot" was that it framed
      // the same world band whatever the pole did. Doubling the pole must move
      // Pole Top and leave Pole Bottom (the base cover) where it is.
      const tallCatalog: Catalog = {
        ...catalog,
        parts: catalog.parts.map((p) =>
          p.id === 'pole'
            ? { ...p, sockets: { ...p.sockets, top: { type: 'arm-mount', position: [0, 12, 0] } } }
            : p,
        ),
      }
      const tall = resolveAssemblyLayout(tallCatalog, manifest, config)
      const short = resolveAssemblyLayout(catalog, manifest, config)

      // Measured from the foot (origin), so the two layouts are comparable.
      const fromFoot = (l: typeof tall, t: 'poleTop' | 'poleBottom') =>
        focusBox(l, t)!.top - l.origin[1]
      expect(fromFoot(tall, 'poleTop')).toBeLessThan(fromFoot(short, 'poleTop'))
      expect(fromFoot(tall, 'poleBottom')).toBeCloseTo(fromFoot(short, 'poleBottom'), 6)
    })

    it('a build with no base cover offers no Pole Bottom', () => {
      const noBase = resolveAssemblyLayout(catalog, manifest, { ...config, baseCover: '' })
      expect(focusBox(noBase, 'poleBottom')).toBeUndefined()
      expect(availableFocusTargets(noBase)).not.toContain('poleBottom')
    })

    /**
     * Pole Top must degrade to whichever of its two slots is present, not
     * disappear when one is missing. Asserted against a hand-built layout: the
     * compositor only ever places a fixture inside `if (arm)`, so an armless
     * fixture cannot be produced through resolveAssemblyLayout (in the real
     * catalog post-tops go through the Direct Pole Mount pseudo-arm, so the case
     * does not arise there either) — but the union logic still has to handle it.
     */
    it('degrades to whichever of the fixture/arm pair is present', () => {
      const fixtureLayer = layout.layers.find((l) => l.slot === 'fixture')!
      const fixtureOnly = { ...layout, layers: [fixtureLayer] }
      expect(focusBox(fixtureOnly, 'arm')).toBeUndefined()
      expect(focusBox(fixtureOnly, 'poleTop')).toEqual(focusBox(fixtureOnly, 'fixture'))

      const armLayer = layout.layers.find((l) => l.slot === 'arm')!
      const armOnly = { ...layout, layers: [armLayer] }
      expect(focusBox(armOnly, 'poleTop')).toEqual(focusBox(armOnly, 'arm'))
    })
  })

  it('an empty layout offers nothing', () => {
    const empty = { layers: [], width: 0, height: 0, origin: [0, 0] as [number, number], missing: [] }
    expect(focusBox(empty, 'assembly')).toBeUndefined()
    expect(availableFocusTargets(empty)).toEqual([])
  })
})

describe('the canonical view set (Phase 0.11 E)', () => {
  // 0.11 shipped {0,180}; merging Tyler's 0.10.5_TO carousel restored 90 as a
  // third assembly view (Nick, 8/11), so 90 now snaps to ITSELF rather than
  // being folded into the back view.
  it('snaps any yaw to the nearest full-assembly view', () => {
    expect(snapAssemblyYaw(0)).toBe(0)
    expect(snapAssemblyYaw(44)).toBe(0)
    expect(snapAssemblyYaw(46)).toBe(90)
    expect(snapAssemblyYaw(90)).toBe(90)
    expect(snapAssemblyYaw(134)).toBe(90)
    expect(snapAssemblyYaw(180)).toBe(180)
    expect(snapAssemblyYaw(269)).toBe(180)
    expect(snapAssemblyYaw(-90)).toBe(0)
    expect(snapAssemblyYaw(360)).toBe(0)
    expect(snapAssemblyYaw(540)).toBe(180)
  })

  it('every canonical view yaw snaps to itself', () => {
    for (const yaw of ASSEMBLY_VIEW_YAWS) expect(snapAssemblyYaw(yaw)).toBe(yaw)
  })

  it('270° resolves to a real view rather than wedging the viewer', () => {
    // Equidistant from 0 and 180 and not itself a view; only reachable from a
    // stale/hand-edited value, but it must still land somewhere renderable.
    expect(ASSEMBLY_VIEW_YAWS).toContain(
      snapAssemblyYaw(270) as (typeof ASSEMBLY_VIEW_YAWS)[number],
    )
  })

  /**
   * The reason adding the 90° view needed no re-render. If this fails, the view
   * set has grown a member that is not a multiple of 90 and the 4-angle render
   * matrix no longer covers every radial arrangement — a coverage bug, not a
   * test to relax.
   */
  it('adding a view cannot require a new render azimuth', () => {
    const needed = new Set<number>()
    for (const armAzimuth of [0, 90, 180, 270]) {
      for (const orientation of [0, 90, 180, 270]) {
        for (const viewYaw of ASSEMBLY_VIEW_YAWS) {
          needed.add(((armAzimuth + orientation - viewYaw) % 360 + 360) % 360)
        }
      }
    }
    expect([...needed].sort((a, b) => a - b)).toEqual([...RENDER_AZIMUTHS])
  })

  it('the carousel presets are all reachable and self-consistent', () => {
    for (const v of ASSEMBLY_VIEWS) {
      expect(FOCUS_TARGETS).toContain(v.focus)
      if (v.focus === 'assembly') {
        expect(ASSEMBLY_VIEW_YAWS).toContain(v.yaw as (typeof ASSEMBLY_VIEW_YAWS)[number])
      }
    }
    // Every assembly view yaw gets exactly one carousel stop.
    const assemblyYaws = ASSEMBLY_VIEWS.filter((v) => v.focus === 'assembly').map((v) => v.yaw)
    expect(assemblyYaws.sort((a, b) => a - b)).toEqual([...ASSEMBLY_VIEW_YAWS])
    expect(new Set(ASSEMBLY_VIEWS.map((v) => v.id)).size).toBe(ASSEMBLY_VIEWS.length)
  })

  /**
   * The carousel headline derives its index from (viewYaw, focus) rather than
   * storing one — this is what keeps the headline honest when a callout or the
   * option rail moves the camera.
   */
  it('locates the current view from camera state alone', () => {
    expect(currentViewIndex(ASSEMBLY_VIEWS, 0, 'assembly')).toBe(0)
    expect(currentViewIndex(ASSEMBLY_VIEWS, 90, 'assembly')).toBe(1)
    expect(currentViewIndex(ASSEMBLY_VIEWS, 180, 'assembly')).toBe(2)
    // A focus view is identified by its focus, at whatever yaw it was entered.
    expect(ASSEMBLY_VIEWS[currentViewIndex(ASSEMBLY_VIEWS, 180, 'poleTop')].id).toBe('top')
    expect(ASSEMBLY_VIEWS[currentViewIndex(ASSEMBLY_VIEWS, 0, 'poleBottom')].id).toBe('bottom')
  })

  it('reports no match for a focus the preset list does not offer', () => {
    expect(currentViewIndex(ASSEMBLY_VIEWS, 0, 'arm')).toBe(-1)
    expect(currentViewIndex([], 0, 'assembly')).toBe(-1)
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

/**
 * Phase 0.12 — a crossarm carries a fixture at EACH end.
 *
 * FR2 is "Fixed 2 @ 180 deg, finial" in the ordering matrix and its real CAD is
 * a symmetric double-ended crossarm with an upward tenon at x = ±0.457. The
 * compositor placed exactly one fixture on it, because `attachSocket` returns
 * the FIRST socket matching the fixture's mount — so the second tenon rendered
 * bare no matter what the catalog declared.
 *
 * This is NOT the radial multi-arm mechanic: that repeats a whole ARM around
 * the pole (armCount 2 -> two arm layers at 0 deg/180 deg). A crossarm is ONE
 * arm asset with two ends, so repeating it would draw the crossarm — finial and
 * all — twice on top of itself.
 */
describe('multi-socket arms (crossarms)', () => {
  /** Rig with a real 35 deg azimuth so front/back depth is expressible. */
  const depthRig: RenderManifest['rig'] = {
    ...rig,
    azimuthDeg: 35,
  }
  const depthManifest: RenderManifest = { ...manifest, rig: depthRig }

  const crossCatalog: Catalog = {
    ...catalog,
    parts: catalog.parts.map((p) =>
      p.id === 'arm'
        ? {
            ...p,
            sockets: {
              // Deliberately NOT named `fixture`/`fixture2` in the test, to pin
              // that placement keys off socket TYPE and not socket name.
              right: { type: 'pendant' as const, position: [1, 0.5, 0] as [number, number, number] },
              left: { type: 'pendant' as const, position: [-1, 0.5, 0] as [number, number, number] },
            },
          }
        : p,
    ),
  }

  const layout = resolveAssemblyLayout(crossCatalog, depthManifest, config)
  const fixtures = layout.layers.filter((l) => l.slot === 'fixture')

  it('places one fixture per matching socket, not just the first', () => {
    expect(fixtures).toHaveLength(2)
    expect(layout.missing).toEqual([])
  })

  it('gives each fixture a distinct layer id', () => {
    expect(new Set(fixtures.map((l) => l.partId)).size).toBe(2)
  })

  it('places them at both sockets, one either side of the pole', () => {
    const xs = fixtures.map((l) => l.left).sort((a, b) => a - b)
    // +-1 m either side of the pole axis, projected through the rig map.
    const [right] = projectOffset(depthManifest, [1, 0, 0])
    const [left] = projectOffset(depthManifest, [-1, 0, 0])
    expect(xs[1] - xs[0]).toBeCloseTo(right - left, 6)
  })

  it('draws the far fixture BEHIND the arm and the near one in front', () => {
    const arm = layout.layers.find((l) => l.slot === 'arm')!
    const near = fixtures.find((l) => l.left > arm.left)!
    const far = fixtures.find((l) => l.left < arm.left)!
    // Under a 35 deg azimuth the +X end is toward the camera.
    expect(near.z).toBeGreaterThan(arm.z)
    expect(far.z).toBeLessThan(arm.z)
  })

  it('emits a night glow per fixture, not one for the arm', () => {
    expect(layout.lightPxs).toHaveLength(2)
  })

  it('leaves a single-socket arm exactly as before', () => {
    const single = resolveAssemblyLayout(catalog, manifest, config)
    expect(single.layers.map((l) => l.partId)).toEqual(['pole', 'base', 'arm', 'fix'])
    expect(single.layers.find((l) => l.slot === 'fixture')!.z).toBe(4)
  })
})

/**
 * Phase 0.12 — `mountOffset` corrects a real-CAD part whose origin is not its
 * lower attachment point (see the field's note in types.ts). FR2's pole collar
 * sits 0.0889 m above its GLB origin, so the crossarm floated 3.5" off the pole.
 */
describe('mountOffset', () => {
  const OFFSET = -0.25
  const offsetCatalog: Catalog = {
    ...catalog,
    parts: catalog.parts.map((p) =>
      p.id === 'arm' ? { ...p, mountOffset: [0, OFFSET, 0] as [number, number, number] } : p,
    ),
  }

  const base = resolveAssemblyLayout(catalog, manifest, config)
  const moved = resolveAssemblyLayout(offsetCatalog, manifest, config)

  /** Layer position relative to the layout's world origin — the layout box is
   *  normalized, so absolute `top` shifts whenever any layer moves. */
  const rel = (l: ReturnType<typeof resolveAssemblyLayout>, slot: string) => {
    const layer = l.layers.find((x) => x.slot === slot)!
    return [layer.left - l.origin[0], layer.top - l.origin[1]]
  }

  it('lowers the arm onto its host by the offset', () => {
    expect(rel(moved, 'arm')[1] - rel(base, 'arm')[1]).toBeCloseTo(-OFFSET * 100, 6)
    expect(rel(moved, 'arm')[0]).toBeCloseTo(rel(base, 'arm')[0], 6)
  })

  it('carries the fixture down with the arm, preserving their relationship', () => {
    expect(rel(moved, 'fixture')[1] - rel(base, 'fixture')[1]).toBeCloseTo(-OFFSET * 100, 6)
  })

  it('does not move the pole or base cover', () => {
    for (const slot of ['pole', 'baseCover']) {
      expect(rel(moved, slot)[1]).toBeCloseTo(rel(base, slot)[1], 6)
      expect(rel(moved, slot)[0]).toBeCloseTo(rel(base, slot)[0], 6)
    }
  })
})

describe('offsetDepthProxy', () => {
  it('generalizes armDepthProxy — an arm reach agrees at every azimuth', () => {
    for (const az of [0, 35, 90, 200]) {
      const r = { ...rig, azimuthDeg: az }
      for (const deg of [0, 45, 90, 135, 180, 270]) {
        // The rotated offset of a unit reach along +X at azimuth `deg`.
        expect(offsetDepthProxy(r, rotateY([1, 0, 0], deg))).toBeCloseTo(armDepthProxy(r, deg), 10)
      }
    }
  })
})
