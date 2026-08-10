import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig, ProductLine } from '../types'
import { compatibleParts, partsForSlot, repairConfig, defaultConfig } from './compat'
import {
  nearestAngleKey,
  resolveAssemblyLayout,
  resolveRenderAsset,
  type RenderManifest,
} from './composite'

// Real catalog + merged render manifest — this is the Phase 0.5 coverage gate.
// It must fail if any part or valid combo lacks a rendered asset.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(
  readFileSync('public/renders/manifest.json', 'utf-8'),
)

const FINISH_IDS = catalog.finishes.map((f) => f.id)
const COMPASS = ['hero', 'az45', 'az90', 'az135', 'az180', 'az225', 'az270', 'az315']

// Phase 0.10.5 (spec D9): NO exemptions. The former REAL_RENDER_PARTS /
// CORE_FINISH_IDS carve-out let 7 real-CAD parts ship with 5 of 13 finishes
// and no az45 — which silently substituted finishes and degraded the
// 8-position rotation to 4. If a GLB genuinely goes missing again, this gate
// must REPORT the degradation, never accept it.
describe('render manifest coverage', () => {
  it('has every angle × every finish for every catalog part', () => {
    const gaps: string[] = []
    for (const part of catalog.parts) {
      const entry = manifest.parts[part.id]
      if (!entry) {
        gaps.push(`${part.id}: absent from the manifest`)
        continue
      }
      for (const angle of COMPASS) {
        const finishes = entry.angles[angle]?.finishes
        if (!finishes) {
          gaps.push(`${part.id}: missing angle ${angle}`)
          continue
        }
        for (const finishId of FINISH_IDS) {
          if (!finishes[finishId]) gaps.push(`${part.id}/${angle}: missing finish ${finishId}`)
        }
      }
    }
    expect(gaps).toEqual([])
  })

  it('never needs a nearest-angle fallback for the shipped manifest', () => {
    // nearestAngleKey stays as defensive code, but the manifest we ship must
    // resolve every compass angle exactly.
    const fallbacks: string[] = []
    for (const part of catalog.parts) {
      for (const angle of COMPASS) {
        const resolved = nearestAngleKey(manifest, part.id, angle)
        if (resolved !== angle) fallbacks.push(`${part.id}: ${angle} -> ${resolved}`)
      }
    }
    expect(fallbacks).toEqual([])
  })

  it('never degrades the assembly rotation below 45° steps', () => {
    // composite.ts snaps to 90° if any rotating part lacks az45. With full
    // coverage that path must be unreachable for every valid assembly.
    const brands: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport']
    for (const brand of brands) {
      const config = repairConfig(catalog, defaultConfig(catalog, brand))
      for (const yaw of [45, 135, 225, 315]) {
        const layout = resolveAssemblyLayout(catalog, manifest, config, yaw)
        expect(layout.appliedViewYaw).toBe(yaw)
      }
    }
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
