import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { accessoryHeightRange, accessorySideOptions, allowedArmCounts, armAzimuths, attachSocket, bannerHeightRange, bannerMinFt, bannerPanelSize, bannerSizesForLabel, codeAllowedOnPart, compatibleParts, defaultConfig, defaultSpecOptions, exclusiveFamily, finishFor, isAssemblyPart, partById, placeableAccessoryCodes, repairConfig, SLOT_ORDER, specCodes, voltageCompatible,
  autofillConfig,
  cordCodeFor,
  fixtureBottomFt,
} from './compat'
import { bannerGeometry } from './banner'

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
    // DRX, TEX, MVX, GVX + the DWX flood (Phase 0.10.5)
    expect(compatibleParts(catalog, config({}), 'fixture')).toHaveLength(5)
  })

  it('offers only pendant arms for the GVX pendant', () => {
    // SD + HS joined the pendant carriers 8/12 (Tyler's GVX bracket list) —
    // their placeholder-era sockets said post-top / arm-mount.
    // PA1 left the list 8/13 (Tyler): its fitting doesn't work with the GVX,
    // so its carry socket is its own type (pendant-pa1) that no fixture
    // mounts today — socket matching stays the only compatibility mechanism.
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'gvx-pendant' }), 'arm'))
    expect(ids).toEqual(
      [
        'pm1-pendant-arm',
        'sh1-shepherds-hook',
        'willstudio-hsx-decorative-upsweep-arms',
        'willstudio-side-shepherds-hook-pole-top-brackets',
        'willstudio-supported-decorative-arms',
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
      ].sort(),
    )
  })

  it('offers only arm-mount carriers for the MVX coach', () => {
    // HS became a pendant carrier 8/12; the classic upsweep stays MVX's own.
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'mvx-coach' }), 'arm'))
    expect(ids).toEqual(['upsweep'])
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
  ].sort()

  const PENDANT_ARMS = [
    'pm1-pendant-arm',
    'sh1-shepherds-hook',
    'willstudio-hsx-decorative-upsweep-arms',
    'willstudio-side-shepherds-hook-pole-top-brackets',
    'willstudio-supported-decorative-arms',
    'willstudio-suspension-arm-pole-top-brackets',
  ].sort()

  // Phase 0.10.5: the builder offers only the core aluminum pole system — the
  // fiberglass, steel-fluted, and named decorative poles (Huntington,
  // Sacramento, Washington, Williamsburg) were demoted back to standalone.
  const ALL_POLES = [
    'alum-pole-8', 'alum-pole-10', 'alum-pole-12', 'alum-pole-14',
    'alum-pole-15', 'alum-pole-16', 'alum-pole-18', 'alum-pole-20',
  ].sort()

  // Phase 0.10.5: the official five base cover designs (CL1-3 clamshells, SC1-2
  // spun collars); the previous three covers were demoted to standalone.
  const ALL_BASE_COVERS = [
    'bc-cl1-small-clamshell', 'bc-cl2-medium-clamshell', 'bc-cl3-large-clamshell',
    'bc-sc1-spun-collar', 'bc-sc2-spun-collar-split',
  ].sort()

  it('post-top-mount fixtures accept the same post-top arm list (with direct mount)', () => {
    for (const fixture of ['drx-post-top', 'tex-post-top', 'willstudio-dwx-flood-spot']) {
      const ids = sortedIds(compatibleParts(catalog, config({ fixture }), 'arm'))
      expect(ids).toEqual(POST_TOP_ARMS)
    }
  })

  it('GVX pendant accepts every pendant arm including the two promoted brackets', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'gvx-pendant' }), 'arm'))
    expect(ids).toEqual(PENDANT_ARMS)
  })

  it('MVX coach keeps the classic upsweep (HS became a pendant carrier 8/12)', () => {
    const ids = sortedIds(compatibleParts(catalog, config({ fixture: 'mvx-coach' }), 'arm'))
    expect(ids).toEqual(['upsweep'])
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

  /**
   * Phase 0.12: this used to assert every promoted arm had exactly ONE socket,
   * "multi-head out of scope". That was a scope decision, not an invariant, and
   * it silently locked in the FR2 bug — FR2 is "Fixed 2 @ 180 deg, finial" in
   * the ordering matrix and its real CAD is a symmetric double-ended crossarm,
   * so one socket meant one tenon always rendered bare.
   *
   * The real rule is that the socket count matches the geometry.
   */
  it('each promoted arm exposes as many fixture sockets as it has mounts', () => {
    const expected: Record<string, number> = {
      'aluminum-decorative-bullhorn-brackets-round-pole-mount': 1,
      // CR2 is also a "Fixed 2 @ 180 deg" crossarm, but it is still on a
      // SINGLE-ENDED placeholder tube and is Coming Soon. Giving it a second
      // socket before its real CAD lands would composite a fixture onto an end
      // its artwork does not have. Bump to 2 with the geometry, not before.
      'willstudio-cr2-decorative-crossarm': 1,
      'willstudio-fr2-decorative-crossarm': 2,
      'willstudio-hsx-decorative-upsweep-arms': 1,
      'willstudio-side-shepherds-hook-pole-top-brackets': 1,
      'willstudio-suspension-arm-pole-top-brackets': 1,
      'willstudio-supported-decorative-arms': 1,
    }
    for (const [id, count] of Object.entries(expected)) {
      const arm = partById(catalog, id)!
      expect(Object.keys(arm.sockets ?? {}), id).toHaveLength(count)
    }
  })
})

describe('repairConfig', () => {
  it('clears an arm that cannot carry the new fixture (repair never chooses)', () => {
    // Pre-8/12 this auto-picked direct-mount. Blank-slate rule: an invalid
    // choice falls back to UNCHOSEN — the customer picks the replacement.
    const broken = config({ fixture: 'drx-post-top', arm: 'sh1-shepherds-hook' })
    const repaired = repairConfig(catalog, broken)
    expect(repaired.arm).toBe('')
  })

  it('keeps a valid config unchanged', () => {
    const valid = config({})
    expect(repairConfig(catalog, valid)).toEqual(valid)
  })

  it('clears unknown part ids from a tampered share URL (never invents)', () => {
    const repaired = repairConfig(catalog, config({ fixture: 'nope', arm: 'nope', finish: 'nope' }))
    expect(repaired.fixture).toBe('')
    expect(repaired.arm).toBe('')
    // Finish still snaps to a real one — '' is not a legal finish.
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
  it('opens as a blank slate — no part chosen, repair leaves it alone', () => {
    const cfg = defaultConfig(catalog)
    expect(repairConfig(catalog, cfg)).toEqual(cfg)
    expect(cfg.fixture).toBe('')
    expect(cfg.arm).toBe('')
    expect(cfg.pole).toBe('')
    expect(cfg.baseCover).toBe('')
    expect(cfg.finish).toBeTruthy()
  })

  it('autofillConfig builds a complete, valid, configurable assembly on demand', () => {
    const filled = autofillConfig(catalog, defaultConfig(catalog))
    expect(filled.pole && filled.baseCover && filled.arm && filled.fixture).toBeTruthy()
    expect(repairConfig(catalog, filled)).toEqual(filled)
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

describe('base-cover taxonomy (Phase 0.11, Workstream B1)', () => {
  it('base cover is a first-class build step, ahead of Finish', () => {
    expect(SLOT_ORDER).toContain('baseCover')
    expect(compatibleParts(catalog, config({}), 'baseCover').length).toBeGreaterThan(0)
  })

  it('standalone base covers share one official site category', () => {
    // Before 0.11 these carried 'base-cover' / 'Base Covers', neither of which
    // is in catalog.categories.WiLLstudio, so all three fell to the alphabetical
    // tail of the brand showroom instead of grouping as their own category.
    const ids = ['bc-fluted', 'bc-round', 'aluminum-light-pole-base-covers']
    for (const id of ids) {
      const part = partById(catalog, id)!
      expect(part.category).toBe('Decorative Base Covers')
      // Re-slotting is what broke the geometry-service fixtures in 0.10.5 —
      // the taxonomy fix must not touch `slot`.
      expect(part.slot).toBe('standalone')
    }
  })

  it('the category is one the official taxonomy already lists', () => {
    expect(catalog.categories?.WiLLstudio).toContain('Decorative Base Covers')
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
    expect(arms).toEqual(['upsweep'])
  })
  it('pendants only get pendant arms', () => {
    const cfg = { ...base, fixture: 'gvx-pendant' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).not.toContain('direct-mount')
    expect(arms).not.toContain('upsweep')
    expect(arms).toContain('sh1-shepherds-hook')
    expect(arms).toContain('willstudio-side-shepherds-hook-pole-top-brackets')
  })
  it('repairConfig clears an arm a post-top cannot mount (customer re-picks)', () => {
    const cfg = { ...base, fixture: 'drx-post-top', arm: 'upsweep' }
    expect(repairConfig(catalog, cfg).arm).toBe('')
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
    // alum-pole-14 is annotated [1,2,3,4]; the AR brackets trimmed to [1,2]
    // (Tyler 8/12: Single + Twin only) — the intersection is the arm's set.
    expect(
      allowedArmCounts(catalog, config({ pole: 'alum-pole-14', arm: 'willstudio-suspension-arm-pole-top-brackets' })),
    ).toEqual([1, 2])
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
  it('keeps a valid multi-arm count and clamps one outside the cut', () => {
    // Tyler 8/12: brackets offer Single + Twin only. Twin survives; a triple
    // from an old share URL clamps back to single.
    expect(
      repairConfig(catalog, config({ arm: 'willstudio-suspension-arm-pole-top-brackets', armCount: 2 })).armCount,
    ).toBe(2)
    expect(
      repairConfig(catalog, config({ arm: 'willstudio-suspension-arm-pole-top-brackets', armCount: 3 })).armCount,
    ).toBe(1)
  })

  it('resets an unsupported count to single', () => {
    // direct-mount only supports single; a twin request must clamp back to 1.
    // (Use a fixture the direct mount can actually host so the arm survives repair.)
    const cfg = config({ fixture: 'drx-post-top', arm: 'direct-mount', armCount: 4 })
    expect(repairConfig(catalog, cfg).armCount).toBe(1)
  })
})

describe('repairConfig — banner shaft-height clamping (Phase 0.9; legacy path, NAFCO)', () => {
  // WiLLstudio banners flow through BA24/BA30 accessory placements in 0.10.5 —
  // the legacy config.banner path survives only for brands whose pole sheets
  // carry no banner-kit accessory (NAFCO / WiLLsport).
  const bannerId = 'nafco-ba1-banner-arm'
  const nafcoCfg = repairConfig(
    catalog,
    config({ brand: 'NAFCO', fixture: 'nafco-chx-cobrahead', pole: '', arm: '', baseCover: '' }),
  )
  // NAFCO pole entries carry no heightFt, so the 20 ft fallback applies.
  const poleFt = partById(catalog, nafcoCfg.pole)?.heightFt ?? 20
  // Phase 0.11 (D3): the ceiling now reserves the panel's own height above the
  // bottom-edge mounting point — 20 ft pole, default 48 in panel, 1 ft of
  // pole-top clearance → 15 ft (it was poleFt − 2 = 18 ft when the height meant
  // the panel's centre).
  const maxFt = 15

  it('clamps an out-of-range height from a crafted share link down to the pole max', () => {
    const cfg = { ...nafcoCfg, banner: { armId: bannerId, count: 2, heightFt: 9999 } }
    expect(poleFt).toBe(20)
    expect(repairConfig(catalog, cfg).banner?.heightFt).toBe(maxFt)
  })

  it('clamps a below-floor height up to the 8 ft minimum (Phase 0.10.5)', () => {
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

  it('keeps a catalog panel size and drops an invented one (Phase 0.11, D2)', () => {
    const keep = repairConfig(catalog, {
      ...nafcoCfg,
      banner: { armId: bannerId, count: 1, heightFt: 8, size: '30x60' },
    })
    expect(keep.banner?.size).toBe('30x60')
    const drop = repairConfig(catalog, {
      ...nafcoCfg,
      banner: { armId: bannerId, count: 1, heightFt: 8, size: '99x99' },
    })
    expect(drop.banner?.size).toBeUndefined()
  })

  it('a taller panel lowers the ceiling (the panel has to stay on the pole)', () => {
    const tall = repairConfig(catalog, {
      ...nafcoCfg,
      banner: { armId: bannerId, count: 1, heightFt: 9999, size: '30x60' },
    })
    // 20 ft pole − 5 ft panel − 1 ft clearance.
    expect(tall.banner?.heightFt).toBe(14)
    const short = repairConfig(catalog, {
      ...nafcoCfg,
      banner: { armId: bannerId, count: 1, heightFt: 9999, size: '18x36' },
    })
    // 20 ft pole − 3 ft panel − 1 ft clearance.
    expect(short.banner?.heightFt).toBe(16)
  })
})

describe('banner mounting rules (Phase 0.11, Workstream D)', () => {
  const BA24 =
    '24" Wind Shedding Banner Arm Kit, For Banners Less Than 17.5 sq ft, 24" Fiberglass Arms, Bolt Mounted or Banded to Pole, Finished to Match Pole (Field Installed) (Specify Pole Height & Orientation)'
  const BA30 = BA24.replace(/24"/g, '30"')

  it('the floor is 8 ft, and 10 ft once the pole reaches 25 ft', () => {
    // No catalog pole reaches 25 ft today (8–20 ft), so the rule is written as
    // a function of pole height and will start applying by itself.
    expect(catalog.parts.filter((p) => p.slot === 'pole').every((p) => (p.heightFt ?? 0) < 25)).toBe(true)
    for (const ft of [8, 10, 15, 20, 24, 24.99]) expect(bannerMinFt(ft)).toBe(8)
    for (const ft of [25, 30, 39]) expect(bannerMinFt(ft)).toBe(10)
    expect(bannerHeightRange(catalog, 25, '24x48').minFt).toBe(10)
    expect(bannerHeightRange(catalog, 20, '24x48').minFt).toBe(8)
  })

  it('the ceiling keeps the whole panel on the pole', () => {
    // 25 ft pole, 60 in panel, 1 ft clearance → bottom no higher than 19 ft.
    expect(bannerHeightRange(catalog, 25, '30x60')).toEqual({ minFt: 10, maxFt: 19, fits: true })
  })

  it('the panel never runs past the pole top at the maximum height', () => {
    const arm = catalog.parts.find((p) => p.id === 'willstudio-ba1-banner-arm')!
    for (const poleFt of [8, 10, 12, 14, 15, 16, 18, 20, 25, 39]) {
      for (const id of ['18x36', '24x48', '30x60']) {
        const range = bannerHeightRange(catalog, poleFt, id)
        if (!range.fits) continue
        const geom = bannerGeometry(arm, range.maxFt, bannerPanelSize(catalog, id))!
        expect(geom.topBarM).toBeLessThanOrEqual(poleFt * 0.3048)
      }
    }
  })

  it('flags — rather than silently allows — a panel a short pole cannot carry', () => {
    // An 8 ft pole cannot hold any banner above the 8 ft floor. The range
    // collapses onto the floor and `fits` says so, so the UI can warn.
    const range = bannerHeightRange(catalog, 8, '30x60')
    expect(range).toEqual({ minFt: 8, maxFt: 8, fits: false })
    expect(bannerHeightRange(catalog, 14, '24x48').fits).toBe(true)
  })

  it('both banner paths agree on the same pole', () => {
    // The legacy config.banner path and the BA24/BA30 accessory path must not
    // drift apart again — they resolve through one function.
    for (const poleFt of [12, 15, 20, 25]) {
      for (const id of [undefined, '18x36', '24x48']) {
        expect(accessoryHeightRange(catalog, poleFt, BA24, id)).toEqual(
          bannerHeightRange(catalog, poleFt, id),
        )
      }
    }
  })

  it('a banner kit only offers panels its own arms can carry', () => {
    // Derived from the kit's own label text ("24" Fiberglass Arms"), not a
    // hardcoded code→size table.
    expect(bannerSizesForLabel(catalog, BA24).map((s) => s.id)).toEqual(['18x36', '24x48'])
    expect(bannerSizesForLabel(catalog, BA30).map((s) => s.id)).toEqual(['18x36', '24x48', '30x60'])
    // A label with no declared arm length (legacy BA1 parts) offers everything.
    expect(bannerSizesForLabel(catalog, 'BA1 Banner Arm').map((s) => s.id)).toHaveLength(3)
  })

  it('non-banner accessories keep the generic 1 ft pole-top clearance', () => {
    expect(accessoryHeightRange(catalog, 12, 'Festoon Provision, Electrical by Others')).toEqual({
      minFt: 2,
      maxFt: 11,
      fits: true,
    })
  })
})

describe('FH/PH placement windows (CR-PLC-07, Tyler 8/14)', () => {
  const withHolder = (code: string, heightFt: number) =>
    repairConfig(catalog, {
      ...autofillConfig(catalog, defaultConfig(catalog)),
      pole: 'alum-pole-20',
      specOptions: { pole: { accessories: [code] } },
      accessoryPlacements: { [code]: { heightFt, orientation: 0, sides: 1 } },
    })

  it('flag + plant holders clamp to 8–12 ft and snap to 6-inch steps', () => {
    expect(withHolder('FH', 3).accessoryPlacements?.FH?.heightFt).toBe(8)
    expect(withHolder('FH', 19).accessoryPlacements?.FH?.heightFt).toBe(12)
    // 9.7 ft snaps to the 6" grid → 9.5 ft.
    expect(withHolder('PH', 9.7).accessoryPlacements?.PH?.heightFt).toBe(9.5)
  })
})

describe('banner top clears the fixture bottom (CR-PLC-05, Tyler 8/14)', () => {
  it('the AR suspension pendant pulls the banner ceiling below the pole-top rule', () => {
    // GVX hangs 0.505 m below its mount; AR carries it at +0.143 m — the
    // fixture bottom sits ~1.19 ft below the pole top, so the fixture rule
    // binds. SH1 (+0.514 m socket) leaves the pole-top rule binding.
    const ar = autofillConfig(catalog, {
      ...defaultConfig(catalog),
      fixture: 'gvx-pendant',
      arm: 'willstudio-suspension-arm-pole-top-brackets',
      pole: 'alum-pole-20',
    })
    const bottom = fixtureBottomFt(catalog, ar)!
    expect(bottom).toBeLessThan(20)
    const range = bannerHeightRange(catalog, 20, '24x48', bottom)
    expect(range.maxFt).toBeCloseTo(Math.round((bottom - 1 - 4) * 12) / 12, 5)
    expect(range.maxFt).toBeLessThan(15) // stricter than pole-top ceiling
    const sh1 = { ...ar, arm: 'sh1-shepherds-hook' }
    const sh1Range = bannerHeightRange(catalog, 20, '24x48', fixtureBottomFt(catalog, sh1))
    expect(sh1Range.maxFt).toBe(15) // pole-top rule still binds for SH1
  })

  it('post-top fixtures carry no hangM — the rule stays inert', () => {
    expect(
      fixtureBottomFt(catalog, config({ fixture: 'drx-post-top', arm: 'direct-mount' })),
    ).toBeUndefined()
  })
})

describe('repairConfig — banner-kit placements (Phase 0.11, D1/D3)', () => {
  const withKit = (code: string, size?: string, heightFt = 9) =>
    repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        pole: 'alum-pole-20',
        specOptions: { pole: { accessories: [code] } },
        accessoryPlacements: { [code]: { heightFt, orientation: 0, sides: 1, ...(size ? { size } : {}) } },
      }),
    )

  it('applies the 8 ft banner floor a placement UI once ignored', () => {
    // Pre-0.11 divergence: repairConfig floored banner kits at BANNER_MIN_FT
    // while Panel's slider floored them at 2 ft. Both now use one function.
    expect(withKit('BAX', undefined, 3).accessoryPlacements?.BAX?.heightFt).toBe(8)
  })

  it('reserves the panel height under the pole top', () => {
    // 20 ft pole − 4 ft default panel − 1 ft clearance.
    expect(withKit('BAX', undefined, 99).accessoryPlacements?.BAX?.heightFt).toBe(15)
    // 20 ft pole − 5 ft panel − 1 ft clearance.
    expect(withKit('BAX', '30x60', 99).accessoryPlacements?.BAX?.heightFt).toBe(14)
  })

  it('keeps a size the kit can carry and drops one it cannot', () => {
    // Tyler 8/12: the consolidated BAX kit carries every panel size — the arm
    // length (24"/30") resolves at quote from the chosen banner. The per-kit
    // width gate lives on only as a label-parsing rule (tested above) for
    // sheets that still declare an arm length.
    expect(withKit('BAX', '30x60').accessoryPlacements?.BAX?.size).toBe('30x60')
  })

  it('never stores a panel size on a non-banner accessory', () => {
    const repaired = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        pole: 'alum-pole-12',
        specOptions: { pole: { options: ['FSTR'] } },
        accessoryPlacements: { FSTR: { heightFt: 6, orientation: 0, size: '24x48' } },
      }),
    )
    expect(repaired.accessoryPlacements?.FSTR?.size).toBeUndefined()
  })

  it('a banner reads the same height whichever path configured it', () => {
    // 20 ft pole either way: alum-pole-20 for the kit path, the NAFCO fallback
    // for the legacy path.
    const kit = withKit('BAX', undefined, 99).accessoryPlacements?.BAX?.heightFt
    const nafcoCfg = repairConfig(
      catalog,
      config({ brand: 'NAFCO', fixture: 'nafco-chx-cobrahead', pole: '', arm: '', baseCover: '' }),
    )
    const legacy = repairConfig(catalog, {
      ...nafcoCfg,
      banner: { armId: 'nafco-ba1-banner-arm', count: 1, heightFt: 99 },
    }).banner?.heightFt
    expect(kit).toBe(legacy)
  })
})

describe('centre-feature codes CF1/CF2/CF3 (Phase 0.11, Workstream C)', () => {
  const cfValues = (partId: string) =>
    (partById(catalog, partId)?.options ?? [])
      .flatMap((o) => o.values)
      .filter((v) => /^CF[123]$/.test(v.code))
      .map((v) => v.code)

  it('are transcribed from the arms ordering matrix onto SH1', () => {
    // Display order (Tyler 8/12): Simple, Ornate, then Brand/Logo.
    expect(cfValues('sh1-shepherds-hook')).toEqual(['CF1', 'CF3', 'CF2'])
    const column = partById(catalog, 'sh1-shepherds-hook')!.options!.find(
      (o) => o.key === 'center-feature',
    )!
    expect(column.group).toBe('options-accessories')
    expect(column.values.map((v) => v.label)).toEqual([
      'Simple Decorative Center Feature',
      'Ornate Decorative Center Feature',
      'Brand / Logo / City Round Center Feature',
    ])
    // Bare `CF` = Custom is deliberately excluded (docs/ordering-matrix.json
    // armOptionsNote): a custom feature is a quote conversation, not a code.
    expect(column.values.some((v) => v.code === 'CF')).toBe(false)
  })

  it('appear on exactly the hook family — SH1 and the SS brackets', () => {
    // Tyler 8/12 settled the 0.11 open item: SS DOES take the centre feature.
    const carriers = catalog.parts
      .filter((p) => (p.options ?? []).some((o) => o.values.some((v) => /^CF[123]$/.test(v.code))))
      .map((p) => p.id)
    expect(carriers).toEqual(['sh1-shepherds-hook', 'willstudio-side-shepherds-hook-pole-top-brackets'])
  })

  it('are one exclusive family — and the bare CF on mvx-coach is not in it', () => {
    expect(exclusiveFamily('CF1')).toBe('center-feature')
    expect(exclusiveFamily('CF2')).toBe('center-feature')
    expect(exclusiveFamily('CF3')).toBe('center-feature')
    // mvx-coach's `CF` = "Custom" is a different concept and must not be swept
    // into the family by a loose `^CF` prefix match.
    expect(exclusiveFamily('CF')).toBeUndefined()
    expect(exclusiveFamily('CF4')).toBeUndefined()
    expect(exclusiveFamily('CFL')).toBeUndefined()
  })

  it('repairConfig keeps only one CF code', () => {
    const repaired = repairConfig(
      catalog,
      config({ arm: 'sh1-shepherds-hook', specOptions: { arm: { 'center-feature': ['CF2', 'CF3'] } } }),
    )
    expect(repaired.specOptions?.arm?.['center-feature']).toEqual(['CF2'])
  })

  it('repairConfig keeps a single CF code untouched', () => {
    const repaired = repairConfig(
      catalog,
      config({ arm: 'sh1-shepherds-hook', specOptions: { arm: { 'center-feature': ['CF3'] } } }),
    )
    expect(repaired.specOptions?.arm?.['center-feature']).toEqual(['CF3'])
  })

  it('the mvx-coach bare CF still coexists with its own column-mates', () => {
    const repaired = repairConfig(
      catalog,
      config({ fixture: 'mvx-coach', arm: 'upsweep', specOptions: { fixture: { options: ['CF'] } } }),
    )
    expect(repaired.specOptions?.fixture?.options).toEqual(['CF'])
  })

  it('is offered on the hook family only — guarded, not merely absent elsewhere', () => {
    expect(codeAllowedOnPart(partById(catalog, 'sh1-shepherds-hook'), 'CF1')).toBe(true)
    // Tyler confirmed 8/12: SS takes the logo/centre feature too.
    const ss = partById(catalog, 'willstudio-side-shepherds-hook-pole-top-brackets')
    expect(codeAllowedOnPart(ss, 'CF1')).toBe(true)
    expect(codeAllowedOnPart(partById(catalog, 'upsweep'), 'CF1')).toBe(false)
    expect(codeAllowedOnPart(undefined, 'CF1')).toBe(false)
    // The guard is scoped to the family: unrelated codes stay unaffected.
    expect(codeAllowedOnPart(partById(catalog, 'upsweep'), 'CF')).toBe(true)
    expect(codeAllowedOnPart(partById(catalog, 'drx-post-top'), 'WHP3NP')).toBe(true)
  })

  it('a catalog edit that offers CF on a non-hook arm is rejected by repairConfig', () => {
    // Simulates scripts/merge-ordering.mjs fanning the arms sheet's Options
    // column across all 10 arm families — the exact way this could regress.
    // (SS legitimately carries CF since 8/12, so the crossarm plays the
    // tampered part now.)
    const sh1Column = partById(catalog, 'sh1-shepherds-hook')!.options![0]
    const tampered: Catalog = {
      ...catalog,
      parts: catalog.parts.map((p) =>
        p.id === 'willstudio-fr2-decorative-crossarm' ? { ...p, options: [sh1Column] } : p,
      ),
    }
    const repaired = repairConfig(
      tampered,
      config({
        // A post-top fixture the crossarm can actually carry, so the arm
        // itself survives repair and only the CF selection is judged.
        fixture: 'drx-post-top',
        arm: 'willstudio-fr2-decorative-crossarm',
        specOptions: { arm: { 'center-feature': ['CF1'] } },
      }),
    )
    expect(repaired.arm).toBe('willstudio-fr2-decorative-crossarm')
    expect(repaired.specOptions?.arm).toBeUndefined()
  })
})

describe('finishFor + repairConfig — per-part finishes (Phase 0.10.5)', () => {
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

describe('repairConfig — per-slot spec-option pruning (Phase 0.10.5)', () => {
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
    // Both fixtures have a `design` column, but each offers only its own code:
    // DRX's lists `DRX`, TEX's lists `TEX`. (Phase 0.12 note: this case used to
    // key off TEX having no `design` column at all — it did, merged into
    // `lumen-output` by the spec parser. Splitting that merge gave TEX the same
    // shape as its siblings, so the stale code here had to become one that is
    // genuinely DRX-only rather than the `CH` custom code both accept.)
    const valid = repairConfig(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { design: 'DRX' } },
      }),
    )
    expect(valid.specOptions?.fixture?.design).toBe('DRX')
    const swapped = repairConfig(
      catalog,
      config({
        fixture: 'tex-post-top',
        arm: 'direct-mount',
        specOptions: { fixture: { design: 'DRX' } },
      }),
    )
    expect(swapped.specOptions?.fixture?.design ?? undefined).toBeUndefined()
  })
})

describe('multi-select options & exclusive families (Phase 0.10.5)', () => {
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

describe('voltage → options compatibility (Phase 0.10.5)', () => {
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

describe('cord — required, bracket-derived (CR-OPT-06, Tyler 8/14)', () => {
  it('seeds nothing any more — the cord is derived, not selected', () => {
    for (const id of ['gvx-pendant', 'drx-post-top', 'tex-post-top', 'sh1-shepherds-hook']) {
      expect(defaultSpecOptions(partById(catalog, id)), id).toBeUndefined()
    }
  })

  it('cordCodeFor: WHP7NP standard, per-bracket overrides, pendant-only', () => {
    const base = config({ fixture: 'gvx-pendant' })
    expect(cordCodeFor(catalog, { ...base, arm: 'sh1-shepherds-hook' })).toBe('WHP7NP')
    expect(
      cordCodeFor(catalog, { ...base, arm: 'willstudio-side-shepherds-hook-pole-top-brackets' }),
    ).toBe('WHP7NP')
    // PM1 is a short-drop bracket: 3-ft cord code on the part.
    expect(cordCodeFor(catalog, { ...base, arm: 'pm1-pendant-arm' })).toBe('WHP3NP')
    // No arm chosen, non-pendant fixture, pseudo-arm: no cord.
    expect(cordCodeFor(catalog, { ...base, arm: '' })).toBeUndefined()
    expect(
      cordCodeFor(catalog, config({ fixture: 'drx-post-top', arm: 'direct-mount' })),
    ).toBeUndefined()
  })

  it('the specDefaults mechanism still works (dormant)', () => {
    const gvx = partById(catalog, 'gvx-pendant')!
    expect(defaultSpecOptions({ ...gvx, specDefaults: { 'lumen-output': '115' } })).toEqual({
      'lumen-output': '115',
    })
  })

  it('defaultConfig seeds the default fixture\'s own spec-sheet defaults', () => {
    // Phase 0.12 (D): this used to assert the WHP7NP cord specifically, because
    // the default fixture was drx-post-top. DRX left the cut on 8/11, so the
    // builder now opens on TEX and the cord is not its default. The RULE — the
    // default config carries whatever that fixture's sheet defaults to — is what
    // matters, and the DRX cord itself is still pinned directly in the test
    // above, which needs no repair to hold.
    const cfg = defaultConfig(catalog)
    const fixture = partById(catalog, cfg.fixture)
    expect(cfg.specOptions?.fixture).toEqual(defaultSpecOptions(fixture))
    // Still a stable, fully valid config.
    expect(repairConfig(catalog, cfg)).toEqual(cfg)
  })
})

describe('custom RAL color (Phase 0.10.5)', () => {
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

describe('SH1 shepherd’s hook is single-arm only (Phase 0.10.5)', () => {
  it('offers no multi-arm counts for SH1 on any pole', () => {
    expect(allowedArmCounts(catalog, config({ arm: 'sh1-shepherds-hook', pole: 'alum-pole-20' }))).toEqual([1])
  })

  it('repairConfig clamps an old multi-arm SH1 share link to single', () => {
    const repaired = repairConfig(catalog, config({ arm: 'sh1-shepherds-hook', armCount: 4 }))
    expect(repaired.armCount).toBe(1)
  })
})

describe('official arm configuration list (Phase 0.10.5)', () => {
  const CASES: [string, number[]][] = [
    ['sh1-shepherds-hook', [1]],
    // Tyler 8/12: SS/AR brackets sell as Single + Twin in the configurator
    // (SS3/SS4 + AR3/AR4 modelCodes stay in the catalog for SKU resolution).
    ['willstudio-side-shepherds-hook-pole-top-brackets', [1, 2]],
    ['willstudio-supported-decorative-arms', [1, 2]],
    ['willstudio-suspension-arm-pole-top-brackets', [1, 2]],
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
    // Phase 0.12 (D): several of these arms are now Coming Soon, and
    // repairConfig deliberately refuses to REST on one (see the availability
    // filter there). This case is about the official arm-count table, not
    // availability, so the arm is pinned back after the other slots repair.
    // `availabilityConfig.test.ts` covers the un-selectability itself.
    const cfg = { ...repairConfig(catalog, config({ fixture, arm: armId, pole: 'alum-pole-20' })), arm: armId }
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

describe('arm orientation (Phase 0.10.5)', () => {
  it('repairConfig keeps valid orientations and normalizes 0 to unset', () => {
    expect(repairConfig(catalog, config({ armOrientation: 90 })).armOrientation).toBe(90)
    expect(repairConfig(catalog, config({ armOrientation: 270 })).armOrientation).toBe(270)
    expect(repairConfig(catalog, config({ armOrientation: 0 })).armOrientation).toBeUndefined()
  })

  it('repairConfig resets a tampered orientation', () => {
    expect(repairConfig(catalog, config({ armOrientation: 45 })).armOrientation).toBeUndefined()
  })
})

describe('pole heights + diameter column (Phase 0.10.5)', () => {
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

describe('pole base configuration columns (Phase 0.10.5)', () => {
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

describe('anodized finishes are pole-only (Phase 0.10.5)', () => {
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

describe('accessory placements (Phase 0.10.5)', () => {
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
    // The consolidated BAX banner kit is placeable too (height + orientation).
    const withBa = repairConfig(catalog, { ...withFstr(), specOptions: { pole: { accessories: ['BAX'] } } })
    expect(placeableAccessoryCodes(catalog, withBa)).toEqual(['BAX'])
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

describe('accessory placement sides (Phase 0.10.5)', () => {
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
      specOptions: { pole: { options: ['FSTR'], accessories: ['BAX', 'FH'] } },
    })
    const repaired = repairConfig(catalog, {
      ...base,
      accessoryPlacements: {
        BAX: { heightFt: 10, orientation: 90, sides: 4 },
        FH: { heightFt: 8, orientation: 0, sides: 4 }, // FH allows 1|2 → clamps to 1
        FSTR: { heightFt: 6, orientation: 0, sides: 2 }, // FSTR has no sides → stripped
      },
    })
    expect(repaired.accessoryPlacements?.BAX?.sides).toBe(4)
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
