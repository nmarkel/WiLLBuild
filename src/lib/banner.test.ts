import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BannerPanelSize, Catalog } from '../types'
import { bannerGeometry, bannerLayerOriginM, bannerSummaryLine, formatFtIn, formatIn, formatPanelSize } from './banner'
import { bannerPanelSize, bannerPanelSizes } from './compat'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const banner = catalog.parts.find((p) => p.id === 'willstudio-ba1-banner-arm')!

const FT_TO_M = 0.3048
const IN_TO_M = 0.0254
const size = (id: string) => bannerPanelSize(catalog, id)

describe('banner panel sizes (Phase 0.11, D2)', () => {
  it('the catalog offers exactly the three specified sizes, 24 in wide as the default', () => {
    expect(bannerPanelSizes(catalog).map((s) => s.id)).toEqual(['18x36', '24x48', '30x60'])
    expect(bannerPanelSizes(catalog).filter((s) => s.default).map((s) => s.id)).toEqual(['24x48'])
  })

  it('an absent or unknown size id resolves to the default (pre-0.11 share URLs)', () => {
    expect(bannerPanelSize(catalog, undefined).id).toBe('24x48')
    expect(bannerPanelSize(catalog, 'not-a-size').id).toBe('24x48')
  })

  it('formats a size the way a customer says it', () => {
    expect(formatPanelSize(size('30x60'))).toBe('30 × 60 in')
  })
})

describe('bannerGeometry — bottom-of-banner reference (Phase 0.11, D1)', () => {
  it('the configured height IS the bottom edge of the panel', () => {
    const geom = bannerGeometry(banner, 8, size('24x48'))!
    expect(geom.bottomM).toBeCloseTo(8 * FT_TO_M, 6)
    expect(formatFtIn(geom.bottomM)).toBe(`8'-0"`)
  })

  it('the failure case this fix exists for: a 24×48 banner at the 8 ft floor', () => {
    // Pre-0.11 the height was the panel's CENTRE, so a 48 in banner "at 8 ft"
    // hung down to ~6 ft while the app still called it compliant. The bottom
    // must now never sit below the configured height.
    const geom = bannerGeometry(banner, 8, size('24x48'))!
    expect(geom.bottomM).toBeGreaterThanOrEqual(8 * FT_TO_M - 1e-9)
    expect(geom.centerM).toBeCloseTo(8 * FT_TO_M + (48 * IN_TO_M) / 2, 6)
    // The centre is now DERIVED and sits a half-panel above the mount height.
    expect(geom.centerM - geom.bottomM).toBeCloseTo((48 * IN_TO_M) / 2, 6)
  })

  it('the panel hangs entirely above the mounting height', () => {
    for (const id of ['18x36', '24x48', '30x60']) {
      const geom = bannerGeometry(banner, 10, size(id))!
      expect(geom.bottomM).toBeCloseTo(10 * FT_TO_M, 6)
      expect(geom.topBarM).toBeGreaterThan(geom.bottomM + geom.panelHeightM)
      expect(geom.bottomBarM).toBeLessThan(geom.bottomM)
    }
  })

  it('raising the mount raises every derived dimension by the same amount', () => {
    const low = bannerGeometry(banner, 6, size('24x48'))!
    const high = bannerGeometry(banner, 12, size('24x48'))!
    const delta = 6 * FT_TO_M
    expect(high.bottomM - low.bottomM).toBeCloseTo(delta, 6)
    expect(high.topBarM - low.topBarM).toBeCloseTo(delta, 6)
    expect(high.bottomBarM - low.bottomBarM).toBeCloseTo(delta, 6)
    expect(high.panelHeightM).toBe(low.panelHeightM)
  })
})

describe('bannerGeometry — the ordered panel size drives the labels', () => {
  const cases: [string, number, number][] = [
    ['18x36', 18, 36],
    ['24x48', 24, 48],
    ['30x60', 30, 60],
  ]

  it.each(cases)('%s reports its real width and height', (id, widthIn, heightIn) => {
    const geom = bannerGeometry(banner, 9, size(id))!
    expect(geom.panelWidthM).toBeCloseTo(widthIn * IN_TO_M, 6)
    expect(geom.panelHeightM).toBeCloseTo(heightIn * IN_TO_M, 6)
    expect(formatIn(geom.panelHeightM)).toBe(`${heightIn} in`)
    expect(formatIn(geom.panelWidthM)).toBe(`${widthIn} in`)
  })

  it('the bar spacing tracks the chosen panel, not the placeholder solid', () => {
    // The placeholder models a 1.25 m panel with bar centres 0.015 m outboard
    // of each edge. That bracket overhang stays derived from the catalog; the
    // span between the bars follows the ordered panel.
    for (const [id, , heightIn] of cases) {
      const geom = bannerGeometry(banner, 9, size(id))!
      expect(geom.topBarM - geom.bottomBarM).toBeCloseTo(heightIn * IN_TO_M + 0.03, 6)
    }
    const small = bannerGeometry(banner, 9, size('18x36'))!
    const large = bannerGeometry(banner, 9, size('30x60'))!
    expect(large.topBarM).toBeGreaterThan(small.topBarM)
    expect(large.bottomBarM).toBeCloseTo(small.bottomBarM, 6)
  })

  it('falls back to the placeholder solid when no size is given', () => {
    const geom = bannerGeometry(banner, 8)!
    expect(geom.panelHeightM).toBeCloseTo(1.25, 3)
    expect(geom.panelWidthM).toBeCloseTo(0.5, 3)
    expect(geom.topBarM).toBeCloseTo(8 * FT_TO_M + 1.25 + 0.015, 3)
    expect(geom.bottomBarM).toBeCloseTo(8 * FT_TO_M - 0.015, 3)
  })

  it('returns null for a part with no group placeholder', () => {
    // drx-post-top's placeholder is a lathe profile, not a box-child group.
    const fixture = catalog.parts.find((p) => p.id === 'drx-post-top')!
    expect(bannerGeometry(fixture, 8)).toBeNull()
  })

  it('every catalog banner arm resolves labelled dimensions in every size', () => {
    for (const part of catalog.parts.filter((p) => p.slot === 'banner')) {
      for (const s of bannerPanelSizes(catalog)) {
        const geom = bannerGeometry(part, 8, s)
        expect(geom).not.toBeNull()
        expect(geom!.panelHeightM).toBeCloseTo(s.heightIn * IN_TO_M, 6)
      }
    }
  })
})

describe('bannerLayerOriginM — what the viewer needs (Phase 0.11, D1)', () => {
  it('lifts the layer origin so the drawn panel sits ON the mounting height', () => {
    // The BA1 placeholder's 1.25 m panel straddles the part origin, so the
    // origin has to rise half a panel for the panel's bottom edge to land on
    // the configured height. composite.ts placed the origin AT the height,
    // which drew the panel centred on it — the viewer half of this same bug.
    expect(bannerLayerOriginM(banner, 8)).toBeCloseTo(8 * FT_TO_M + 0.625, 6)
    expect(bannerLayerOriginM(banner, 8) - 8 * FT_TO_M).toBeCloseTo(0.625, 6)
  })

  it('tracks the mounting height one-for-one', () => {
    expect(bannerLayerOriginM(banner, 12) - bannerLayerOriginM(banner, 8)).toBeCloseTo(
      4 * FT_TO_M,
      6,
    )
  })

  it('falls back to the plain height for a part with no panel', () => {
    const fixture = catalog.parts.find((p) => p.id === 'drx-post-top')!
    expect(bannerLayerOriginM(fixture, 8)).toBeCloseTo(8 * FT_TO_M, 6)
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
  it('names the panel, the bottom-of-banner height, and both bars', () => {
    const line = bannerSummaryLine(banner, 2, 8, size('24x48'))
    expect(line).toContain('opposite pair')
    expect(line).toContain('24 × 48 in panel')
    expect(line).toContain('banner height 48 in')
    expect(line).toContain(`bottom of banner 8'-0"`)
    expect(line).toMatch(/top bar \d+'-\d+"/)
    expect(line).toMatch(/bottom bar \d+'-\d+"/)
  })

  it('omits the panel clause when no size is supplied (unchanged callers)', () => {
    const line = bannerSummaryLine(banner, 2, 8)
    expect(line).toContain('opposite pair, banner height 49 in')
    expect(line).not.toContain('panel,')
  })

  it('falls back to a plain line when the part has no derivable geometry', () => {
    const fixture = catalog.parts.find((p) => p.id === 'drx-post-top')!
    expect(bannerSummaryLine(fixture, 1, 8)).toBe(`${fixture.name} — 1-side @ 8 ft`)
  })
})

describe('the spec sanity check: 15 ft pole → banner @ 9 ft', () => {
  // Puddy's worked example is "15 ft pole -> 2x3 @ 9 ft". 2×3 ft is 24×36 in,
  // which is NOT one of the three specified sizes (18×36 / 24×48 / 30×60) — see
  // the report. Checked here with the two sizes that bracket it; both clear the
  // 15 ft pole with the bottom edge at exactly 9 ft.
  it.each(['18x36', '24x48'] as const)('%s at 9 ft stays on a 15 ft pole', (id) => {
    const s: BannerPanelSize = size(id)
    const geom = bannerGeometry(banner, 9, s)!
    expect(geom.bottomM).toBeCloseTo(9 * FT_TO_M, 6)
    expect(geom.topBarM).toBeLessThan(15 * FT_TO_M)
  })
})
