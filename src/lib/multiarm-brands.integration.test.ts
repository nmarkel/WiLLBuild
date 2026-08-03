import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig, ProductLine } from '../types'
import { allowedArmCounts, compatibleParts, defaultConfig, partsForSlot, repairConfig } from './compat'
import { resolveAssemblyLayout, type RenderManifest } from './composite'

// Phase 0.9 (A4): multi-arm + banner were exposed on NAFCO & WiLLsport in
// ADDITION to WiLLstudio. This is the end-to-end gate proving those brands'
// radial + banner configs composite with zero missing renders against the REAL
// catalog + merged manifest — the same guarantee multiarm.integration.test.ts
// gives WiLLstudio. Discovery-based so it survives catalog part churn.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(readFileSync('public/renders/manifest.json', 'utf-8'))

const BRANDS: ProductLine[] = ['NAFCO', 'WiLLsport']

/** First fixture→arm→pole build for `brand` whose pole+arm allow all of 2/3/4. */
function findMultiArmConfig(brand: ProductLine): PoleConfig | null {
  const base = defaultConfig(catalog, brand)
  for (const fixture of partsForSlot(catalog, 'fixture', brand)) {
    const withFixture = { ...base, fixture: fixture.id }
    for (const arm of compatibleParts(catalog, withFixture, 'arm')) {
      const withArm = { ...withFixture, arm: arm.id }
      for (const pole of compatibleParts(catalog, withArm, 'pole')) {
        const withPole = { ...withArm, pole: pole.id }
        const allowed = allowedArmCounts(catalog, withPole)
        if ([2, 3, 4].every((n) => allowed.includes(n))) {
          const cover = compatibleParts(catalog, withPole, 'baseCover')[0]
          return repairConfig(catalog, { ...withPole, baseCover: cover?.id ?? '' })
        }
      }
    }
  }
  return null
}

describe.each(BRANDS)('%s multi-arm + banner — real assets', (brand) => {
  const base = findMultiArmConfig(brand)

  it('exposes at least one twin/triple/quad-capable build (A4 wiring)', () => {
    expect(base).not.toBeNull()
  })

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ])('armCount=%i composites with 0 missing and %i arm/fixture layers', (count, expected) => {
    if (!base) throw new Error(`no multi-arm config for ${brand}`)
    const config = repairConfig(catalog, { ...base, armCount: count })
    expect(config.armCount).toBe(count)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const armLayers = layout.layers.filter((l) => l.partId.startsWith(base.arm))
    const fixLayers = layout.layers.filter((l) => l.partId.startsWith(base.fixture))
    expect(armLayers.length).toBe(expected)
    expect(fixLayers.length).toBe(expected)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('has its own banner part and composites a multi-side banner with 0 missing', () => {
    const banner = catalog.parts.find((p) => p.slot === 'banner' && p.line === brand)
    expect(banner, `${brand} should have a banner arm`).toBeDefined()
    if (!base || !banner) return
    const count = banner.arrangements?.find((n) => n > 1) ?? 1
    const config = repairConfig(catalog, {
      ...base,
      armCount: 1,
      banner: { armId: banner.id, count, heightFt: 8 },
    })
    expect(config.banner?.count).toBe(count)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const bannerLayers = layout.layers.filter((l) => l.partId.startsWith(banner.id))
    expect(bannerLayers.length).toBe(count)
  })
})

// Guard the intent of the "generic arms only" decision: pre-counted NAFCO SKUs
// (abh-2/3/4, spx-2/3/4, upx-2) and the direct/tenon adapters must NOT offer a
// radial arm-count selector (no `arrangements`), so you can't pick "quad" on a
// quad bracket.
describe('NAFCO pre-counted / adapter arms stay single', () => {
  const SINGLE_ONLY = [
    'nafco-abh-2-double-arm-aluminum-bullhorn-brackets',
    'nafco-abh-3-triple-arm-aluminum-bullhorn-brackets',
    'nafco-abh-4-quad-arm-aluminum-bullhorn-brackets',
    'nafco-spx-2-aluminum-spoke-brackets',
    'nafco-spx-3-aluminum-spoke-brackets',
    'nafco-spx-4-aluminum-spoke-brackets',
    'nafco-upx-2-aluminum-upsweep-arms',
    'aluminum-tenon-adapters',
    'nafco-direct-mount',
  ]

  it.each(SINGLE_ONLY)('%s has no radial arrangements', (id) => {
    const part = catalog.parts.find((p) => p.id === id)
    expect(part, `${id} should exist`).toBeDefined()
    expect(part?.arrangements).toBeUndefined()
  })

  it('single-arm SKUs (abh-1/spx-1/upx-1) and generic arms DO offer arrangements', () => {
    for (const id of ['nafco-abh-1-single-arm-aluminum-bullhorn-brackets', 'nafco-spx-1-aluminum-spoke-brackets']) {
      const part = catalog.parts.find((p) => p.id === id)
      expect(part?.arrangements, `${id} should be multi-arm capable`).toBeDefined()
    }
  })
})
