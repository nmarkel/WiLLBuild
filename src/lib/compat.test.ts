import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { allowedArmCounts, armAzimuths, attachSocket, compatibleParts, defaultConfig, isAssemblyPart, partById, repairConfig } from './compat'

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
    armCount: 1,
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

  it('every promoted WiLLstudio pole hosts every WiLLstudio arm (tenon-3in top socket)', () => {
    for (const arm of catalog.parts.filter((p) => p.slot === 'arm' && p.line === 'WiLLstudio')) {
      const poles = sortedIds(compatibleParts(catalog, config({ arm: arm.id }), 'pole'))
      expect(poles).toEqual(ALL_POLES)
    }
  })

  it('every WiLLstudio pole hosts every base cover', () => {
    for (const pole of catalog.parts.filter((p) => p.slot === 'pole' && p.line === 'WiLLstudio')) {
      const covers = sortedIds(compatibleParts(catalog, config({ pole: pole.id }), 'baseCover'))
      expect(covers).toEqual(ALL_BASE_COVERS)
    }
  })

  it('brand builders never share parts: NAFCO/WiLLsport combos are invisible to WiLLstudio', () => {
    // Brand-specific socket vocabularies (nafco-*, sport-*) plus the brand
    // filter in compatibleParts keep cross-brand assemblies impossible.
    for (const slot of ['fixture', 'arm', 'pole'] as const) {
      const ids = compatibleParts(catalog, config({}), slot).map((p) => p.id)
      for (const id of ids) {
        expect(partById(catalog, id)?.line).toBe('WiLLstudio')
      }
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
    // Real-geometry SH1 socket (catalog.json is the source of truth; updated in
    // cf6c563 "real SH1 shepherd's-hook fixture alignment"). The test expectation
    // had lagged that committed catalog change — reconciled here.
    expect(attachSocket(fixture, arm)?.position).toEqual([0.483, 0.514, 0])
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
      // Builder brands: WiLLstudio + the promoted NAFCO/WiLLsport configurators
      expect(['WiLLstudio', 'NAFCO', 'WiLLsport']).toContain(part.line)
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

// ---- Phase 0.8 (A1/A2): radial arm arrangements ----

describe('armAzimuths (Phase 0.10: 90° drilled tenon)', () => {
  it('places arms on the 90° drill pattern — triple is 3@90 with one leg empty', () => {
    expect(armAzimuths(1)).toEqual([0])
    expect(armAzimuths(2)).toEqual([0, 180])
    expect(armAzimuths(3)).toEqual([0, 90, 180])
    expect(armAzimuths(4)).toEqual([0, 90, 180, 270])
  })

  it('every azimuth is a multiple of 90 (the drilled-tenon vocabulary)', () => {
    for (const count of [1, 2, 3, 4]) {
      for (const deg of armAzimuths(count)) expect(deg % 90).toBe(0)
    }
  })
})

describe('allowedArmCounts (ordering-matrix driven)', () => {
  const SS = 'willstudio-side-shepherds-hook-pole-top-brackets'

  it('intersects the pole and arm arrangement lists', () => {
    // Side Shepherds Hook is SS1..SS4 on the matrix, poles carry 1..4.
    expect(allowedArmCounts(catalog, config({ pole: 'alum-pole-14', arm: SS }))).toEqual([1, 2, 3, 4])
  })

  it('falls back to single-only for an arm with no arrangements (e.g. direct mount)', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'direct-mount' }))).toEqual([1])
  })

  it('SH1 shepherds hook is single-only (Round 4 correction)', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'sh1-shepherds-hook' }))).toEqual([1])
  })

  it('supported-decorative and deco-upsweep families stop at a pair', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'willstudio-supported-decorative-arms' }))).toEqual([1, 2])
    expect(
      allowedArmCounts(catalog, config({ fixture: 'mvx-coach', arm: 'willstudio-hsx-decorative-upsweep-arms' })),
    ).toEqual([1, 2])
  })

  it('a crossarm is a FIXED pair — single is not offered', () => {
    // CR2/FR2 exist only as 2@180 on the sheet, so "1 arm" would have no code.
    for (const arm of ['willstudio-cr2-decorative-crossarm', 'willstudio-fr2-decorative-crossarm']) {
      expect(allowedArmCounts(catalog, config({ fixture: 'drx-post-top', arm }))).toEqual([2])
    }
  })

  it('stays within 1..4 for every catalog arm', () => {
    for (const arm of catalog.parts.filter((p) => p.slot === 'arm')) {
      const counts = allowedArmCounts(catalog, config({ arm: arm.id }))
      expect(counts.length).toBeGreaterThan(0)
      for (const n of counts) expect(n >= 1 && n <= 4).toBe(true)
    }
  })
})

describe('repairConfig — arm count clamping', () => {
  it('keeps a valid multi-arm count', () => {
    const cfg = config({ arm: 'willstudio-side-shepherds-hook-pole-top-brackets', armCount: 3 })
    expect(repairConfig(catalog, cfg).armCount).toBe(3)
  })

  it('resets an unsupported count to single', () => {
    // direct-mount only supports single; a twin request must clamp back to 1.
    // (Use a fixture the direct mount can actually host so the arm survives repair.)
    const cfg = config({ fixture: 'drx-post-top', arm: 'direct-mount', armCount: 4 })
    expect(repairConfig(catalog, cfg).armCount).toBe(1)
  })

  it('clamps a triple SH1 from a crafted share link back to single', () => {
    expect(repairConfig(catalog, config({ arm: 'sh1-shepherds-hook', armCount: 3 })).armCount).toBe(1)
  })

  it('clamps to the family minimum, not to 1, for a fixed-pair crossarm', () => {
    const cfg = config({ fixture: 'drx-post-top', arm: 'willstudio-cr2-decorative-crossarm', armCount: 1 })
    expect(repairConfig(catalog, cfg).armCount).toBe(2)
  })
})

// ---- Phase 0.10 (B): base cover is an Option, so "none" is a real choice ----

describe('repairConfig — optional base cover', () => {
  it('keeps a deliberate "no base cover" empty', () => {
    expect(repairConfig(catalog, config({ baseCover: '' })).baseCover).toBe('')
  })

  it('still repairs a base cover that is set but invalid', () => {
    expect(repairConfig(catalog, config({ baseCover: 'nope' })).baseCover).toBe('bc-fluted')
  })

  it('defaultConfig still ships a base cover', () => {
    expect(defaultConfig(catalog).baseCover).toBeTruthy()
  })
})

// ---- Phase 0.10 (Workstream 0): per-part ordering selections ----

describe('repairPartOptions', () => {
  const SS = 'willstudio-side-shepherds-hook-pole-top-brackets'

  it('folds a pre-0.10 fixture specOptions map into partOptions', () => {
    const cfg = repairConfig(catalog, config({ specOptions: { 'lumen-output': '80' } }))
    expect(cfg.specOptions).toBeUndefined()
    expect(cfg.partOptions?.['gvx-pendant']?.codes).toEqual({ 'lumen-output': '80' })
  })

  it('drops codes that are not in the part’s matrix (tampered share link)', () => {
    const cfg = repairConfig(
      catalog,
      config({ partOptions: { 'gvx-pendant': { codes: { 'lumen-output': 'HACK' }, addOns: ['NOPE'] } } }),
    )
    expect(cfg.partOptions).toBeUndefined()
  })

  it('keeps a valid design choice and add-on', () => {
    const cfg = repairConfig(
      catalog,
      config({ arm: SS, partOptions: { [SS]: { codes: { design: 'SS2' }, addOns: ['CF1'] } } }),
    )
    expect(cfg.partOptions?.[SS]).toEqual({ codes: { design: 'SS2' }, addOns: ['CF1'] })
  })

  it('drops selections for parts no longer in the build', () => {
    const cfg = repairConfig(
      catalog,
      config({ partOptions: { 'mvx-coach': { codes: { voltage: 'MV' } } } }),
    )
    expect(cfg.partOptions).toBeUndefined()
  })
})

describe('repairConfig — banner shaft-height clamping (Phase 0.9)', () => {
  const bannerId = 'willstudio-ba1-banner-arm'

  it('clamps an out-of-range height from a crafted share link down to the pole max', () => {
    // 14 ft pole → usable max = round(14 - 2) = 12 ft; a 9999 ft link must clamp.
    const cfg = config({ pole: 'alum-pole-14', banner: { armId: bannerId, count: 2, heightFt: 9999 } })
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(12)
  })

  it('clamps a below-floor height up to 4 ft', () => {
    const cfg = config({ pole: 'alum-pole-14', banner: { armId: bannerId, count: 1, heightFt: 0 } })
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(4)
  })

  it('leaves an in-range height untouched', () => {
    const cfg = config({ pole: 'alum-pole-20', banner: { armId: bannerId, count: 2, heightFt: 8 } })
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(8)
  })
})
