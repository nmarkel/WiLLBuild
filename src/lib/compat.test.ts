import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { attachSocket, compatibleParts, defaultConfig, isAssemblyPart, partById, repairConfig } from './compat'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test',
    brand: 'WiLLstudio',
    pole: 'alum-pole-14',
    baseCover: 'bc-fluted',
    arm: 'sh1-shepherds-hook',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
    ...overrides,
  }
}

const sortedIds = (parts: { id: string }[]) => parts.map((p) => p.id).sort()

describe('compatibleParts (fixture-first)', () => {
  it('offers every fixture unconditionally', () => {
    expect(compatibleParts(catalog, config({}), 'fixture')).toHaveLength(4)
  })

  it('offers only pendant arms for the GVX pendant', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'gvx-pendant' }), 'arm'))
    expect(ids).toEqual(
      [
        'pa1-pendant-arm',
        'pm1-pendant-arm',
        'sh1-shepherds-hook',
        'willstudio-side-shepherds-hook-pole-top-brackets',
        'willstudio-suspension-arm-pole-top-brackets',
      ].sort(),
    )
  })

  it('offers direct mount plus post-top arms for post tops', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'drx-post-top' }), 'arm'))
    expect(ids).toEqual(
      [
        'aluminum-decorative-bullhorn-brackets-round-pole-mount',
        'direct-mount',
        'willstudio-cr2-decorative-crossarm',
        'willstudio-fr2-decorative-crossarm',
        'willstudio-supported-decorative-arms',
      ].sort(),
    )
  })

  it('offers only arm-mount carriers for the MVX coach', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'mvx-coach' }), 'arm'))
    expect(ids).toEqual(['upsweep', 'willstudio-hsx-decorative-upsweep-arms'].sort())
  })

  it('offers every pole for any arm, and every base cover for any pole', () => {
    expect(compatibleParts(catalog, config({}), 'pole')).toHaveLength(11)
    expect(compatibleParts(catalog, config({}), 'baseCover')).toHaveLength(3)
  })
})

describe('P1 pole-system promotions (Workstream G)', () => {
  const POST_TOP_ARMS = [
    'aluminum-decorative-bullhorn-brackets-round-pole-mount',
    'direct-mount',
    'willstudio-cr2-decorative-crossarm',
    'willstudio-fr2-decorative-crossarm',
    'willstudio-supported-decorative-arms',
  ].sort()

  const PENDANT_ARMS = [
    'pa1-pendant-arm',
    'pm1-pendant-arm',
    'sh1-shepherds-hook',
    'willstudio-side-shepherds-hook-pole-top-brackets',
    'willstudio-suspension-arm-pole-top-brackets',
  ].sort()

  const ALL_POLES = [
    'alum-pole-12',
    'alum-pole-14',
    'alum-pole-16',
    'alum-pole-20',
    'huntington-decorative-aluminum-anchor-base-light-poles',
    'round-tapered-fiberglass-anchor-base-light-poles',
    'round-tapered-fiberglass-direct-burial-light-poles',
    'round-tapered-steel-fluted-anchor-base-light-poles',
    'sacramento-decorative-aluminum-anchor-base-light-poles',
    'washington-decorative-aluminum-anchor-base-light-poles',
    'williamsburg-decorative-aluminum-anchor-base-light-poles',
  ].sort()

  const ALL_BASE_COVERS = ['aluminum-light-pole-base-covers', 'bc-fluted', 'bc-round'].sort()

  it('both post-top fixtures accept the same post-top arm list (with direct mount)', () => {
    for (const fixture of ['drx-post-top', 'tex-post-top']) {
      const ids = sortedIds(compatibleParts(catalog, config({ fixture }), 'arm'))
      expect(ids).toEqual(POST_TOP_ARMS)
    }
  })

  it('GVX pendant accepts every pendant arm including the two promoted brackets', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'gvx-pendant' }), 'arm'))
    expect(ids).toEqual(PENDANT_ARMS)
  })

  it('MVX coach accepts both upsweep arms', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'mvx-coach' }), 'arm'))
    expect(ids).toEqual(['upsweep', 'willstudio-hsx-decorative-upsweep-arms'].sort())
  })

  it('every promoted pole hosts every arm (tenon-3in top socket)', () => {
    for (const arm of catalog.parts.filter((p) => p.slot === 'arm')) {
      const poles = sortedIds(compatibleParts(catalog, config({ arm: arm.id }), 'pole'))
      expect(poles).toEqual(ALL_POLES)
    }
  })

  it('every pole (curated + promoted) hosts every base cover', () => {
    for (const pole of catalog.parts.filter((p) => p.slot === 'pole')) {
      const covers = sortedIds(compatibleParts(catalog, config({ pole: pole.id }), 'baseCover'))
      expect(covers).toEqual(ALL_BASE_COVERS)
    }
  })

  it('the demoted bolt-circle adapter is never a wizard part', () => {
    const adapter = partById(catalog, 'light-pole-bolt-circle-adapters')
    expect(adapter?.slot).toBe('standalone')
    expect(adapter?.productClass).toBe('standalone')
  })

  it('every promoted arm exposes exactly one fixture socket (multi-head out of scope)', () => {
    const promotedArms = [
      'aluminum-decorative-bullhorn-brackets-round-pole-mount',
      'willstudio-cr2-decorative-crossarm',
      'willstudio-fr2-decorative-crossarm',
      'willstudio-hsx-decorative-upsweep-arms',
      'willstudio-side-shepherds-hook-pole-top-brackets',
      'willstudio-suspension-arm-pole-top-brackets',
      'willstudio-supported-decorative-arms',
    ]
    for (const id of promotedArms) {
      const arm = partById(catalog, id)!
      expect(Object.keys(arm.sockets ?? {})).toHaveLength(1)
    }
  })
})

describe('repairConfig', () => {
  it('replaces an arm that cannot carry the new fixture', () => {
    const broken = config({ fixture: 'drx-post-top', arm: 'sh1-shepherds-hook' })
    const repaired = repairConfig(catalog, broken)
    expect(repaired.arm).toBe('direct-mount')
    expect(repaired.pole).toBe('alum-pole-14')
  })

  it('keeps a valid config unchanged', () => {
    const valid = config({})
    expect(repairConfig(catalog, valid)).toEqual(valid)
  })

  it('repairs unknown part ids from a tampered share URL', () => {
    const repaired = repairConfig(catalog, config({ fixture: 'nope', arm: 'nope', finish: 'nope' }))
    expect(partById(catalog, repaired.fixture)?.slot).toBe('fixture')
    expect(partById(catalog, repaired.arm)?.slot).toBe('arm')
    expect(repaired.finish).toBe('matte-black')
  })
})

describe('attachSocket', () => {
  it('finds the socket position for a fixture on its arm', () => {
    const arm = partById(catalog, 'sh1-shepherds-hook')!
    const fixture = partById(catalog, 'gvx-pendant')!
    expect(attachSocket(fixture, arm)?.position).toEqual([0.63, 0.45, 0])
  })

  it('lets a post top sit directly on the pole via the direct mount adapter', () => {
    const adapter = partById(catalog, 'direct-mount')!
    const fixture = partById(catalog, 'drx-post-top')!
    expect(attachSocket(fixture, adapter)?.type).toBe('tenon-2-3/8')
  })
})

describe('defaultConfig', () => {
  it('produces a fully valid config', () => {
    const cfg = defaultConfig(catalog)
    expect(repairConfig(catalog, cfg)).toEqual(cfg)
    expect(cfg.pole && cfg.baseCover && cfg.arm && cfg.fixture && cfg.finish).toBeTruthy()
  })
})

describe('standalone product class (two-product-class model)', () => {
  const standaloneEntry: CatalogPart = {
    id: 'standalone-test-bulkhead',
    slot: 'standalone',
    name: 'Test Bulkhead Fixture',
    family: 'Test',
    line: 'WiLLstudio',
    category: 'Bulkhead',
    productClass: 'standalone',
    dropShip: false,
    tier: 3,
    finishes: [],
    keywords: ['bulkhead'],
    model: null,
    thumbnail: null,
    productUrl: 'https://willbrands.com',
  }

  const catalogWithStandalone: Catalog = {
    ...catalog,
    parts: [...catalog.parts, standaloneEntry],
  }

  it('partsForSlot never returns a standalone entry for any Slot', () => {
    const slots = ['fixture', 'arm', 'pole', 'baseCover'] as const
    for (const slot of slots) {
      const ids = compatibleParts(catalogWithStandalone, config({}), slot).map((p) => p.id)
      expect(ids).not.toContain('standalone-test-bulkhead')
    }
  })

  it('repairConfig is unaffected by a standalone entry in the catalog', () => {
    const valid = config({})
    expect(repairConfig(catalogWithStandalone, valid)).toEqual(valid)
  })

  it('isAssemblyPart returns false for a standalone entry', () => {
    expect(isAssemblyPart(standaloneEntry)).toBe(false)
  })

  it('isAssemblyPart returns true for all wizard parts', () => {
    // Every standalone product now carries a derived placeholder (tier 2 = 3D
    // parametric), so tier no longer identifies wizard parts — slot does.
    const wizardParts = catalog.parts.filter((p) => p.slot !== 'standalone')
    expect(wizardParts.length).toBeGreaterThan(0)
    for (const part of wizardParts) {
      expect(isAssemblyPart(part)).toBe(true)
    }
  })

  it('isAssemblyPart narrows the type to include placeholder and sockets', () => {
    const part = catalog.parts[0]
    if (isAssemblyPart(part)) {
      // TypeScript narrowing: these fields are guaranteed defined inside this branch
      expect(part.placeholder).toBeDefined()
      expect(part.sockets).toBeDefined()
    }
  })

  it('isAssemblyPart returns false for a part with slot fixture but no placeholder', () => {
    const missingPlaceholder: CatalogPart = {
      id: 'fixture-no-placeholder',
      slot: 'fixture',
      name: 'Broken Fixture',
      family: 'Test',
      line: 'WiLLstudio',
      category: 'Fixture',
      productClass: 'assembly-part',
      dropShip: false,
      tier: 2,
      finishes: [],
      keywords: [],
      model: null,
      sockets: { top: { type: 'pendant', position: [0, 0.5, 0] } },
      thumbnail: null,
      productUrl: 'https://willbrands.com',
    }
    expect(isAssemblyPart(missingPlaceholder)).toBe(false)
  })

  it('all tier-2 wizard parts have the required new fields', () => {
    // Tier-2 wizard parts: the original curated 15 (dropShip:false) plus the P1
    // promotions from Workstream G. Curated parts have dropShip:false;
    // promoted inventory parts have a boolean dropShip. tier-3 entries (NAFCO, WiLLsport…).
    const curatedIds = [
      'drx-post-top',
      'tex-post-top',
      'mvx-coach',
      'gvx-pendant',
      'sh1-shepherds-hook',
      'upsweep',
      'pa1-pendant-arm',
      'pm1-pendant-arm',
      'direct-mount',
      'alum-pole-12',
      'alum-pole-14',
      'alum-pole-16',
      'alum-pole-20',
      'bc-fluted',
      'bc-round',
    ]
    const wizardParts = catalog.parts.filter((p) => p.slot !== 'standalone')
    expect(wizardParts.length).toBeGreaterThan(0)
    for (const part of wizardParts) {
      expect(part.line).toBe('WiLLstudio')
      expect(part.productClass).toBe('assembly-part')
      expect(typeof part.dropShip).toBe('boolean')
      expect(part.tier).toBe(2)
      expect(typeof part.category).toBe('string')
      // Curated 15 must have dropShip===false
      if (curatedIds.includes(part.id)) {
        expect(part.dropShip).toBe(false)
      }
    }
  })
})

describe('mount-type rules (H3b)', () => {
  const base: PoleConfig = {
    configId: 'test',
    brand: 'WiLLstudio',
    pole: 'alum-pole-14',
    baseCover: 'bc-fluted',
    arm: '',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
  }

  it('post-top fixtures get the direct mount and post-top arms', () => {
    const cfg = { ...base, fixture: 'drx-post-top' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toContain('direct-mount')
    expect(arms).not.toContain('sh1-shepherds-hook')
    expect(arms).not.toContain('upsweep')
  })

  it('TEX post-top gets the same post-top arm list as DRX', () => {
    const drx = compatibleParts(catalog, { ...base, fixture: 'drx-post-top' }, 'arm').map((p) => p.id)
    const tex = compatibleParts(catalog, { ...base, fixture: 'tex-post-top' }, 'arm').map((p) => p.id)
    expect(tex).toEqual(drx)
  })
  it('coach fixtures only get arm-mount upsweep arms', () => {
    const cfg = { ...base, fixture: 'mvx-coach' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['upsweep', 'willstudio-hsx-decorative-upsweep-arms'])
  })
  it('pendants only get pendant arms', () => {
    const cfg = { ...base, fixture: 'gvx-pendant' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).not.toContain('direct-mount')
    expect(arms).not.toContain('upsweep')
    expect(arms).toContain('sh1-shepherds-hook')
    expect(arms).toContain('willstudio-side-shepherds-hook-pole-top-brackets')
  })
  it('repairConfig moves a post-top off an arm onto the direct mount', () => {
    const cfg = { ...base, fixture: 'drx-post-top', arm: 'upsweep' }
    expect(repairConfig(catalog, cfg).arm).toBe('direct-mount')
  })
})
