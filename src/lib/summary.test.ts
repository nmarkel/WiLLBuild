import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { buildSummaryText } from './summary'
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

  it('includes all parts and finish', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toContain('Fixture:')
    expect(summary).toContain('Arm:')
    expect(summary).toContain('Pole:')
    expect(summary).toContain('Base Cover:')
    expect(summary).toContain('Finish:')
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

// ---- Phase 0.10 (Workstream 0): the part number leads the summary ----

describe('buildSummaryText — part numbers', () => {
  const SS = 'willstudio-side-shepherds-hook-pole-top-brackets'

  it('leads with the part-number block', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary.startsWith('Part numbers:')).toBe(true)
  })

  it('includes each component’s resolved number', () => {
    const summary = buildSummaryText(catalog, config({ arm: SS, armCount: 2 }))
    expect(summary).toContain('Arm: WP-SS2-40F-BK')
  })

  it('says a number is incomplete rather than pretending it is spec-able', () => {
    const summary = buildSummaryText(catalog, config({}))
    expect(summary).toMatch(/Fixture: WD-.*choices to complete/)
  })

  it('labels banner height and both bar distances', () => {
    const summary = buildSummaryText(
      catalog,
      config({ banner: { armId: 'willstudio-ba1-banner-arm', count: 2, heightFt: 8 } }),
    )
    expect(summary).toContain('banner height 49 in')
    expect(summary).toMatch(/top bar \d+'-\d+"/)
    expect(summary).toMatch(/bottom bar \d+'-\d+"/)
  })

  it('reports the triple arrangement as 3 @ 90°', () => {
    const summary = buildSummaryText(catalog, config({ arm: SS, armCount: 3 }))
    expect(summary).toContain('Arm arrangement: Triple (3 @ 90°)')
  })

  it('lists per-part option selections with their labels', () => {
    const summary = buildSummaryText(
      catalog,
      config({ partOptions: { 'gvx-pendant': { codes: { voltage: 'MV' }, addOns: ['HSS-GVX'] } } }),
    )
    expect(summary).toContain('Voltage: MV — 120-277V')
    expect(summary).toContain('Options: HSS-GVX')
  })

  it('never prints the retired "quote only" flag (Round 4)', () => {
    const summary = buildSummaryText(
      catalog,
      config({ partOptions: { 'gvx-pendant': { codes: { voltage: 'MV' } } } }),
    )
    expect(summary.toLowerCase()).not.toContain('quote only')
  })
})
