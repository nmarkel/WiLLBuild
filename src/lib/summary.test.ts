import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { buildSummaryText } from './summary'
import { paramsToPartialConfig } from './url'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test-config-123',
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
