import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { armAzimuths, repairConfig } from './compat'
import { angleKeyForAzimuth, resolveAssemblyLayout, SLOT_Z, type RenderManifest } from './composite'
import { resolvePartNumber } from './partNumber'

// Phase 0.8 (A5) / 0.10 (A + D): the representative end-to-end proof, against the
// REAL catalog and the REAL merged render manifest.
//
// 0.10 re-points this at a VALID multi-arm build. Phase 0.8 used "twin GVX on the
// Shepherd's Hook", but Tyler's Round-4 correction is that SH1 is single-arm
// only — clustering belongs to the Side Shepherds Hook (SS) family. The old demo
// config was therefore an unorderable product. SS also proves the ordering
// matrix end to end: 3 arms → SS3 → WP-SS3-40F-BK.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(readFileSync('public/renders/manifest.json', 'utf-8'))

const SS = 'willstudio-side-shepherds-hook-pole-top-brackets'

const base: PoleConfig = repairConfig(catalog, {
  configId: 'multiarm-e2e',
  brand: 'WiLLstudio',
  pole: 'alum-pole-20',
  baseCover: 'bc-fluted',
  arm: SS,
  fixture: 'gvx-pendant',
  finish: 'matte-black',
  rev: 1,
  armCount: 1,
})

describe('multi-arm GVX on the Side Shepherds Hook — real assets', () => {
  it('base config is the intended multi-arm-capable GVX + SS build', () => {
    // Guards against a catalog change silently repairing the parts away.
    expect(base.arm).toBe(SS)
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
    const armLayers = layout.layers.filter((l) => l.partId.startsWith(SS))
    const fixLayers = layout.layers.filter((l) => l.partId.startsWith('gvx-pendant'))
    expect(armLayers.length).toBe(expectedArms)
    expect(fixLayers.length).toBe(expectedArms)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('every arm count resolves a real WiLL part number', () => {
    for (const [count, code] of [
      [1, 'WP-SS1-40F-BK'],
      [2, 'WP-SS2-40F-BK'],
      [3, 'WP-SS3-40F-BK'],
      [4, 'WP-SS4-40F-BK'],
    ] as const) {
      const config = repairConfig(catalog, { ...base, armCount: count })
      const number = resolvePartNumber(catalog, config, SS)
      expect(number.code).toBe(code)
      expect(number.complete).toBe(true)
    }
  })

  it('triple/quad mount on the 90° drilled tenon (not 120° spacing)', () => {
    // Workstream A geometry fix — and the reason az120/az240 renders are retired.
    expect(armAzimuths(3)).toEqual([0, 90, 180])
    expect(armAzimuths(4)).toEqual([0, 90, 180, 270])
    for (const count of [1, 2, 3, 4]) {
      for (const deg of armAzimuths(count)) {
        const key = angleKeyForAzimuth(deg)
        expect(manifest.parts[SS].angles[key]).toBeDefined()
      }
    }
  })

  it('the retired 120°/240° renders are gone from the manifest', () => {
    for (const part of Object.values(manifest.parts)) {
      expect(part.angles.az120).toBeUndefined()
      expect(part.angles.az240).toBeUndefined()
    }
  })

  it('twin draws one arm behind the pole and one in front (occlusion)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const poleZ = layout.layers.find((l) => l.partId === 'alum-pole-20')!.z
    expect(poleZ).toBe(SLOT_Z.pole)
    const armZs = layout.layers.filter((l) => l.partId.startsWith(SS)).map((l) => l.z)
    expect(armZs.some((z) => z < poleZ)).toBe(true) // one behind
    expect(armZs.some((z) => z > poleZ)).toBe(true) // one in front
  })

  it('twin resolves distinct per-azimuth render files (not the same image reused)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const armFiles = layout.layers.filter((l) => l.partId.startsWith(SS)).map((l) => l.asset.file)
    expect(new Set(armFiles).size).toBe(2)
  })

  it('the SH1 shepherds hook stays single-arm only (Round 4 correction)', () => {
    const clustered = repairConfig(catalog, { ...base, arm: 'sh1-shepherds-hook', armCount: 3 })
    expect(clustered.armCount).toBe(1)
    const layout = resolveAssemblyLayout(catalog, manifest, clustered)
    expect(layout.missing).toEqual([])
    expect(layout.layers.filter((l) => l.partId.startsWith('sh1-shepherds-hook')).length).toBe(1)
  })
})

// Phase 0.8 (C, DoD #9) / 0.10 (C): a banner-arm config renders + composites
// end-to-end. Banner count is capped at an opposite pair for now (Nick, 8/3) —
// the 4-side layout is retired until Puddy confirms the true maximum per pole.
describe('banner arm — real assets', () => {
  const bannerPart = catalog.parts.find((p) => p.slot === 'banner')

  it('the banner-arm category exists and offers at most an opposite pair', () => {
    expect(bannerPart).toBeDefined()
    expect(bannerPart!.arrangements).toEqual([1, 2])
  })

  it.each([
    [1, 1],
    [2, 2],
  ])('a banner (count=%i) composites with 0 missing and %i banner layers', (count, expected) => {
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

  it('an unconfirmed 4-side banner from a crafted link clamps to a pair', () => {
    const config = repairConfig(catalog, {
      ...base,
      banner: { armId: bannerPart!.id, count: 4, heightFt: 8 },
    })
    expect(config.banner?.count).toBe(1)
  })

  it('places the banner at the configured mid-shaft height (below the arm)', () => {
    const config = repairConfig(catalog, {
      ...base,
      banner: { armId: bannerPart!.id, count: 1, heightFt: 8 },
    })
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    const banner = layout.layers.find((l) => l.partId.startsWith(bannerPart!.id))!
    const arm = layout.layers.find((l) => l.partId.startsWith(SS))!
    // Banner at 8 ft sits below the arm at the 20 ft pole top (larger top = lower on screen).
    expect(banner.top).toBeGreaterThan(arm.top)
  })
})
