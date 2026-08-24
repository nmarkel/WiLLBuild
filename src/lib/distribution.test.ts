import { describe, expect, it } from 'vitest'
import {
  COLOR_TEMP_KEY,
  DEFAULT_COLOR_TEMP,
  DEFAULT_DISTRIBUTION,
  DISTRIBUTIONS,
  DISTRIBUTION_KEY,
  LIGHT_COLORS,
  colorTempCode,
  distributionCode,
  footprintBands,
  footprintPolygon,
  isoluxProfile,
  lightColor,
  lightRgba,
} from './distribution'
import { ISOLUX_PROFILES } from './isoluxProfiles'
import type { PoleConfig } from '../types'
import catalog from '../../public/catalog.json'

const config = (fixtureOptions?: Record<string, string>): PoleConfig =>
  ({
    configId: 'test',
    pole: 'alum-pole-20',
    baseCover: 'bc-cl2-medium-clamshell',
    arm: 'sh1-shepherds-hook',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
    ...(fixtureOptions ? { specOptions: { fixture: fixtureOptions } } : {}),
  }) as PoleConfig

const fixtureColumn = (key: string) => {
  const fixture = (catalog as any).parts.find((p: any) => p.id === 'gvx-pendant')
  return fixture.options.find((o: any) => o.key === key)
}

const MH = 4.0
const extents = (code: string) => {
  const pts = footprintPolygon(code, MH)
  const away = pts.map(([a]) => a)
  const lateral = pts.map(([, l]) => l)
  return {
    awayMin: Math.min(...away) / MH,
    awayMax: Math.max(...away) / MH,
    lateral: Math.max(...lateral.map(Math.abs)) / MH,
  }
}

describe('distributionCode', () => {
  it('defaults to 5M when the customer has not chosen (Tyler 8/20)', () => {
    expect(distributionCode(config())).toBe('5M')
    expect(DEFAULT_DISTRIBUTION).toBe('5M')
  })

  it('uses the chosen code, and falls back for an unknown one', () => {
    expect(distributionCode(config({ [DISTRIBUTION_KEY]: '3M' }))).toBe('3M')
    expect(distributionCode(config({ [DISTRIBUTION_KEY]: 'nonsense' }))).toBe('5M')
  })

  it('covers every distribution the fixture actually offers', () => {
    // Every code on the ordering table needs a shape, or picking it silently
    // shows the default.
    for (const value of fixtureColumn(DISTRIBUTION_KEY).values) {
      expect(DISTRIBUTIONS[value.code], `no entry for ${value.code}`).toBeDefined()
      expect(isoluxProfile(value.code, '2.0'), `no contour for ${value.code}`).toBeTruthy()
    }
  })

  it('gives Custom the default contour rather than inventing one', () => {
    // The sheet plots no diagram for CD, so it must borrow rather than guess.
    expect(ISOLUX_PROFILES.CD).toBeUndefined()
    expect(isoluxProfile('CD', '2.0')).toEqual(isoluxProfile('5M', '2.0'))
  })
})

describe('footprintPolygon', () => {
  it('matches the spec sheet plots it was read from', () => {
    // GVX page 5, 2.0 fc contours, in mounting heights. The sheet plots at 15 ft
    // so these came out of `scripts/photometry/extract_isolux.py` — if a sheet
    // revision moves them, regenerating is the fix, not editing the assertion.
    expect(extents('5M').lateral).toBeCloseTo(2.04, 1)
    expect(extents('5N').lateral).toBeCloseTo(1.99, 1)
    expect(extents('3M').lateral).toBeCloseTo(3.01, 1)
    expect(extents('4M').lateral).toBeCloseTo(2.57, 1)
  })

  it('orders the types the way the sheet does', () => {
    const lateral = (code: string) => extents(code).lateral
    // The narrow Type V lights the least ground; the lateral types the most.
    expect(lateral('5N')).toBeLessThan(lateral('5M'))
    expect(lateral('5M')).toBeLessThan(lateral('4M'))
    expect(lateral('4M')).toBeLessThan(lateral('3M'))
    expect(lateral('3M')).toBeLessThan(lateral('2M'))
  })

  it('orients the plot with its bottom toward the pole (Tyler 8/20)', () => {
    // The plot's -Y half faces the pole, so a contour reaches back toward it —
    // negative "away" — as well as out in front. On 5M the sheet's own contour
    // is slightly deeper on the pole side, and that asymmetry must survive.
    const { awayMin, awayMax } = extents('5M')
    expect(awayMin).toBeLessThan(0)
    expect(awayMax).toBeGreaterThan(0)
    expect(awayMin).toBeCloseTo(-2.23, 1)
    expect(awayMax).toBeCloseTo(1.82, 1)
  })

  it('draws Type V close to symmetric across the throw axis', () => {
    // Traced from a plot, so not symmetric to the millimetre — within a few
    // percent is what "the sheet drew a symmetric distribution" looks like.
    for (const code of ['5M', '5N', '5W']) {
      const lateral = footprintPolygon(code, MH).map(([, l]) => l)
      const right = Math.max(...lateral)
      const left = -Math.min(...lateral)
      expect(Math.abs(right - left) / Math.max(right, left)).toBeLessThan(0.05)
    }
  })

  it('scales the 15 ft plots to the pole the customer configured', () => {
    const near = footprintPolygon('3M', 3)
    const far = footprintPolygon('3M', 6)
    const reach = (pts: Array<[number, number]>) => Math.max(...pts.map(([a]) => a))
    expect(reach(far)).toBeCloseTo(reach(near) * 2, 6)
  })

  it('picks the 0.5 fc contour when asked, and it encloses the 2.0 fc one', () => {
    const pool = footprintPolygon('5M', MH, '2.0')
    const edge = footprintPolygon('5M', MH, '0.5')
    const span = (pts: Array<[number, number]>) =>
      Math.max(...pts.map(([a, l]) => Math.hypot(a, l)))
    expect(span(edge)).toBeGreaterThan(span(pool))
  })

  it('stacks every contour the plot draws, outermost first, for the falloff', () => {
    // A single polygon steps from lit to unlit at a hard edge, which is not how
    // light behaves. Each distribution contributes as many bands as its own
    // plot draws — 5N plots five levels, 5W only two.
    const span = (band: { ground: Array<[number, number]> }) =>
      Math.max(...band.ground.map(([a, l]) => Math.hypot(a, l)))
    const bands = footprintBands('5N', MH)
    expect(bands.map((b) => b.fc)).toEqual([0.5, 2, 5, 10, 25])
    expect(footprintBands('5W', MH).map((b) => b.fc)).toEqual([0.5, 2])
    for (let i = 1; i < bands.length; i += 1) {
      expect(span(bands[i])).toBeLessThan(span(bands[i - 1]))
      expect(bands[i].weight).toBeGreaterThan(bands[i - 1].weight)
    }
    // Weights stay inside a range that reads as a wash, never as a solid.
    expect(Math.min(...bands.map((b) => b.weight))).toBeGreaterThan(0.05)
    expect(Math.max(...bands.map((b) => b.weight))).toBeLessThan(0.45)
  })

  it('gives a two-contour plot the same weight range as a five-contour one', () => {
    // Otherwise 5W, which plots two levels, would render fainter than 5N for a
    // reason that is about the DIAGRAM rather than about the light.
    const few = footprintBands('5W', MH)
    const many = footprintBands('5N', MH)
    expect(few[few.length - 1].weight).toBeCloseTo(many[many.length - 1].weight, 6)
  })

  it('returns nothing when the mounting height is unknown', () => {
    expect(footprintPolygon('5M', 0)).toEqual([])
  })
})

describe('light colour', () => {
  it('defaults to 5000K (Tyler 8/20)', () => {
    expect(colorTempCode(config())).toBe('50')
    expect(DEFAULT_COLOR_TEMP).toBe('50')
    expect(lightColor(colorTempCode(config())).label).toBe('5000K')
  })

  it('follows the chosen colour temp, and falls back for an unknown one', () => {
    expect(colorTempCode(config({ [COLOR_TEMP_KEY]: '30' }))).toBe('30')
    expect(colorTempCode(config({ [COLOR_TEMP_KEY]: 'nope' }))).toBe('50')
  })

  it('covers every colour temp the fixture offers', () => {
    for (const value of fixtureColumn(COLOR_TEMP_KEY).values) {
      expect(LIGHT_COLORS[value.code], `no colour for ${value.code}`).toBeDefined()
    }
  })

  it('gets warmer as the colour temperature drops', () => {
    // Blue channel falls monotonically from 5000K to 3000K to the ambers, which
    // is what makes a turtle-compliant amber read as amber.
    const blue = (code: string) => lightColor(code).wash[2]
    expect(blue('50')).toBeGreaterThan(blue('40'))
    expect(blue('40')).toBeGreaterThan(blue('30'))
    expect(blue('30')).toBeGreaterThan(blue('PCA'))
    expect(blue('PCA')).toBeGreaterThan(blue('TA'))
  })

  it('emits usable rgba', () => {
    expect(lightRgba('TA', 'wash', 0.5)).toBe('rgba(255, 148, 20, 0.5)')
  })
})
