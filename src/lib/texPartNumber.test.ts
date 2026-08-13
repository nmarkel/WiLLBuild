import { describe, expect, it } from 'vitest'
import catalogJson from '../../public/catalog.json'
import type { Catalog, PoleConfig } from '../types'
import { buildPartNumber } from './summary'
import { accentFinishFor } from './compat'

/**
 * Phase 0.12 — the TEX ordering matrix.
 *
 * TEX is the first sheet in the catalog with TWO finish segments: the Housing
 * colour and the Spider Mount & Accent Line colour are separate columns, and
 * the sheet requires the accent designation even on side mounts (where the
 * mounting arm matches the housing). Every other fixture has one.
 *
 * These expectations are hand-authored from the sheet (Rev V01072026), NOT
 * regenerated from our own resolver, so they cannot drift into agreeing with a
 * bug. The anchor case is the sheet's own published ordering example:
 *
 *     WD-TEX-80-30-MV-5W-3T-NA-BK
 *
 * The cross-language drift guard for these lives in docs/part-number-cases.json
 * (read by both this suite's sibling contract test and the Python mirror).
 */

// TEX is editorially held as of 8/12 (Tyler narrowed the cut to GVX for the
// Casey pilot), and a held part deliberately resolves NO part number. These
// tests pin the RESOLVER's TEX logic (two finish segments, accent default) so
// it is ready the day the hold lifts — so the fixture strips the hold. The
// held behavior itself is pinned in availability.test.ts and the shared
// contract fixture.
const catalog = (() => {
  const c = structuredClone(catalogJson) as unknown as Catalog
  const tex = c.parts.find((p) => p.id === 'tex-post-top')
  if (tex) delete (tex as { comingSoon?: boolean }).comingSoon
  return c
})()

function texConfig(overrides: Partial<PoleConfig> = {}): PoleConfig {
  return {
    configId: 'tex-test',
    brand: 'WiLLstudio',
    fixture: 'tex-post-top',
    arm: 'sh1-shepherds-hook',
    pole: 'alum-pole-20',
    baseCover: 'bc-cl1-small-clamshell',
    finish: 'matte-black',
    rev: 1,
    ...overrides,
  } as PoleConfig
}

/** The sheet's example: 10,000 lm / 3000K / 120-277V / Type V Square / post-top tenon. */
const SHEET_EXAMPLE_OPTIONS = {
  'lumen-output': '80',
  'color-temp': '30',
  voltage: 'MV',
  distribution: '5W',
  mounting: '3T',
}

describe('TEX part number', () => {
  it("reproduces the spec sheet's own ordering example exactly", () => {
    const config = texConfig({
      // Housing NA (Nat Alum Silver), Spider Mount & Accent Line BK (Black).
      finishes: { fixture: 'silver' },
      accentFinishes: { fixture: 'matte-black' },
      specOptions: { fixture: SHEET_EXAMPLE_OPTIONS },
    })
    expect(buildPartNumber(catalog, config, 'fixture')).toBe('WD-TEX-80-30-MV-5W-3T-NA-BK')
  })

  it('keeps the Design segment AND the Lumen segment — one column could only ever emit one', () => {
    const config = texConfig({ specOptions: { fixture: SHEET_EXAMPLE_OPTIONS } })
    const pn = buildPartNumber(catalog, config, 'fixture')!
    const segments = pn.split('-')
    expect(segments[0]).toBe('WD') // product family
    expect(segments[1]).toBe('TEX') // design
    expect(segments[2]).toBe('80') // lumen output
  })

  it('defaults the accent segment to the housing finish until the customer picks one', () => {
    const config = texConfig({
      finishes: { fixture: 'silver' },
      specOptions: { fixture: SHEET_EXAMPLE_OPTIONS },
    })
    // Mirrors how a slot finish falls back to the base config finish: a default,
    // not a fabricated choice — the accent is a real, visible selection.
    expect(buildPartNumber(catalog, config, 'fixture')).toBe('WD-TEX-80-30-MV-5W-3T-NA-NA')
    expect(accentFinishFor(config, 'fixture')).toBe('silver')
  })

  it('requires the accent designation on side mounts too (SMS / SMR)', () => {
    for (const mount of ['SMS', 'SMR']) {
      const config = texConfig({
        finishes: { fixture: 'statuary-bronze' },
        accentFinishes: { fixture: 'gloss-white' },
        specOptions: { fixture: { ...SHEET_EXAMPLE_OPTIONS, mounting: mount } },
      })
      expect(buildPartNumber(catalog, config, 'fixture')).toBe(
        `WD-TEX-80-30-MV-5W-${mount}-DB-WH`,
      )
    }
  })

  it('resolves an accent colour the sheet column does not list, via the palette code', () => {
    // The sheet prints 10 colours; the viewer palette carries 13. A finish the
    // column omits must still resolve to its palette code, never to `_`.
    const config = texConfig({
      finishes: { fixture: 'matte-black' },
      accentFinishes: { fixture: 'satin-silver-anodized' },
      specOptions: { fixture: SHEET_EXAMPLE_OPTIONS },
    })
    expect(buildPartNumber(catalog, config, 'fixture')).toBe('WD-TEX-80-30-MV-5W-3T-BK-SA')
  })

  it('leaves unanswered ordering columns as `_`, never a guess', () => {
    const config = texConfig({ finishes: { fixture: 'silver' } })
    expect(buildPartNumber(catalog, config, 'fixture')).toBe('WD-TEX-_-_-_-_-_-NA-NA')
  })

  it('does not offer 5VN — in the lumen tables but absent from the ordering matrix', () => {
    const tex = catalog.parts.find((p) => p.id === 'tex-post-top')!
    const dist = tex.options!.find((o) => o.key === 'distribution')!
    expect(dist.values.map((v) => v.code)).not.toContain('5VN')
    // 5N (70° Type V Narrow) IS on the matrix and must stay.
    expect(dist.values.map((v) => v.code)).toContain('5N')
  })

  it('offers both finish segments as separate ordering columns', () => {
    const tex = catalog.parts.find((p) => p.id === 'tex-post-top')!
    const finishCols = tex.options!.filter((o) => o.key.startsWith('finish-color'))
    expect(finishCols.map((o) => o.key)).toEqual(['finish-color', 'finish-color-accent'])
    // Both carry the sheet's full colour list.
    for (const col of finishCols) {
      expect(col.values.map((v) => v.code)).toEqual([
        'NA', 'BK', 'DB', 'WH', 'LG', 'SG', 'DG', 'DP', 'GM', 'RAL',
      ])
    }
  })
})
