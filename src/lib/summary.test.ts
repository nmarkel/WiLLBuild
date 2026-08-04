import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { buildPartNumber, buildSummaryText } from './summary'
import { paramsToPartialConfig } from './url'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test-config-123',
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

describe('buildSummaryText', () => {
  it('includes config ID', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('Config ID: test-config-123')
  })

  it('includes all parts, each with its own finish (Phase 1.0)', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('Fixture: GVX Pendant — Matte Black')
    expect(summary).toContain('Arm: SH1 Shepherds Hook — Matte Black')
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Matte Black')
    expect(summary).toContain('Base Cover: Fluted Base Cover — Matte Black')
  })

  it('a per-slot finish override shows on that part only', () => {
    const summary = buildSummaryText(catalog, config({ finishes: { pole: 'silver' } }))
    expect(summary).toContain('Pole: 14 ft Decorative Aluminum — Silver')
    expect(summary).toContain('Fixture: GVX Pendant — Matte Black')
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

  it('returns undefined for parts without a parsed ordering table', () => {
    expect(buildPartNumber(catalog, config({}), 'arm')).toBeUndefined()
    expect(buildPartNumber(catalog, config({}), 'baseCover')).toBeUndefined()
  })

  it('is included in the summary text as a Part No line', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('  Part No: WD-GVX-_-_-_-_-BK')
  })
})
