import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { repairConfig } from './compat'
import { resolveAssemblyLayout, SLOT_Z, type RenderManifest } from './composite'

// Phase 0.8 (A5): the representative end-to-end proof, against the REAL catalog
// and the REAL merged render manifest — twin/triple/quad GVX on the Shepherd's
// Hook must composite with zero missing renders and the right number of arm +
// fixture layers, at the shipped camera angle.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(readFileSync('public/renders/manifest.json', 'utf-8'))

const base: PoleConfig = repairConfig(catalog, {
  configId: 'multiarm-e2e',
  brand: 'WiLLstudio',
  pole: 'alum-pole-20',
  baseCover: 'bc-fluted',
  arm: 'sh1-shepherds-hook',
  fixture: 'gvx-pendant',
  finish: 'matte-black',
  rev: 1,
  armCount: 1,
})

describe('multi-arm GVX on Shepherd’s Hook — real assets', () => {
  it('base config is the intended twin-capable GVX + SH1 build', () => {
    // Guards against a catalog change silently repairing the parts away.
    expect(base.arm).toBe('sh1-shepherds-hook')
    expect(base.fixture).toBe('gvx-pendant')
    expect(base.pole).toBe('alum-pole-20')
  })

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ])('armCount=%i composites with 0 missing and %i arm layers', (count, expectedArms) => {
    const config = repairConfig(catalog, { ...base, armCount: count })
    expect(config.armCount).toBe(count) // catalog allows it (A2)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const armLayers = layout.layers.filter((l) => l.partId.startsWith('sh1-shepherds-hook'))
    const fixLayers = layout.layers.filter((l) => l.partId.startsWith('gvx-pendant'))
    expect(armLayers.length).toBe(expectedArms)
    expect(fixLayers.length).toBe(expectedArms)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('twin draws one arm behind the pole and one in front (occlusion)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const poleZ = layout.layers.find((l) => l.partId === 'alum-pole-20')!.z
    expect(poleZ).toBe(SLOT_Z.pole)
    const armZs = layout.layers
      .filter((l) => l.partId.startsWith('sh1-shepherds-hook'))
      .map((l) => l.z)
    expect(armZs.some((z) => z < poleZ)).toBe(true) // one behind
    expect(armZs.some((z) => z > poleZ)).toBe(true) // one in front
  })

  it('twin resolves distinct per-azimuth render files (not the same image reused)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const armFiles = layout.layers
      .filter((l) => l.partId.startsWith('sh1-shepherds-hook'))
      .map((l) => l.asset.file)
    expect(new Set(armFiles).size).toBe(2)
  })
})

// Phase 0.8 (C, DoD #9): a banner-arm config renders + composites end-to-end.
describe('banner arm — real assets', () => {
  const bannerPart = catalog.parts.find((p) => p.slot === 'banner')

  it('the banner-arm category exists in the catalog', () => {
    expect(bannerPart).toBeDefined()
    expect(bannerPart!.arrangements).toBeDefined()
  })

  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
  ])('an opposite/multi-side banner (count=%i) composites with 0 missing and %i banner layers', (count, expected) => {
    const config = repairConfig(catalog, {
      ...base,
      banner: { armId: bannerPart!.id, count, heightFt: 8 },
    })
    expect(config.banner?.count).toBe(count)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const bannerLayers = layout.layers.filter((l) => l.partId.startsWith(bannerPart!.id))
    expect(bannerLayers.length).toBe(expected)
  })

  it('places the banner at the configured mid-shaft height (below the arm)', () => {
    const config = repairConfig(catalog, {
      ...base,
      banner: { armId: bannerPart!.id, count: 1, heightFt: 8 },
    })
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    const banner = layout.layers.find((l) => l.partId.startsWith(bannerPart!.id))!
    const arm = layout.layers.find((l) => l.partId.startsWith('sh1-shepherds-hook'))!
    // Banner at 8 ft sits below the arm at the 20 ft pole top (larger top = lower on screen).
    expect(banner.top).toBeGreaterThan(arm.top)
  })
})
