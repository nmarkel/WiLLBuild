import type { PoleConfig } from '../types'
import { ISOLUX_PROFILES } from './isoluxProfiles'

/**
 * Light-distribution footprints for the night view (Tyler 8/20).
 *
 * The night beam used to be one fixed ellipse whatever the customer picked, so
 * a 70 deg Type V Narrow lit the same ground as a Type IV Medium. These are the
 * shapes the beam now takes, keyed by the ordering code in the fixture's
 * `distribution` column (`public/catalog.json`).
 *
 * The shapes are WiLL's OWN isolux contours, read off the spec sheet's vector
 * artwork by `scripts/photometry/extract_isolux.py` (GVX page 5, simulated per
 * IESNA LM-63-1995) and stored in `isoluxProfiles.ts` as radii in MOUNTING
 * HEIGHTS — so the sheet's 15 ft plots scale to whatever pole the customer
 * configures. Nothing here is a guessed classification range.
 *
 * The night view stays labelled "Conceptual — not a photometric simulation":
 * these are the sheet's simulated contours drawn in a projected view, not a
 * calculation for the customer's own site.
 */
/** A footcandle level the spec sheet plots. */
export type IsoluxLevel = '25.0' | '10.0' | '5.0' | '2.0' | '0.5'

/** Brightest first. A distribution carries only the levels its plot draws. */
export const ISOLUX_LEVELS: IsoluxLevel[] = ['25.0', '10.0', '5.0', '2.0', '0.5']

export interface DistributionShape {
  /** Ordering-sheet label, for the night-view caption. */
  label: string
}

/** The column key on the fixture's ordering table. */
export const DISTRIBUTION_KEY = 'distribution'

/** Tyler 8/20: 5M is the default the beam draws when nothing is chosen. */
export const DEFAULT_DISTRIBUTION = '5M'

export const DISTRIBUTIONS: Record<string, DistributionShape> = {
  '1S': { label: 'Type I Short' },
  '2M': { label: 'Type II Medium' },
  '3M': { label: 'Type III Medium' },
  '3W': { label: 'Type III Wide' },
  '4M': { label: 'Type IV Medium' },
  '5W': { label: '150 deg Type V Square' },
  '5M': { label: '90 deg Type V Medium' },
  '5N': { label: '70 deg Type V Narrow' },
  // Custom is specified off-sheet, so the sheet plots no contour for it.
  // Borrowing the default's is honest; inventing one would be a photometric
  // claim about a fixture nobody has configured yet.
  CD: { label: 'Custom' },
}

/**
 * The contour for a code at a level, or null when this distribution's own plot
 * does not draw that level.
 *
 * The fallback is per DISTRIBUTION, never per level: a code the sheet plots at
 * all uses only its own contours. Falling back level-by-level had 5W — which
 * the sheet plots at 2.0 and 0.5 fc only — quietly drawing 5M's 5 and 10 fc
 * contours as if they were its own.
 */
export function isoluxProfile(code: string, level: IsoluxLevel): number[] | null {
  const plotted = ISOLUX_PROFILES[code] ?? ISOLUX_PROFILES[DEFAULT_DISTRIBUTION]
  const profile = plotted?.[level]
  return profile && profile.length ? profile : null
}

/** The distribution code in effect for a config (never undefined). */
export function distributionCode(config: PoleConfig | null | undefined): string {
  const chosen = config?.specOptions?.fixture?.[DISTRIBUTION_KEY]
  const code = Array.isArray(chosen) ? chosen[0] : chosen
  return code && DISTRIBUTIONS[code] ? code : DEFAULT_DISTRIBUTION
}

export function distributionShape(code: string): DistributionShape {
  return DISTRIBUTIONS[code] ?? DISTRIBUTIONS[DEFAULT_DISTRIBUTION]
}

/**
 * One contour as ground-plane metres: `[away-from-pole, lateral]` pairs, closed,
 * centred on the light point's own ground position.
 *
 * Orientation follows Tyler 8/20 — "the bottom of the distribution graph should
 * always be oriented pole side" — so the plot's -Y axis points at the pole and
 * its +Y throw runs away from it. Metres, NOT pixels: the caller projects them
 * through the rig's own ground map (the one the compass ring uses), because a
 * flattening factor of our own would put the light on a different plane from
 * the compass that marks the ground.
 */
export function footprintPolygon(
  code: string,
  mountingHeightM: number,
  level: IsoluxLevel = '2.0',
): Array<[number, number]> {
  if (mountingHeightM <= 0) return []
  const profile = isoluxProfile(code, level)
  if (!profile) return []
  return profile.map((radiusMh, bin) => {
    // Bin 0 starts at the plot's -X axis and the bins run anticlockwise, which
    // is how `extract_isolux.py` walked them.
    const angle = -Math.PI + ((bin + 0.5) / profile.length) * Math.PI * 2
    const r = radiusMh * mountingHeightM
    return [Math.sin(angle) * r, Math.cos(angle) * r] as [number, number]
  })
}

export interface FootprintBand {
  /** Footcandles this contour bounds. */
  fc: number
  /** How opaque this band should read, 0..1 — brighter level, stronger wash. */
  weight: number
  /** Ground-plane metres, `[away-from-pole, lateral]`. */
  ground: Array<[number, number]>
}

/**
 * Every contour the sheet plots for this distribution, OUTERMOST FIRST.
 *
 * Stacking them is what gives the beam a falloff: one flat polygon dropped from
 * lit to unlit at a hard edge, which is not how light behaves and is not what
 * the sheet shows. The weights ramp with the level so the 25 fc core reads
 * brightest and the 0.5 fc edge barely reads at all.
 */
export function footprintBands(code: string, mountingHeightM: number): FootprintBand[] {
  const bands: FootprintBand[] = []
  for (const level of [...ISOLUX_LEVELS].reverse()) {
    const ground = footprintPolygon(code, mountingHeightM, level)
    if (ground.length < 3) continue
    bands.push({ fc: Number(level), weight: 0, ground })
  }
  // Weight by position in the stack rather than by footcandles: the levels are
  // a 50x range, and one distribution plots five of them while another plots
  // two, so an absolute mapping would make those two look wrong.
  return bands.map((band, i) => ({
    ...band,
    weight: 0.1 + (0.26 * (i + 1)) / bands.length,
  }))
}

/** Largest radius of a contour, in mounting heights — used for sizing checks. */
export function footprintReachMh(code: string, level: IsoluxLevel = '2.0'): number {
  const profile = isoluxProfile(code, level)
  return profile ? Math.max(...profile) : 0
}

/**
 * Light COLOUR by the fixture's Color Temp code (Tyler 8/20). The night view
 * used one fixed warm cream whatever the customer picked, so a 5000K neutral
 * and a 593 nm true amber lit the scene identically.
 *
 * Defaults to 5000K when nothing is chosen. The two amber options are narrow
 * band LEDs rather than blackbody sources, which is why they are far more
 * saturated than any of the white options — that is the point of specifying
 * them (turtle and wildlife compliance, GVX spec sheet page 2).
 */
export const DEFAULT_COLOR_TEMP = '50'

export interface LightColor {
  label: string
  /** Core of the glow / lens. */
  core: [number, number, number]
  /** The ground wash — the same hue, carried by alpha in the renderers. */
  wash: [number, number, number]
}

export const COLOR_TEMP_KEY = 'color-temp'

export const LIGHT_COLORS: Record<string, LightColor> = {
  '30': { label: '3000K', core: [255, 231, 199], wash: [255, 200, 138] },
  '40': { label: '4000K', core: [255, 243, 227], wash: [255, 222, 178] },
  '50': { label: '5000K', core: [255, 250, 244], wash: [246, 236, 220] },
  PCA: { label: 'PC Amber', core: [255, 205, 128], wash: [255, 168, 58] },
  TA: { label: 'True Amber', core: [255, 190, 96], wash: [255, 148, 20] },
  // Custom & RGB is specified off-sheet — anything from 2200K to a saturated
  // colour — so it draws the default rather than guessing a hue.
  CT: { label: 'Custom', core: [255, 250, 244], wash: [246, 236, 220] },
}

/** The colour-temp code in effect for a config (never undefined). */
export function colorTempCode(config: PoleConfig | null | undefined): string {
  const chosen = config?.specOptions?.fixture?.[COLOR_TEMP_KEY]
  const code = Array.isArray(chosen) ? chosen[0] : chosen
  return code && LIGHT_COLORS[code] ? code : DEFAULT_COLOR_TEMP
}

export function lightColor(code: string): LightColor {
  return LIGHT_COLORS[code] ?? LIGHT_COLORS[DEFAULT_COLOR_TEMP]
}

/** `rgba(...)` for a light's core or wash at `alpha`. */
export function lightRgba(code: string, part: 'core' | 'wash', alpha: number): string {
  const [r, g, b] = lightColor(code)[part]
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
