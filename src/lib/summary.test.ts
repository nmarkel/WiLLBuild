import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { armAzimuths, defaultConfig, repairConfig } from './compat'
import { armArrangementLabel, buildPartNumber, buildSummaryText } from './summary'
import { paramsToPartialConfig } from './url'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test-config-123',
    brand: 'WiLLstudio',
    pole: 'alum-pole-14',
    baseCover: 'bc-cl2-medium-clamshell',
    arm: 'sh1-shepherds-hook',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
    ...overrides,
  }
}

describe('buildSummaryText', () => {
  it('includes config ID', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('Config ID: test-config-123')
  })

  it('includes all parts, each with its own finish (Phase 0.10.5)', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('Fixture: GVX Pendant — Black')
    expect(summary).toContain('Arm: SH1 Shepherds Hook — Black')
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Black')
    expect(summary).toContain('Base Cover: Medium Clamshell Cast Base Cover — Black')
  })

  it('a per-slot finish override shows on that part only', () => {
    const summary = buildSummaryText(catalog, config({ finishes: { pole: 'silver' } }))
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Nat Alum Silver')
    expect(summary).toContain('Fixture: GVX Pendant — Black')
  })

  it('indents a part’s spec-sheet choices under the part', () => {
    const summary = buildSummaryText(
      catalog,
      config({ specOptions: { fixture: { 'lumen-output': '100' } } }),
    )
    const lines = summary.split('\n')
    const fixtureIdx = lines.findIndex((l) => l.startsWith('Fixture:'))
    const optLine = lines.findIndex((l) => l.startsWith('  ') && l.includes('100'))
    expect(fixtureIdx).toBeGreaterThanOrEqual(0)
    expect(optLine).toBe(fixtureIdx + 1)
  })

  it('round-trips the share URL with config params', () => {
    const testConfig = config({})
    const summary = buildSummaryText(catalog, testConfig)

    // Extract the URL line from summary
    const lines = summary.split('\n')
    const linkLine = lines.find((line) => line.startsWith('Link:'))
    expect(linkLine).toBeDefined()

    // Extract query string from "Link: ?param=val&..." format
    const linkUrl = linkLine!.substring('Link: '.length)
    const queryString = linkUrl.substring(linkUrl.indexOf('?') + 1)
    const params = new URLSearchParams(queryString)

    // Parse the params back to partial config
    const parsed = paramsToPartialConfig(params)
    expect(parsed).toBeDefined()

    // Assert the parsed config matches the original values
    expect(parsed!.pole).toBe(testConfig.pole)
    expect(parsed!.baseCover).toBe(testConfig.baseCover)
    expect(parsed!.arm).toBe(testConfig.arm)
    expect(parsed!.fixture).toBe(testConfig.fixture)
    expect(parsed!.finish).toBe(testConfig.finish)
  })
})

describe('buildPartNumber (Phase 0.10.5)', () => {
  it('assembles base config in sheet order with implied family/design/finish', () => {
    // Nothing chosen: WD (single-value family) - GVX (part card) - four open
    // columns - BK (matte-black via mapsTo).
    const pn = buildPartNumber(catalog, config({}), 'fixture')
    expect(pn).toBe('WD-GVX-_-_-_-_-BK-WHP7NP')
  })

  it('fills chosen base-config codes and tracks the per-part finish', () => {
    const pn = buildPartNumber(
      catalog,
      config({
        finishes: { fixture: 'silver' },
        specOptions: { fixture: { 'lumen-output': '80', 'color-temp': '30', voltage: 'MV' } },
      }),
      'fixture',
    )
    expect(pn).toBe('WD-GVX-80-30-MV-_-NA-WHP7NP')
  })

  it('appends options and accessories codes with a dash each', () => {
    const pn = buildPartNumber(
      catalog,
      config({
        specOptions: {
          fixture: { options: ['WHP7NP', 'SRG27710'], accessories: ['HSS-GVX'] },
        },
      }),
      'fixture',
    )
    // Chosen cord codes are ignored (derived cord rides at the end);
    // legacy concrete codes like SRG27710 pass through untouched.
    expect(pn).toBe('WD-GVX-_-_-_-_-BK-SRG27710-HSS-GVX-WHP7NP')
  })

  it('returns undefined for an empty or unknown selection', () => {
    expect(buildPartNumber(catalog, config({ baseCover: '' }), 'baseCover')).toBeUndefined()
    // The upsweep still has no model codes (24"/36" length model pending).
    expect(buildPartNumber(catalog, config({ fixture: 'mvx-coach', arm: 'upsweep' }), 'arm')).toBeUndefined()
  })

  it('is included in the summary text as a Part No line', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('  Part No: WD-GVX-_-_-_-_-BK')
  })
})

describe('custom RAL in summary + part number (Phase 0.10.5)', () => {
  it('quote text carries the picked RAL hex', () => {
    const summary = buildSummaryText(
      catalog,
      config({ finishes: { pole: 'custom-ral' }, finishRal: { pole: '#1a2b3c' } }),
    )
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Custom RAL Match (#1A2B3C)')
  })

  it('part number uses the palette code for finishes newer than the parsed sheet', () => {
    const pn = buildPartNumber(catalog, config({ finishes: { fixture: 'custom-ral' } }), 'fixture')
    expect(pn).toBe('WD-GVX-_-_-_-_-RAL-WHP7NP')
  })
})

describe('arm model code as part number (Phase 0.10.5)', () => {
  it('uses the official code for the chosen count', () => {
    const cfg = config({
      fixture: 'gvx-pendant',
      arm: 'willstudio-suspension-arm-pole-top-brackets',
      armCount: 3,
    })
    // Tyler 8/12: the arm's finish colour joins its number.
    expect(buildPartNumber(catalog, cfg, 'arm')).toBe('WP-AR3-BK')
    expect(buildSummaryText(catalog, cfg)).toContain('  Part No: WP-AR3-BK')
  })

  it('single-only arms report their fixed code', () => {
    expect(buildPartNumber(catalog, config({ arm: 'sh1-shepherds-hook' }), 'arm')).toBe('WP-SH1-BK')
  })

  it('the upsweep has no code yet (24"/36" length model pending)', () => {
    expect(buildPartNumber(catalog, config({ fixture: 'mvx-coach', arm: 'upsweep' }), 'arm')).toBeUndefined()
  })
})

describe('pole part number — fixed and derived segments (Phase 0.10.5)', () => {
  it('carries AB/SB and a color-derived finish type', () => {
    const cfg = config({
      finishes: { pole: 'slate-gray' },
      specOptions: { pole: { 'pole-diameter': '5050', 'wall-thickness': 'D' } },
    })
    // product-family(WP) design(RSAA) length(14, from part.heightFt) diameter
    // wall AB SB FP color(SG) mounting(_)
    expect(buildPartNumber(catalog, cfg, 'pole')).toBe('WP-RSAA-14-5050-D-AB-SB-FP-SG')
  })

  it('an anodized color flips the finish type to AN', () => {
    const cfg = config({ finishes: { pole: 'black-anodized' } })
    expect(buildPartNumber(catalog, cfg, 'pole')).toBe('WP-RSAA-14-_-_-AB-SB-AN-BKA')
  })
})

describe('buildPartNumber — pole (8/4 spec sheet target)', () => {
  // WP-RSAA-16-5050-D-AB-SB-FP-BK-PL
  //  |    |    |    |  |  |  |  |  |
  //  |    |    |    |  |  |  |  |  fixture-mounting
  //  |    |    |    |  |  |  |  finish-color
  //  |    |    |    |  |  |  finish-type
  //  |    |    |    |  |  base-type
  //  |    |    |    |  anchor-bolts
  //  |    |    |    wall-thickness
  //  |    |    pole-diameter
  //  |    length (from part.heightFt)
  //  design
  it('fills design and length from the pole itself', () => {
    const base = repairConfig(catalog, defaultConfig(catalog, 'WiLLstudio'))
    const config = repairConfig(catalog, {
      ...base,
      pole: 'alum-pole-16',
      finish: 'matte-black',
      specOptions: {
        ...base.specOptions,
        pole: {
          'pole-diameter': '5050',
          'wall-thickness': 'D',
          'fixture-mounting': 'PL',
        },
      },
    })
    expect(buildPartNumber(catalog, config, 'pole')).toBe(
      'WP-RSAA-16-5050-D-AB-SB-FP-BK-PL',
    )
  })

  it('reflects the height in the length segment', () => {
    const base = repairConfig(catalog, defaultConfig(catalog, 'WiLLstudio'))
    for (const [poleId, expectedLength] of [
      ['alum-pole-12', '12'],
      ['alum-pole-20', '20'],
    ] as const) {
      const config = repairConfig(catalog, { ...base, pole: poleId })
      expect(buildPartNumber(catalog, config, 'pole')).toContain(`-${expectedLength}-`)
    }
  })
})

describe('accessory placement in summary (Phase 0.10.5)', () => {
  it('placed accessories carry their shaft position', () => {
    const summary = buildSummaryText(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        pole: 'alum-pole-12',
        specOptions: { pole: { options: ['FSTR'] } },
        accessoryPlacements: { FSTR: [{ heightFt: 6, orientation: 90 }] },
      }),
    )
    expect(summary).toContain('FSTR — Festoon Power Provision')
    // Phase 0.11 (D): the height now states what it measures to. A bare
    // "6 ft" is the ambiguity the centre-vs-bottom bug hid behind.
    expect(summary).toContain('— placed 6 ft to bottom @ 90°')
    // A festoon is not a banner kit, so it gets no panel-size clause.
    expect(summary).not.toContain('panel')
  })
})

describe('base cover part number (Phase 0.10.5)', () => {
  it('assembles WP-design-poleFit-color per the sheet ordering example', () => {
    const cfg = config({
      baseCover: 'bc-cl2-medium-clamshell',
      finishes: { baseCover: 'matte-black' },
      // Tyler 8/12: Pole Fit is a FUNCTION of the pole's diameter, never a
      // customer choice — an explicitly chosen code (old share URL) is
      // ignored, and the derived fit rides at the END, after the colour.
      specOptions: { baseCover: { 'pole-fit': '5R' } },
    })
    expect(buildPartNumber(catalog, cfg, 'baseCover')).toBe('WP-CL2-4R-BK')
  })
})

describe('banner arm summary line (Phase 0.10.5)', () => {
  // Finding 1 (Task 3 review): buildSummaryText used to emit an undimensioned
  // "Banner arm: <name> — 2-side @ 8 ft" line — the same class of bug as the
  // arm-arrangement label: quote text disagreeing with the PDF and the widget.
  // It must now go through bannerSummaryLine so the clipboard text carries the
  // derived banner height + both bar heights, matching generation.py's summary.
  it('carries the ordered panel size and the derived bar heights', () => {
    // Phase 0.11 (D): the line now names the ORDERED panel (24x48 default)
    // rather than the placeholder solid's 49 in, and states that the
    // configured height is measured to the banner's bottom.
    const summary = buildSummaryText(
      catalog,
      config({ banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt: 8 } }),
    )
    expect(summary).toContain(
      'Banner arm: BA1 Banner Arm — opposite pair, 24 × 48 in panel, banner height 48 in',
    )
    expect(summary).toContain("bottom of banner 8'-0\"")
    expect(summary).toMatch(/top bar \d+'-\d+"/)
    expect(summary).toMatch(/bottom bar \d+'-\d+"/)
  })

  it('the stated bottom height is the height the customer configured', () => {
    // The bug this workstream fixes: an 8 ft "height" used to put the banner's
    // BOTTOM at ~6 ft while the app reported it compliant.
    for (const heightFt of [8, 10, 12]) {
      const summary = buildSummaryText(
        catalog,
        config({ banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt } }),
      )
      expect(summary).toContain(`bottom of banner ${heightFt}'-0"`)
    }
  })

  it('falls back to the plain line for an unknown banner armId', () => {
    const summary = buildSummaryText(
      catalog,
      config({ banner: { armId: 'not-a-real-part', count: 2, heightFt: 8 } }),
    )
    expect(summary).toContain('Banner arm: not-a-real-part — 2-side @ 8 ft')
  })
})

describe('armArrangementLabel', () => {
  // Phase 0.10.5: arms mount on a 90° drilled tenon, so a triple is 3 @ 90°,
  // not 120°. The label must not contradict armAzimuths or the render.
  it('describes the same angles the geometry actually uses', () => {
    for (const count of [2, 3, 4]) {
      const azimuths = armAzimuths(count)
      const gaps = azimuths.slice(1).map((a, i) => a - azimuths[i])
      const step = Math.min(...gaps)
      expect(armArrangementLabel(count)).toContain(`${step}°`)
    }
  })

  it('labels a triple as 90°, matching the drilled tenon', () => {
    expect(armAzimuths(3)).toEqual([0, 90, 180])
    expect(armArrangementLabel(3)).toBe('Triple (3 @ 90°)')
  })
})
