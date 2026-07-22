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
