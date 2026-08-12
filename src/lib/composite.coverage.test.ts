import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig, ProductLine } from '../types'
import { armAzimuths, autofillConfig, compatibleParts, partsForSlot, repairConfig, defaultConfig } from './compat'
import {
  ASSEMBLY_VIEW_YAWS,
  RENDER_ANGLE_KEYS,
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
// Phase 0.11 (Workstream E): the render set is the 4 azimuths a radial cluster
// can need inside the 2 canonical full-assembly views — NOT the retired 45°
// orbit. Mirrors RENDER_ANGLE_KEYS in composite.ts and COMPASS in
// scripts/render-rig/generate.mjs; all three must move together.
const COMPASS: string[] = [...RENDER_ANGLE_KEYS]

// Phase 0.10.5 (spec D9), unchanged in 0.11: NO exemptions. The former
// REAL_RENDER_PARTS / CORE_FINISH_IDS carve-out let 7 real-CAD parts ship with
// 5 of 13 finishes and a retired angle set — which silently substituted
// finishes and degraded the rotation. Narrowing the angle set does NOT relax
// this: every part still carries every shipped angle × every finish. If a GLB
// goes missing again, this gate must REPORT the degradation, never accept it.
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

  it('ships no angle outside the canonical render set', () => {
    // The other half of "no exemptions": a retired angle left in the manifest
    // is dead weight in the bundle and a trap for the next view-set change.
    const stray: string[] = []
    for (const [partId, entry] of Object.entries(manifest.parts)) {
      for (const angle of Object.keys(entry.angles)) {
        if (!COMPASS.includes(angle)) stray.push(`${partId}: unexpected angle ${angle}`)
      }
    }
    expect(stray).toEqual([])
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

  it('serves both canonical full-assembly views exactly, for every brand', () => {
    // 0.10.5's supports45 check silently snapped the whole assembly to 90°
    // when any part lacked an angle. The view set is now fixed, so this
    // asserts the requested view is the view you get — no degradation path.
    const brands: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport']
    for (const brand of brands) {
      const config = autofillConfig(catalog, defaultConfig(catalog, brand))
      for (const yaw of ASSEMBLY_VIEW_YAWS) {
        const layout = resolveAssemblyLayout(catalog, manifest, config, yaw)
        expect(layout.appliedViewYaw).toBe(yaw)
        expect(layout.missing).toEqual([])
      }
    }
  })

  it('no catalog arrangement can ask for an azimuth outside the render set', () => {
    // The 4-angle set is only sufficient because every arrangement the catalog
    // offers lands on a multiple of 90°. If someone adds a 6-arm cluster, the
    // renders silently fall back via nearestAngleKey and arms point the wrong
    // way — so fail loudly here instead.
    const counts = new Set<number>()
    for (const part of catalog.parts) for (const n of part.arrangements ?? []) counts.add(n)
    const offenders: string[] = []
    for (const n of counts) {
      for (const a of armAzimuths(n)) {
        if (a % 90 !== 0) offenders.push(`arrangement ${n} → ${a}°`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('composites every radial arrangement × orientation in both views', () => {
    // The reason the render set is 4 angles and not 2: a quad cluster shows
    // arms pointing four ways inside ONE view. If this passes with only
    // hero/az180 present, the render set could shrink further; it does not.
    const config = autofillConfig(catalog, defaultConfig(catalog, 'WiLLstudio'))
    const arm = catalog.parts.find((p) => p.id === config.arm)
    for (const count of arm?.arrangements ?? [1]) {
      for (const orientation of [0, 90, 180, 270]) {
        for (const yaw of ASSEMBLY_VIEW_YAWS) {
          const layout = resolveAssemblyLayout(
            catalog,
            manifest,
            repairConfig(catalog, { ...config, armCount: count, armOrientation: orientation }),
            yaw,
          )
          expect(
            layout.missing,
            `${count} arms @ ${orientation}° in the ${yaw}° view`,
          ).toEqual([])
        }
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
  const base = autofillConfig(catalog, defaultConfig(catalog, brand))
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
