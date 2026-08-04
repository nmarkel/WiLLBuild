import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig, ProductLine } from '../types'
import { compatibleParts, partsForSlot, repairConfig, defaultConfig } from './compat'
import { HERO_ANGLE, resolveAssemblyLayout, resolveRenderAsset, type RenderManifest } from './composite'

// Real catalog + merged render manifest — this is the Phase 0.5 coverage gate.
// It must fail if any part or valid combo lacks a rendered asset.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(
  readFileSync('public/renders/manifest.json', 'utf-8'),
)

const FINISH_IDS = catalog.finishes.map((f) => f.id)

// Parts rendered from real design files (scripts/render-rig/real-parts.json).
// Their GLBs are gitignored and live only on the machine that owns them, so
// renders in colors newer than their last real render lag until re-rendered
// there — the gate requires only the core five finishes for these parts.
const REAL_RENDER_PARTS = new Set(
  Object.keys(JSON.parse(readFileSync('scripts/render-rig/real-parts.json', 'utf-8'))),
)
const CORE_FINISH_IDS = ['matte-black', 'statuary-bronze', 'gloss-white', 'silver', 'forest-green']

describe('render manifest coverage', () => {
  it('has a hero-angle asset for every catalog finish, on every catalog part', () => {
    const gaps: string[] = []
    for (const part of catalog.parts) {
      const finishes = manifest.parts[part.id]?.angles[HERO_ANGLE]?.finishes
      if (!finishes) {
        gaps.push(`${part.id}: no hero angle entry`)
        continue
      }
      const required = REAL_RENDER_PARTS.has(part.id) ? CORE_FINISH_IDS : FINISH_IDS
      for (const finishId of required) {
        if (!finishes[finishId]) gaps.push(`${part.id}: missing finish ${finishId}`)
      }
    }
    expect(gaps).toEqual([])
  })
})

/**
 * Builder brands — the product lines with assembly parts (fixture/arm/pole/
 * baseCover) that actually go through the wizard/compositor. NAFCO and
 * WiLLsport have no baseCover parts of their own (see compat.ts canHost),
 * so baseCover enumeration naturally yields zero options for those brands —
 * resolveAssemblyLayout treats an empty baseCover selection as "not present"
 * rather than "missing render", which matches the wizard's own behavior.
 */
const BUILDER_BRANDS: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport']

/**
 * Enumerate every valid fixture -> arm -> pole -> baseCover combo for a brand
 * by walking compat.ts the same way the UI stepper does (fixture-first, each
 * step filtered by compatibleParts against the selections made so far).
 */
function enumerateConfigs(catalog: Catalog, brand: ProductLine): PoleConfig[] {
  const base = defaultConfig(catalog, brand)
  const configs: PoleConfig[] = []

  const fixtures = partsForSlot(catalog, 'fixture', brand)
  for (const fixture of fixtures) {
    const withFixture = { ...base, fixture: fixture.id }
    const arms = compatibleParts(catalog, withFixture, 'arm')
    // A fixture with no compatible arm can still stand alone (direct-mount-free
    // fixtures don't exist in this catalog, but guard the enumeration anyway).
    const armOptions = arms.length ? arms : [undefined]
    for (const arm of armOptions) {
      const withArm = { ...withFixture, arm: arm?.id ?? '' }
      const poles = compatibleParts(catalog, withArm, 'pole')
      const poleOptions = poles.length ? poles : [undefined]
      for (const pole of poleOptions) {
        const withPole = { ...withArm, pole: pole?.id ?? '' }
        const covers = compatibleParts(catalog, withPole, 'baseCover')
        const coverOptions = covers.length ? covers : [undefined]
        for (const cover of coverOptions) {
          const withCover = { ...withPole, baseCover: cover?.id ?? '' }
          for (const finishId of FINISH_IDS) {
            const config = repairConfig(catalog, { ...withCover, finish: finishId })
            configs.push(config)
          }
        }
      }
    }
  }
  return configs
}

describe.each(BUILDER_BRANDS)('%s builder coverage', (brand) => {
  const configs = enumerateConfigs(catalog, brand)

  it(`enumerates at least one combo (sanity check on the walk itself)`, () => {
    expect(configs.length).toBeGreaterThan(0)
  })

  it(`covers every fixture, arm, pole and all ${FINISH_IDS.length} finishes at least once`, () => {
    const fixtures = new Set(partsForSlot(catalog, 'fixture', brand).map((p) => p.id))
    const arms = new Set(configs.map((c) => c.arm).filter(Boolean))
    const poles = new Set(configs.map((c) => c.pole).filter(Boolean))
    const finishes = new Set(configs.map((c) => c.finish))
    const seenFixtures = new Set(configs.map((c) => c.fixture))

    for (const f of fixtures) expect(seenFixtures.has(f)).toBe(true)
    expect(finishes).toEqual(new Set(FINISH_IDS))
    // Every arm/pole this brand's fixtures can actually reach shows up somewhere.
    expect(arms.size).toBeGreaterThan(0)
    expect(poles.size).toBeGreaterThan(0)
  })

  it(`resolves every enumerated combo (${configs.length} configs) to a complete, finite layout`, () => {
    const failures: string[] = []
    for (const config of configs) {
      const layout = resolveAssemblyLayout(catalog, manifest, config)
      if (layout.missing.length !== 0) {
        failures.push(
          `${brand} fixture=${config.fixture} arm=${config.arm} pole=${config.pole} baseCover=${config.baseCover} finish=${config.finish}: missing renders for [${layout.missing.join(', ')}]`,
        )
        continue
      }
      const okBox =
        layout.width > 0 &&
        layout.height > 0 &&
        Number.isFinite(layout.width) &&
        Number.isFinite(layout.height)
      if (!okBox) {
        failures.push(
          `${brand} fixture=${config.fixture} arm=${config.arm} pole=${config.pole} baseCover=${config.baseCover} finish=${config.finish}: non-finite/empty box (${layout.width}x${layout.height})`,
        )
      }
    }
    expect(failures).toEqual([])
  })
})

describe('standalone part coverage', () => {
  const standaloneParts = catalog.parts.filter((p) => p.slot === 'standalone')

  it('has at least one standalone part to check (sanity check)', () => {
    expect(standaloneParts.length).toBeGreaterThan(0)
  })

  it('resolves every standalone part in its first finish and in all 5 catalog finishes', () => {
    const gaps: string[] = []
    for (const part of standaloneParts) {
      const primaryFinish = part.finishes[0] ?? catalog.finishes[0].id
      const primary = resolveRenderAsset(manifest, part.id, primaryFinish)
      if (!primary) gaps.push(`${part.id}: no asset for primary finish ${primaryFinish}`)

      for (const finishId of FINISH_IDS) {
        const asset = resolveRenderAsset(manifest, part.id, finishId)
        if (!asset) gaps.push(`${part.id}: no asset for finish ${finishId}`)
      }
    }
    expect(gaps).toEqual([])
  })
})
