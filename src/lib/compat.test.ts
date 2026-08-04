import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { allowedArmCounts, armAzimuths, attachSocket, compatibleParts, defaultConfig, exclusiveFamily, finishFor, isAssemblyPart, partById, repairConfig, specCodes, voltageCompatible } from './compat'

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

  it('offers the four aluminum poles for any arm, and every base cover for any pole', () => {
    expect(compatibleParts(catalog, config({}), 'pole')).toHaveLength(4)
    expect(compatibleParts(catalog, config({}), 'baseCover')).toHaveLength(3)
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
  const ALL_POLES = ['alum-pole-12', 'alum-pole-14', 'alum-pole-16', 'alum-pole-20'].sort()

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

describe('armAzimuths', () => {
  it('gives even-spaced azimuths for each count', () => {
    expect(armAzimuths(1)).toEqual([0])
    expect(armAzimuths(2)).toEqual([0, 180])
    expect(armAzimuths(3)).toEqual([0, 120, 240])
    expect(armAzimuths(4)).toEqual([0, 90, 180, 270])
  })
})

describe('allowedArmCounts', () => {
  it('intersects the pole and arm arrangement lists', () => {
    // alum-pole-14 and sh1-shepherds-hook are both annotated [1,2,3,4].
    expect(allowedArmCounts(catalog, config({ pole: 'alum-pole-14', arm: 'sh1-shepherds-hook' }))).toEqual([
      1, 2, 3, 4,
    ])
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
    expect(repairConfig(catalog, config({ armCount: 3 })).armCount).toBe(3)
  })

  it('resets an unsupported count to single', () => {
    // direct-mount only supports single; a twin request must clamp back to 1.
    // (Use a fixture the direct mount can actually host so the arm survives repair.)
    const cfg = config({ fixture: 'drx-post-top', arm: 'direct-mount', armCount: 4 })
    expect(repairConfig(catalog, cfg).armCount).toBe(1)
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
