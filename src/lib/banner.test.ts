import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../types'
import { bannerGeometry, bannerSummaryLine, formatFtIn, formatIn } from './banner'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const banner = catalog.parts.find((p) => p.id === 'willstudio-ba1-banner-arm')!

describe('bannerGeometry (Workstream C)', () => {
  it('derives the panel height and both bar heights from catalog geometry', () => {
    const geom = bannerGeometry(banner, 8)!
    // BA1 geometry, corrected from the real BA24-4R CAD in the 0.10 ingest: a
    // 1.25 m panel hung between bars whose centres sit symmetrically at ±0.625 m
    // of the mount point — bar-to-bar IS the 49 in banner height.
    expect(geom.panelHeightM).toBeCloseTo(1.25, 3)
    expect(geom.topBarM).toBeCloseTo(8 * 0.3048 + 0.625, 3)
    expect(geom.bottomBarM).toBeCloseTo(8 * 0.3048 - 0.625, 3)
    expect(geom.topBarM - geom.bottomBarM).toBeCloseTo(1.25, 3)
  })

  it('the bars straddle the configured shaft height', () => {
    const geom = bannerGeometry(banner, 10)!
    expect(geom.bottomBarM).toBeLessThan(10 * 0.3048)
    expect(geom.topBarM).toBeGreaterThan(10 * 0.3048)
  })

  it('moving the banner up the shaft moves both bars by the same amount', () => {
    const low = bannerGeometry(banner, 6)!
    const high = bannerGeometry(banner, 12)!
    const delta = 6 * 0.3048
    expect(high.topBarM - low.topBarM).toBeCloseTo(delta, 6)
    expect(high.bottomBarM - low.bottomBarM).toBeCloseTo(delta, 6)
    expect(high.panelHeightM).toBe(low.panelHeightM)
  })

  it('returns null for a part with no group placeholder', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-20')!
    expect(bannerGeometry(pole, 8)).toBeNull()
  })

  it('every catalog banner arm resolves labelled dimensions', () => {
    for (const part of catalog.parts.filter((p) => p.slot === 'banner')) {
      const geom = bannerGeometry(part, 8)
      expect(geom).not.toBeNull()
      expect(geom!.panelHeightM).toBeGreaterThan(0)
    }
  })
})

describe('dimension formatting', () => {
  it('formats feet and inches like the CAD deliverables', () => {
    expect(formatFtIn(0)).toBe(`0'-0"`)
    expect(formatFtIn(0.3048)).toBe(`1'-0"`)
    expect(formatFtIn(3.0)).toBe(`9'-10"`)
  })

  it('rolls 12 inches up into the next foot', () => {
    // 2.126 m = 83.70 in = 6'-11.7" → must read 7'-0", never 6'-12".
    expect(formatFtIn(2.126)).toBe(`7'-0"`)
    // 1.9995 m = 78.72 in = 6'-6.7" → ordinary rounding, no carry.
    expect(formatFtIn(1.9995)).toBe(`6'-7"`)
  })

  it('formats banner panel sizes in inches', () => {
    expect(formatIn(1.25)).toBe('49 in')
  })
})

describe('bannerSummaryLine', () => {
  it('labels the height and both bars', () => {
    const line = bannerSummaryLine(banner, 2, 8)
    expect(line).toContain('opposite pair')
    expect(line).toContain('banner height 49 in')
    expect(line).toMatch(/top bar \d+'-\d+"/)
    expect(line).toMatch(/bottom bar \d+'-\d+"/)
  })
})
