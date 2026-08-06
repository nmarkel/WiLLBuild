import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { armAzimuths } from './compat'
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

  it('includes all parts, each with its own finish (Phase 1.0)', () => {
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

describe('buildPartNumber (Phase 1.0)', () => {
  it('assembles base config in sheet order with implied family/design/finish', () => {
    // Nothing chosen: WD (single-value family) - GVX (part card) - four open
    // columns - BK (matte-black via mapsTo).
    const pn = buildPartNumber(catalog, config({}), 'fixture')
    expect(pn).toBe('WD-GVX-_-_-_-_-BK')
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
    expect(pn).toBe('WD-GVX-80-30-MV-_-NA')
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
    expect(pn).toBe('WD-GVX-_-_-_-_-BK-WHP7NP-SRG27710-HSS-GVX')
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

describe('custom RAL in summary + part number (Phase 1.1)', () => {
  it('quote text carries the picked RAL hex', () => {
    const summary = buildSummaryText(
      catalog,
      config({ finishes: { pole: 'custom-ral' }, finishRal: { pole: '#1a2b3c' } }),
    )
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Custom RAL Match (#1A2B3C)')
  })

  it('part number uses the palette code for finishes newer than the parsed sheet', () => {
    const pn = buildPartNumber(catalog, config({ finishes: { fixture: 'custom-ral' } }), 'fixture')
    expect(pn).toBe('WD-GVX-_-_-_-_-RAL')
  })
})

describe('arm model code as part number (Phase 1.0)', () => {
  it('uses the official code for the chosen count', () => {
    const cfg = config({
      fixture: 'gvx-pendant',
      arm: 'willstudio-suspension-arm-pole-top-brackets',
      armCount: 3,
    })
    expect(buildPartNumber(catalog, cfg, 'arm')).toBe('AR3')
    expect(buildSummaryText(catalog, cfg)).toContain('  Part No: AR3')
  })

  it('single-only arms report their fixed code', () => {
    expect(buildPartNumber(catalog, config({ arm: 'sh1-shepherds-hook' }), 'arm')).toBe('SH1')
  })

  it('the upsweep has no code yet (24"/36" length model pending)', () => {
    expect(buildPartNumber(catalog, config({ fixture: 'mvx-coach', arm: 'upsweep' }), 'arm')).toBeUndefined()
  })
})

describe('pole part number — fixed and derived segments (Phase 1.0)', () => {
  it('carries AB/SB and a color-derived finish type', () => {
    const cfg = config({
      finishes: { pole: 'slate-gray' },
      specOptions: { pole: { 'pole-diameter': '5050', 'wall-thickness': 'D' } },
    })
    // product-family(WP) design(_) diameter wall AB SB FP color(SG) mounting(_)
    expect(buildPartNumber(catalog, cfg, 'pole')).toBe('WP-_-5050-D-AB-SB-FP-SG-_')
  })

  it('an anodized color flips the finish type to AN', () => {
    const cfg = config({ finishes: { pole: 'black-anodized' } })
    expect(buildPartNumber(catalog, cfg, 'pole')).toBe('WP-_-_-_-AB-SB-AN-BKA-_')
  })
})

describe('accessory placement in summary (Phase 1.0)', () => {
  it('placed accessories carry their shaft position', () => {
    const summary = buildSummaryText(
      catalog,
      config({
        fixture: 'drx-post-top',
        arm: 'direct-mount',
        pole: 'alum-pole-12',
        specOptions: { pole: { options: ['FSTR'] } },
        accessoryPlacements: { FSTR: { heightFt: 6, orientation: 90 } },
      }),
    )
    expect(summary).toContain('FSTR — Festoon Provision')
    expect(summary).toContain('— placed 6 ft @ 90°')
  })
})

describe('base cover part number (Phase 1.0)', () => {
  it('assembles WP-design-poleFit-color per the sheet ordering example', () => {
    const cfg = config({
      baseCover: 'bc-cl2-medium-clamshell',
      finishes: { baseCover: 'matte-black' },
      specOptions: { baseCover: { 'pole-fit': '5R' } },
    })
    expect(buildPartNumber(catalog, cfg, 'baseCover')).toBe('WP-CL2-5R-BK')
  })
})

describe('banner arm summary line (Phase 0.10.5)', () => {
  // Finding 1 (Task 3 review): buildSummaryText used to emit an undimensioned
  // "Banner arm: <name> — 2-side @ 8 ft" line — the same class of bug as the
  // arm-arrangement label: quote text disagreeing with the PDF and the widget.
  // It must now go through bannerSummaryLine so the clipboard text carries the
  // derived banner height + both bar heights, matching generation.py's summary.
  it('carries the derived dimensions and matches the Python wording ("opposite pair")', () => {
    const summary = buildSummaryText(
      catalog,
      config({ banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt: 8 } }),
    )
    expect(summary).toContain('Banner arm: BA1 Banner Arm — opposite pair, banner height 49 in')
    expect(summary).toMatch(/top bar \d+'-\d+"/)
    expect(summary).toMatch(/bottom bar \d+'-\d+"/)
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
