import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { repairConfig } from './compat'
import {
  designsForCount,
  isMultiSelectOption,
  multiSelectColumns,
  partNumbersText,
  resolveAssemblyPartNumbers,
  resolvePartNumber,
  mergedMultiSelectFields,
  singleSelectColumns,
  unresolvedCount,
} from './partNumber'

// Workstream 0 runs against the REAL catalog — the part number is the primary
// deliverable, so these assertions are about shipped data, not fixtures.
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

const SS = 'willstudio-side-shepherds-hook-pole-top-brackets'
const AR = 'willstudio-suspension-arm-pole-top-brackets'

function config(overrides: Partial<PoleConfig> = {}): PoleConfig {
  return repairConfig(catalog, {
    configId: 'pn-test',
    brand: 'WiLLstudio',
    pole: 'alum-pole-20',
    baseCover: 'bc-fluted',
    arm: SS,
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
    armCount: 1,
    ...overrides,
  })
}

describe('arm part numbers — [Family]-[Design]-[Fit]-[Finish]', () => {
  it('resolves Side Shepherds Hook + 3 arms to WP-SS3-40F-BK', () => {
    const cfg = config({ arm: SS, armCount: 3 })
    const number = resolvePartNumber(catalog, cfg, SS)
    expect(number.code).toBe('WP-SS3-40F-BK')
    expect(number.complete).toBe(true)
    expect(number.unavailable).toBeNull()
  })

  it('the arm count drives the design digit (SS1/SS2/SS3/SS4)', () => {
    for (const [count, design] of [
      [1, 'SS1'],
      [2, 'SS2'],
      [3, 'SS3'],
      [4, 'SS4'],
    ] as const) {
      const cfg = config({ arm: SS, armCount: count })
      expect(resolvePartNumber(catalog, cfg, SS).code).toBe(`WP-${design}-40F-BK`)
    }
  })

  it('the suspension family uses AR codes — the doc example WP-AR2-…', () => {
    const cfg = config({ arm: AR, armCount: 2 })
    const number = resolvePartNumber(catalog, cfg, AR)
    expect(number.code).toBe('WP-AR2-40F-BK')
  })

  it('the finish segment follows the assembly finish', () => {
    for (const [finish, code] of [
      ['matte-black', 'BK'],
      ['statuary-bronze', 'DB'],
      ['forest-green', 'DG'],
      ['gloss-white', 'WH'],
      ['silver', 'NA'],
    ] as const) {
      const cfg = config({ arm: SS, armCount: 1, finish })
      expect(resolvePartNumber(catalog, cfg, SS).code).toBe(`WP-SS1-40F-${code}`)
    }
  })

  it('SH1 is single-only, and its number carries the SH1 design', () => {
    const cfg = config({ arm: 'sh1-shepherds-hook', armCount: 3 })
    expect(cfg.armCount).toBe(1) // repaired: SH1 cannot cluster
    expect(resolvePartNumber(catalog, cfg, 'sh1-shepherds-hook').code).toBe('WP-SH1-40F-BK')
  })

  it('a fixed-pair crossarm resolves to CR2', () => {
    const cfg = config({ fixture: 'drx-post-top', arm: 'willstudio-cr2-decorative-crossarm' })
    expect(resolvePartNumber(catalog, cfg, 'willstudio-cr2-decorative-crossarm').code).toBe('WP-CR2-40F-BK')
  })

  it('appends selected part-number-bearing options (CF codes)', () => {
    const cfg = config({ arm: SS, armCount: 2, partOptions: { [SS]: { addOns: ['CF1'] } } })
    expect(resolvePartNumber(catalog, cfg, SS).code).toBe('WP-SS2-40F-BK-CF1')
  })

  it('multiple add-ons all append, in matrix order', () => {
    const cfg = config({ arm: SS, armCount: 2, partOptions: { [SS]: { addOns: ['CF2', 'CF1'] } } })
    expect(resolvePartNumber(catalog, cfg, SS).code).toBe('WP-SS2-40F-BK-CF1-CF2')
  })

  it('leaves the design unresolved when a family has several designs for one count', () => {
    // Upsweep: BR12 (24") and BR13 (36") are both single-arm — the customer picks.
    const cfg = config({ fixture: 'mvx-coach', arm: 'upsweep', armCount: 1 })
    const number = resolvePartNumber(catalog, cfg, 'upsweep')
    expect(number.code).toBe('WP-?-40F-BK')
    expect(number.complete).toBe(false)
    expect(unresolvedCount(number)).toBe(1)
    expect(designsForCount(catalog.parts.find((p) => p.id === 'upsweep')!, 1).map((d) => d.code)).toEqual([
      'BR12',
      'BR13',
    ])
  })

  it('resolves once the customer picks that design', () => {
    const cfg = config({
      fixture: 'mvx-coach',
      arm: 'upsweep',
      armCount: 2,
      partOptions: { upsweep: { codes: { design: 'BR23' } } },
    })
    const number = resolvePartNumber(catalog, cfg, 'upsweep')
    expect(number.code).toBe('WP-BR23-40F-BK')
    expect(number.complete).toBe(true)
  })
})

describe('fixture part numbers — from the parsed spec sheet', () => {
  it('follows the sheet column order and fills chosen codes', () => {
    const cfg = config({
      fixture: 'gvx-pendant',
      partOptions: {
        'gvx-pendant': {
          codes: {
            design: 'GVX',
            'lumen-output': '80',
            'color-temp': '30',
            voltage: 'MV',
            distribution: '5W',
            mounting: 'PM',
          },
        },
      },
    })
    // The GVX sheet's own example order code is WD-GVX-80-30-MV-5W-BK-PM.
    const number = resolvePartNumber(catalog, cfg, 'gvx-pendant')
    expect(number.code).toBe('WD-GVX-80-30-MV-5W-BK-PM')
    expect(number.complete).toBe(true)
  })

  it('marks unchosen columns with ? and counts them', () => {
    const number = resolvePartNumber(catalog, config(), 'gvx-pendant')
    expect(number.code).toBe('WD-?-?-?-?-?-BK-?')
    expect(number.complete).toBe(false)
    expect(unresolvedCount(number)).toBe(6)
  })

  it('never offers a finish column as a dropdown — the Finish step owns it', () => {
    const gvx = catalog.parts.find((p) => p.id === 'gvx-pendant')!
    expect(singleSelectColumns(gvx).some((c) => c.key.includes('finish'))).toBe(false)
    const number = resolvePartNumber(catalog, config({ finish: 'silver' }), 'gvx-pendant')
    expect(number.segments.find((s) => s.source === 'finish')?.code).toBe('NA')
  })

  it('spec add-ons append after the ordering columns', () => {
    const cfg = config({
      partOptions: { 'gvx-pendant': { codes: { design: 'GVX' }, addOns: ['HSS-GVX'] } },
    })
    expect(resolvePartNumber(catalog, cfg, 'gvx-pendant').code).toMatch(/-HSS-GVX$/)
  })

  it('flags a sheet whose parse needs human review', () => {
    expect(resolvePartNumber(catalog, config({ fixture: 'drx-post-top' }), 'drx-post-top').parseFlagged).toBe(
      true,
    )
    expect(resolvePartNumber(catalog, config(), 'gvx-pendant').parseFlagged).toBe(false)
  })
})

describe('products with no ordering matrix', () => {
  it('the curated fluted base cover reports a pending matrix instead of a guess', () => {
    const number = resolvePartNumber(catalog, config(), 'bc-fluted')
    expect(number.code).toBe('')
    expect(number.unavailable).toMatch(/pending/i)
  })

  it('a NAFCO arm gets no fabricated WiLLstudio number', () => {
    const cfg = repairConfig(catalog, { ...config(), brand: 'NAFCO' })
    for (const number of resolveAssemblyPartNumbers(catalog, cfg)) {
      expect(number.code === '' || number.unavailable === null).toBe(true)
      if (number.unavailable === null) expect(number.code).not.toContain('WP-')
    }
  })
})

describe('base cover part number (pole-fit derived from the pole shaft)', () => {
  it('resolves the aluminium cover against a 4in shaft: WP-CL2-40-BK', () => {
    const cfg = config({ baseCover: 'aluminum-light-pole-base-covers' })
    expect(resolvePartNumber(catalog, cfg, 'aluminum-light-pole-base-covers').code).toBe('WP-CL2-40-BK')
  })
})

describe('resolveAssemblyPartNumbers', () => {
  it('returns one number per component, in selection order', () => {
    const numbers = resolveAssemblyPartNumbers(catalog, config())
    expect(numbers.map((n) => n.slotLabel)).toEqual(['Fixture', 'Arm', 'Pole', 'Base Cover'])
  })

  it('includes the banner accessory when one is fitted', () => {
    const cfg = config({ banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt: 8 } })
    expect(resolveAssemblyPartNumbers(catalog, cfg).map((n) => n.slotLabel)).toContain('Banner Arm')
  })

  it('skips a component that is not selected (no base cover)', () => {
    const numbers = resolveAssemblyPartNumbers(catalog, config({ baseCover: '' }))
    expect(numbers.map((n) => n.slotLabel)).toEqual(['Fixture', 'Arm', 'Pole'])
  })

  it('renders a copyable text block', () => {
    const lines = partNumbersText(resolveAssemblyPartNumbers(catalog, config({ armCount: 2 })))
    expect(lines.some((l) => l.startsWith('Arm: WP-SS2-40F-BK'))).toBe(true)
    expect(lines.some((l) => l.includes('pending matrix'))).toBe(true)
  })
})

describe('multi-select rule (Workstream B)', () => {
  it('Options and Accessories are multi-select; ordering columns are not', () => {
    const gvx = catalog.parts.find((p) => p.id === 'gvx-pendant')!
    expect(multiSelectColumns(gvx).map((c) => c.key)).toEqual(['options', 'accessories'])
    for (const column of singleSelectColumns(gvx)) expect(isMultiSelectOption(column)).toBe(false)
  })

  it('the split Options columns on the DRX sheet are both multi-select', () => {
    const drx = catalog.parts.find((p) => p.id === 'drx-post-top')!
    expect(multiSelectColumns(drx).map((c) => c.key)).toEqual(['options', 'options-2', 'accessories'])
  })
})

describe('pole part numbers (the wide, partially-merged sheet)', () => {
  it('treats "Finish Type" as a real choice, not the finish colour', () => {
    // The decorative-pole sheet has BOTH `anchor-bolts-base-type-finish-type`
    // (painted vs anodized — a customer choice) and `finish-color` (BK/DB/…).
    // Only the latter is driven by the Finish step.
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-20')!
    const keys = singleSelectColumns(pole).map((c) => c.key)
    expect(keys).toContain('anchor-bolts-base-type-finish-type')
    expect(keys).not.toContain('finish-color')
    const number = resolvePartNumber(catalog, config({ pole: 'alum-pole-20' }), 'alum-pole-20')
    // Exactly one finish segment, and it is the assembly finish.
    expect(number.segments.filter((s) => s.source === 'finish')).toHaveLength(1)
    expect(number.code.split('-').filter((s) => s === 'BK')).toHaveLength(1)
  })

  it('resolves fully once every pole column is chosen', () => {
    const cfg = config({
      pole: 'alum-pole-20',
      partOptions: {
        'alum-pole-20': {
          codes: {
            design: 'RSAA',
            'length-pole-base-pole-top-wall-od-od-thickness': '40',
            'anchor-bolts-base-type-finish-type': 'AB',
            'fixture-mounting': 'D6',
          },
        },
      },
    })
    const number = resolvePartNumber(catalog, cfg, 'alum-pole-20')
    expect(number.code).toBe('WP-RSAA-40-AB-BK-D6')
    expect(number.complete).toBe(true)
  })
})

describe('one Options field, not two (sheet-layout artifact)', () => {
  it('merges the DRX sheet’s split Options columns into a single field', () => {
    const drx = catalog.parts.find((p) => p.id === 'drx-post-top')!
    const fields = mergedMultiSelectFields(drx)
    expect(fields.map((f) => f.label)).toEqual(['Options', 'Accessories'])
    const options = fields[0]
    const split = multiSelectColumns(drx).filter((c) => c.label === 'Options')
    expect(split).toHaveLength(2) // parser emits options + options-2
    expect(options.values.length).toBe(split[0].values.length + split[1].values.length)
  })

  it('leaves an already-single Options column alone', () => {
    const gvx = catalog.parts.find((p) => p.id === 'gvx-pendant')!
    expect(mergedMultiSelectFields(gvx).map((f) => f.label)).toEqual(['Options', 'Accessories'])
  })
})
