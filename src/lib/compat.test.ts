import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { accessorySideOptions, allowedArmCounts, armAzimuths, attachSocket, compatibleParts, defaultConfig, defaultSpecOptions, exclusiveFamily, finishFor, isAssemblyPart, partById, placeableAccessoryCodes, repairConfig, specCodes, voltageCompatible } from './compat'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test',
    brand: 'WiLLstudio',
    pole: 'alum-pole-14',
    baseCover: 'bc-cl2-medium-clamshell',
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

  it('offers the eight aluminum pole heights for any arm, and every base cover for any pole', () => {
    expect(compatibleParts(catalog, config({}), 'pole')).toHaveLength(8)
    expect(compatibleParts(catalog, config({}), 'baseCover')).toHaveLength(5)
  })

  it('demoted poles (fiberglass, steel fluted, named decorative) are never wizard parts', () => {
    for (const id of [
      'huntington-decorative-aluminum-anchor-base-light-poles',
      'round-tapered-fiberglass-anchor-base-light-poles',
      'round-tapered-fiberglass-direct-burial-light-poles',
      'round-tapered-steel-fluted-anchor-base-light-poles',
      'sacramento-decorative-aluminum-anchor-base-light-poles',
      'washington-decorative-aluminum-anchor-base-light-poles',
      'williamsburg-decorative-aluminum-anchor-base-light-poles',
    ]) {
      const part = partById(catalog, id)!
      expect(part.slot).toBe('standalone')
      expect(part.productClass).toBe('standalone')
    }
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

  // Phase 1.0: the builder offers only the core aluminum pole system — the
  // fiberglass, steel-fluted, and named decorative poles (Huntington,
  // Sacramento, Washington, Williamsburg) were demoted back to standalone.
  const ALL_POLES = [
    'alum-pole-8', 'alum-pole-10', 'alum-pole-12', 'alum-pole-14',
    'alum-pole-15', 'alum-pole-16', 'alum-pole-18', 'alum-pole-20',
  ].sort()

  // Phase 1.0: the official five base cover designs (CL1-3 clamshells, SC1-2
  // spun collars); the previous three covers were demoted to standalone.
  const ALL_BASE_COVERS = [
    'bc-cl1-small-clamshell', 'bc-cl2-medium-clamshell', 'bc-cl3-large-clamshell',
    'bc-sc1-spun-collar', 'bc-sc2-spun-collar-split',
  ].sort()

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
    baseCover: 'bc-cl2-medium-clamshell',
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

describe('armAzimuths', () => {
  it('gives even-spaced azimuths for each count', () => {
    expect(armAzimuths(1)).toEqual([0])
    expect(armAzimuths(2)).toEqual([0, 180])
    // Official 3-arm layout is 3@90 (SS3/AR3), not even 120° spacing.
    expect(armAzimuths(3)).toEqual([0, 90, 180])
    expect(armAzimuths(4)).toEqual([0, 90, 180, 270])
  })
})

describe('allowedArmCounts', () => {
  it('intersects the pole and arm arrangement lists', () => {
    // alum-pole-14 and the AR suspension arm are both annotated [1,2,3,4].
    expect(
      allowedArmCounts(catalog, config({ pole: 'alum-pole-14', arm: 'willstudio-suspension-arm-pole-top-brackets' })),
    ).toEqual([1, 2, 3, 4])
  })

  it('falls back to single-only for an arm with no arrangements (e.g. direct mount)', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'direct-mount' }))).toEqual([1])
  })

  it('always includes single and stays within 1..4', () => {
    const counts = allowedArmCounts(catalog, config({}))
    expect(counts).toContain(1)
    for (const n of counts) expect(n >= 1 && n <= 4).toBe(true)
  })
})

describe('repairConfig — arm count clamping', () => {
  it('keeps a valid multi-arm count', () => {
    // (AR suspension arm — SH1/PA1 became single-only per the official config list.)
    expect(
      repairConfig(catalog, config({ arm: 'willstudio-suspension-arm-pole-top-brackets', armCount: 3 })).armCount,
    ).toBe(3)
  })

  it('resets an unsupported count to single', () => {
    // direct-mount only supports single; a twin request must clamp back to 1.
    // (Use a fixture the direct mount can actually host so the arm survives repair.)
    const cfg = config({ fixture: 'drx-post-top', arm: 'direct-mount', armCount: 4 })
    expect(repairConfig(catalog, cfg).armCount).toBe(1)
  })
})

describe('repairConfig — banner shaft-height clamping (Phase 0.9; legacy path, NAFCO)', () => {
  // WiLLstudio banners flow through BA24/BA30 accessory placements in 1.0 —
  // the legacy config.banner path survives only for brands whose pole sheets
  // carry no banner-kit accessory (NAFCO / WiLLsport).
  const bannerId = 'nafco-ba1-banner-arm'
  const nafcoCfg = repairConfig(
    catalog,
    config({ brand: 'NAFCO', fixture: 'nafco-chx-cobrahead', pole: '', arm: '', baseCover: '' }),
  )
  const poleFt = partById(catalog, nafcoCfg.pole)?.heightFt ?? 20
  const maxFt = Math.max(8, Math.round(poleFt - 2))

  it('clamps an out-of-range height from a crafted share link down to the pole max', () => {
    const cfg = { ...nafcoCfg, banner: { armId: bannerId, count: 2, heightFt: 9999 } }
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(maxFt)
  })

  it('clamps a below-floor height up to the 8 ft minimum (Phase 1.0)', () => {
    const cfg = { ...nafcoCfg, banner: { armId: bannerId, count: 1, heightFt: 0 } }
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(8)
  })

  it('leaves an in-range height untouched', () => {
    const cfg = { ...nafcoCfg, banner: { armId: bannerId, count: 2, heightFt: 8 } }
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(8)
  })

  it('strips a legacy banner on brands with banner-kit accessories (WiLLstudio)', () => {
    const cfg = config({ pole: 'alum-pole-14', banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt: 10 } })
    expect(repairConfig(catalog, cfg).banner).toBeNull()
  })
})

describe('finishFor + repairConfig — per-part finishes (Phase 1.0)', () => {
  it('falls back to the base finish when a slot has no override', () => {
    const c = config({})
    expect(finishFor(c, 'pole')).toBe('matte-black')
    expect(finishFor(c, 'fixture')).toBe('matte-black')
  })

  it('an override wins for its slot only', () => {
    const c = config({ finishes: { pole: 'silver' } })
    expect(finishFor(c, 'pole')).toBe('silver')
    expect(finishFor(c, 'fixture')).toBe('matte-black')
  })

  it('non-assembly slots (banner) always use the base finish', () => {
    const c = config({ finishes: { pole: 'silver' } })
    expect(finishFor(c, 'banner')).toBe('matte-black')
  })

  it('repairConfig drops unknown finish ids from overrides', () => {
    const repaired = repairConfig(catalog, config({ finishes: { pole: 'not-a-finish', arm: 'silver' } }))
    expect(repaired.finishes).toEqual({ arm: 'silver' })
  })

  it('repairConfig clears an all-invalid overrides map to undefined', () => {
    const repaired = repairConfig(catalog, config({ finishes: { pole: 'not-a-finish' } }))
    expect(repaired.finishes).toBeUndefined()
  })
})

describe('repairConfig — per-slot spec-option pruning (Phase 1.0)', () => {
  it('keeps valid choices for the selected part', () => {
    const fixture = partById(catalog, 'gvx-pendant')!
    const opt = fixture.options![0]
    const code = opt.values[0].code
    const repaired = repairConfig(
      catalog,
      config({ specOptions: { fixture: { [opt.key]: code } } }),
    )
    expect(repaired.specOptions).toEqual({ fixture: { [opt.key]: code } })
  })

  it('drops keys the selected part does not offer and empty codes', () => {
    const fixture = partById(catalog, 'gvx-pendant')!
    const opt = fixture.options![0]
    const repaired = repairConfig(
      catalog,
      config({ specOptions: { fixture: { 'no-such-column': 'X', [opt.key]: '' } } }),
    )
    expect(repaired.specOptions).toBeUndefined()
  })

  it('drops choices for a slot whose part has no parsed sheet', () => {
    // sh1-shepherds-hook (arm) has no options table
    const repaired = repairConfig(
      catalog,
      config({ specOptions: { arm: { anything: 'X' } } }),
    )
    expect(repaired.specOptions).toBeUndefined()
  })

  it('a part swap drops stale codes the new part does not offer', () => {
    // DRX has a `design` ordering column; TEX does not.
    const valid = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { design: 'CH' } },
      }),
    )
    expect(valid.specOptions?.fixture?.design).toBe('CH')
    const swapped = repairConfig(
      catalog,
      config({
        fixture: 'tex-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { design: 'CH' } },
      }),
    )
    expect(swapped.specOptions?.fixture?.design ?? undefined).toBeUndefined()
  })
})

describe('multi-select options & exclusive families (Phase 1.0)', () => {
  it('specCodes normalizes strings, arrays, and absent values', () => {
    expect(specCodes(undefined)).toEqual([])
    expect(specCodes('')).toEqual([])
    expect(specCodes('BK')).toEqual(['BK'])
    expect(specCodes(['A', '', 'B'])).toEqual(['A', 'B'])
  })

  it('exclusiveFamily groups cords, surge suppressors, and photocontrols', () => {
    expect(exclusiveFamily('WHP3NP')).toBe('cord')
    expect(exclusiveFamily('SRG27710')).toBe('surge-suppressor')
    expect(exclusiveFamily('BPC1')).toBe('photocontrol')
    expect(exclusiveFamily('TLPC4')).toBe('photocontrol')
    expect(exclusiveFamily('N5P')).toBeUndefined()
  })

  it('repairConfig keeps multiple non-family codes in one multi column', () => {
    // drx options-2: BPC1 (photocontrol) + N5P (receptacle) may coexist
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { 'options-2': ['BPC1', 'N5P'] } },
      }),
    )
    expect(repaired.specOptions?.fixture?.['options-2']).toEqual(['BPC1', 'N5P'])
  })

  it('repairConfig keeps only the first code of an exclusive family', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { options: ['WHP3NP', 'WHP7NP'] } },
      }),
    )
    expect(repaired.specOptions?.fixture?.options).toEqual(['WHP3NP'])
  })

  it('family exclusivity spans columns (BPC in options-2 blocks TLPC in accessories)', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { 'options-2': ['BPC1'], accessories: ['TLPC1', 'HSS-DRX'] } },
      }),
    )
    expect(repaired.specOptions?.fixture?.['options-2']).toEqual(['BPC1'])
    expect(repaired.specOptions?.fixture?.accessories).toEqual(['HSS-DRX'])
  })

  it('repairConfig normalizes shapes: ordering → string, options/accessories → array', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { 'lumen-output': ['40'], options: 'WHP3NP' } },
      }),
    )
    expect(repaired.specOptions?.fixture?.['lumen-output']).toBe('40')
    expect(repaired.specOptions?.fixture?.options).toEqual(['WHP3NP'])
  })
})

describe('voltage → options compatibility (Phase 1.0)', () => {
  it('voltageCompatible reads ratings out of value labels', () => {
    expect(voltageCompatible('MV', 'Button Photocontrol, 120-277V')).toBe(true)
    expect(voltageCompatible('MV', 'Button Photocontrol, 347V')).toBe(false)
    expect(voltageCompatible('MV', 'Twist-Lock Photocell, 347/480V (Not Installed)')).toBe(false)
    expect(voltageCompatible('HV', '10kA Surge Suppressor (Field Replaceable), 347-480V')).toBe(true)
    expect(voltageCompatible('HV', '10kA Surge Suppressor (Field Replaceable), 120-277V')).toBe(false)
    // Unrated gear and custom/absent voltage never filter.
    expect(voltageCompatible('MV', 'NEMA 5pin Twist-Lock Receptacle')).toBe(true)
    expect(voltageCompatible('CV', 'Button Photocontrol, 480V')).toBe(true)
    expect(voltageCompatible(undefined, 'Button Photocontrol, 480V')).toBe(true)
  })

  it('repairConfig drops selected options that clash with the chosen voltage', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: {
          fixture: { voltage: 'MV', 'options-2': ['SRG48010', 'N5P'], accessories: ['TLPC4'] },
        },
      }),
    )
    expect(repaired.specOptions?.fixture?.['options-2']).toEqual(['N5P'])
    expect(repaired.specOptions?.fixture?.accessories).toBeUndefined()
  })

  it('a voltage change swaps which photocontrols survive', () => {
    const mv = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { voltage: 'HV', 'options-2': ['BPC4'] } },
      }),
    )
    expect(mv.specOptions?.fixture?.['options-2']).toEqual(['BPC4'])
    const swapped = repairConfig(catalog, {
      ...mv,
      specOptions: { fixture: { ...mv.specOptions!.fixture!, voltage: 'MV' } },
    })
    expect(swapped.specOptions?.fixture?.['options-2']).toBeUndefined()
  })

  it('no voltage chosen leaves every option available', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { 'options-2': ['BPC4', 'N5P'] } },
      }),
    )
    expect(repaired.specOptions?.fixture?.['options-2']).toEqual(['BPC4', 'N5P'])
  })
})

describe('default spec options — WHP7NP cord (Phase 1.0)', () => {
  it('defaultSpecOptions seeds the 6-ft cord where the sheet offers it', () => {
    expect(defaultSpecOptions(partById(catalog, 'gvx-pendant'))).toEqual({ options: ['WHP7NP'] })
    expect(defaultSpecOptions(partById(catalog, 'drx-post-top'))).toEqual({ options: ['WHP7NP'] })
    // TEX offers no cords; arms have no sheet at all.
    expect(defaultSpecOptions(partById(catalog, 'tex-post-top'))).toBeUndefined()
    expect(defaultSpecOptions(partById(catalog, 'sh1-shepherds-hook'))).toBeUndefined()
  })

  it('defaultConfig starts with the cord pre-selected on the default fixture', () => {
    const cfg = defaultConfig(catalog)
    expect(cfg.specOptions?.fixture?.options).toEqual(['WHP7NP'])
    // Still a stable, fully valid config.
    expect(repairConfig(catalog, cfg)).toEqual(cfg)
  })
})

describe('custom RAL color (Phase 1.1)', () => {
  it('repairConfig keeps a well-formed hex on a custom-ral slot', () => {
    const repaired = repairConfig(
      catalog,
      config({ finishes: { pole: 'custom-ral' }, finishRal: { pole: '#1A2B3C' } }),
    )
    expect(repaired.finishRal).toEqual({ pole: '#1a2b3c' })
  })

  it('repairConfig drops malformed hexes and colors on non-RAL slots', () => {
    const repaired = repairConfig(
      catalog,
      config({
        finishes: { pole: 'custom-ral' },
        finishRal: { pole: 'green', fixture: '#123456' },
      }),
    )
    expect(repaired.finishRal).toBeUndefined()
  })

  it('the ten-color WiLLcoat palette is in the catalog with order codes', () => {
    expect(catalog.finishes.map((f) => f.code)).toEqual([
      'BK', 'DB', 'WH', 'NA', 'LG', 'SG', 'DG', 'DP', 'GM', 'BA', 'BKA', 'SA', 'RAL',
    ])
  })
})

describe('SH1 shepherd’s hook is single-arm only (Phase 1.0)', () => {
  it('offers no multi-arm counts for SH1 on any pole', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'sh1-shepherds-hook', pole: 'alum-pole-20' }))).toEqual([1])
  })

  it('repairConfig clamps an old multi-arm SH1 share link to single', () => {
    const repaired = repairConfig(catalog, config({ arm: 'sh1-shepherds-hook', armCount: 4 }))
    expect(repaired.armCount).toBe(1)
  })
})

describe('official arm configuration list (Phase 1.0)', () => {
  const CASES: [string, number[]][] = [
    ['sh1-shepherds-hook', [1]],
    ['willstudio-side-shepherds-hook-pole-top-brackets', [1, 2, 3, 4]],
    ['willstudio-supported-decorative-arms', [1, 2]],
    ['willstudio-suspension-arm-pole-top-brackets', [1, 2, 3, 4]],
    ['upsweep', [1, 2]],
    ['willstudio-cr2-decorative-crossarm', [1]],
    ['willstudio-fr2-decorative-crossarm', [1]],
    ['willstudio-hsx-decorative-upsweep-arms', [1, 2]],
    ['pa1-pendant-arm', [1]],
    ['pm1-pendant-arm', [1]],
  ]

  it.each(CASES)('%s offers counts %j', (armId, counts) => {
    const arm = partById(catalog, armId)!
    // Pair with a fixture the arm can carry (the arm's socket type says what
    // it hosts) so the config survives repair.
    const socketType = Object.values(arm.sockets ?? {})[0]?.type
    const fixture =
      socketType === 'pendant' ? 'gvx-pendant' : socketType === 'arm-mount' ? 'mvx-coach' : 'drx-post-top'
    const cfg = repairConfig(catalog, config({ fixture, arm: armId, pole: 'alum-pole-20' }))
    expect(cfg.arm).toBe(armId)
    expect(allowedArmCounts(catalog, cfg)).toEqual(counts)
  })

  it('arms with model codes cover every offered count', () => {
    for (const [armId] of CASES) {
      const arm = partById(catalog, armId)!
      if (!arm.modelCodes) continue
      for (const n of arm.arrangements ?? [1]) {
        expect(arm.modelCodes[n], `${armId} count ${n}`).toBeTruthy()
      }
    }
  })
})

describe('arm orientation (Phase 1.0)', () => {
  it('repairConfig keeps valid orientations and normalizes 0 to unset', () => {
    expect(repairConfig(catalog, config({ armOrientation: 90 })).armOrientation).toBe(90)
    expect(repairConfig(catalog, config({ armOrientation: 270 })).armOrientation).toBe(270)
    expect(repairConfig(catalog, config({ armOrientation: 0 })).armOrientation).toBeUndefined()
  })

  it('repairConfig resets a tampered orientation', () => {
    expect(repairConfig(catalog, config({ armOrientation: 45 })).armOrientation).toBeUndefined()
  })
})

describe('pole heights + diameter column (Phase 1.0)', () => {
  it('offers the full WiLLstudio height range for the one design', () => {
    const poles = compatibleParts(catalog, config({}), 'pole')
    expect(new Set(poles.map((p) => p.family)).size).toBe(1)
    expect(poles.map((p) => p.heightFt).sort((a, b) => a! - b!)).toEqual([8, 10, 12, 14, 15, 16, 18, 20])
  })

  it('every pole has the Pole Diameter column (4040/5050/6060) and no length artifact', () => {
    for (const pole of compatibleParts(catalog, config({}), 'pole')) {
      const keys = (pole.options ?? []).map((o) => o.key)
      expect(keys).toContain('pole-diameter')
      expect(keys).not.toContain('length-pole-base-pole-top-wall-od-od-thickness')
      const dia = pole.options!.find((o) => o.key === 'pole-diameter')!
      expect(dia.values.map((v) => v.code)).toEqual(['4040', '5050', '6060'])
    }
  })
})

describe('pole base configuration columns (Phase 1.0)', () => {
  it('every pole offers Wall Thickness (C/D/E) and no anchor-bolts artifact', () => {
    for (const pole of compatibleParts(catalog, config({}), 'pole')) {
      const keys = (pole.options ?? []).map((o) => o.key)
      expect(keys).toContain('wall-thickness')
      expect(keys).not.toContain('anchor-bolts-base-type-finish-type')
      const wall = pole.options!.find((o) => o.key === 'wall-thickness')!
      expect(wall.values.map((v) => `${v.code}=${v.label}`)).toEqual(['C=0.125"', 'D=0.188"', 'E=0.250"'])
    }
  })
})

describe('anodized finishes are pole-only (Phase 1.0)', () => {
  const ANODIZED = ['bronze-anodized', 'black-anodized', 'satin-silver-anodized']

  it('poles offer the anodized trio; fixtures/arms/base covers do not', () => {
    for (const pole of compatibleParts(catalog, config({}), 'pole')) {
      for (const id of ANODIZED) expect(pole.finishes).toContain(id)
    }
    for (const slot of ['fixture', 'arm', 'baseCover'] as const) {
      for (const part of compatibleParts(catalog, config({}), slot)) {
        for (const id of ANODIZED) expect(part.finishes, `${part.id}`).not.toContain(id)
      }
    }
  })

  it('repairConfig drops an anodized override on a non-pole slot but keeps it on the pole', () => {
    const repaired = repairConfig(
      catalog,
      config({ finishes: { fixture: 'black-anodized', pole: 'black-anodized' } }),
    )
    expect(repaired.finishes).toEqual({ pole: 'black-anodized' })
  })
})

describe('accessory placements (Phase 1.0)', () => {
  const withFstr = () =>
    config({
      fixture: 'drx-post-top',
      arm: 'direct-mount',
      pole: 'alum-pole-12',
      specOptions: { pole: { options: ['FSTR'] } },
    })

  it('placeableAccessoryCodes lists selected marker-carrying codes only', () => {
    const cfg = repairConfig(catalog, withFstr())
    expect(placeableAccessoryCodes(catalog, cfg)).toEqual(['FSTR'])
    // BA24/BA30 banner kits are placeable too (height + orientation panel).
    const withBa = repairConfig(catalog, { ...withFstr(), specOptions: { pole: { accessories: ['BA24'] } } })
    expect(placeableAccessoryCodes(catalog, withBa)).toEqual(['BA24'])
  })

  it('repairConfig clamps placement height to the shaft and orientation to the compass set', () => {
    const repaired = repairConfig(catalog, {
      ...withFstr(),
      accessoryPlacements: { FSTR: { heightFt: 99, orientation: 45 } },
    })
    // 12 ft pole → max 11 ft; bad orientation resets to 0.
    expect(repaired.accessoryPlacements).toEqual({ FSTR: { heightFt: 11, orientation: 0 } })
  })

  it('repairConfig drops placements whose code is not selected', () => {
    const repaired = repairConfig(catalog, {
      ...config({}),
      accessoryPlacements: { FSTR: { heightFt: 6, orientation: 90 } },
    })
    expect(repaired.accessoryPlacements).toBeUndefined()
  })
})

describe('accessory placement sides (Phase 1.0)', () => {
  it('side sets come from what the accessory is', () => {
    expect(accessorySideOptions('24" Wind Shedding Banner Arm Kit, ... (Specify Pole Height & Orientation)')).toEqual([1, 2, 4])
    expect(accessorySideOptions('1" NPT Pipe-Thread Female Coupling (Specify Pole Height & Orientation)')).toEqual([1, 2])
    expect(accessorySideOptions('Single Flag Holder Kit (Specify Pole Height & Orientation)')).toEqual([1, 2])
    expect(accessorySideOptions('Single Plant Holder Kit (Specify Pole Height & Orientation)')).toEqual([1, 2])
    expect(accessorySideOptions('Festoon Provision, Electrical by Others')).toBeUndefined()
  })

  it('repairConfig clamps sides to the accessory set and strips them elsewhere', () => {
    const base = config({
      fixture: 'drx-post-top',
      arm: 'direct-mount',
      pole: 'alum-pole-12',
      specOptions: { pole: { options: ['FSTR'], accessories: ['BA24', 'FH'] } },
    })
    const repaired = repairConfig(catalog, {
      ...base,
      accessoryPlacements: {
        BA24: { heightFt: 10, orientation: 90, sides: 4 },
        FH: { heightFt: 8, orientation: 0, sides: 4 }, // FH allows 1|2 → clamps to 1
        FSTR: { heightFt: 6, orientation: 0, sides: 2 }, // FSTR has no sides → stripped
      },
    })
    expect(repaired.accessoryPlacements?.BA24?.sides).toBe(4)
    expect(repaired.accessoryPlacements?.FH?.sides).toBe(1)
    expect(repaired.accessoryPlacements?.FSTR?.sides).toBeUndefined()
  })

  it('repairConfig honors FSTR’s 37-inch label minimum', () => {
    const base = config({
      fixture: 'drx-post-top',
      arm: 'direct-mount',
      pole: 'alum-pole-12',
      specOptions: { pole: { options: ['FSTR'] } },
    })
    const repaired = repairConfig(catalog, {
      ...base,
      accessoryPlacements: { FSTR: { heightFt: 0, orientation: 0 } },
    })
    expect(repaired.accessoryPlacements?.FSTR?.heightFt).toBeCloseTo(37 / 12, 5)
  })
})
