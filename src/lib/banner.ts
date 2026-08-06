import type { CatalogPart, PlaceholderSpec } from '../types'
import { FT_TO_M } from './composite'

/**
 * Phase 0.10, Workstream C — banner dimensions, labelled.
 *
 * Tyler (8/3): label the banner height, and label the distance to the TOP BAR
 * and the BOTTOM BAR — a banner is defined by the two bars that hold it. Those
 * numbers are already implied by the banner arm's geometry (a bracket pair + a
 * panel between them) plus the shaft height the customer sets, so they are
 * DERIVED from catalog placeholder data here rather than turned into new free
 * variables the render couldn't honour.
 */

/** Heights are metres above grade; the panel height is the banner itself. */
export interface BannerGeometry {
  panelHeightM: number
  panelWidthM: number
  /** Centre of the upper mounting bar, above grade. */
  topBarM: number
  /** Centre of the lower mounting bar, above grade. */
  bottomBarM: number
  /** Vertical centre of the banner panel, above grade (the configured shaft height). */
  centerM: number
}

const IN_PER_M = 1 / 0.0254

/** A box child's vertical centre, relative to the banner's mount origin. */
function childCenterY(child: { spec: PlaceholderSpec; position: [number, number, number] }): number {
  const spec = child.spec
  const height = spec.kind === 'box' ? spec.sizeM[1] : 0
  // `direction: 'up'` boxes stand up from their position (origin at the base).
  return child.position[1] + height / 2
}

/**
 * Derive the banner's labelled dimensions from its catalog placeholder: the
 * tallest box child is the panel, the others are the mounting bars.
 * Returns null for a banner part with no group placeholder.
 */
export function bannerGeometry(part: CatalogPart, heightFt: number): BannerGeometry | null {
  const placeholder = part.placeholder
  if (!placeholder || placeholder.kind !== 'group') return null
  const boxes = placeholder.children.filter((c) => c.spec.kind === 'box')
  if (boxes.length === 0) return null

  const heightOf = (c: (typeof boxes)[number]) => (c.spec.kind === 'box' ? c.spec.sizeM[1] : 0)
  const widthOf = (c: (typeof boxes)[number]) => (c.spec.kind === 'box' ? c.spec.sizeM[0] : 0)
  const panel = boxes.reduce((tallest, c) => (heightOf(c) > heightOf(tallest) ? c : tallest), boxes[0])
  const bars = boxes.filter((c) => c !== panel)

  const mountM = heightFt * FT_TO_M
  const barYs = bars.map(childCenterY)
  const panelY = childCenterY(panel)
  const panelHeightM = heightOf(panel)

  return {
    panelHeightM,
    panelWidthM: widthOf(panel),
    // With only one bar modelled, fall back to the panel's own extents so the
    // labels stay honest instead of collapsing to the mount height.
    topBarM: mountM + (barYs.length ? Math.max(...barYs) : panelY + panelHeightM / 2),
    bottomBarM: mountM + (barYs.length ? Math.min(...barYs) : panelY - panelHeightM / 2),
    centerM: mountM + panelY,
  }
}

/** Metres → `9'-2"`, matching the CAD deliverables' dimension formatting. */
export function formatFtIn(meters: number): string {
  const totalInches = meters * IN_PER_M
  let feet = Math.floor(totalInches / 12)
  let inches = Math.round(totalInches % 12)
  if (inches === 12) {
    feet += 1
    inches = 0
  }
  return `${feet}'-${inches}"`
}

/** Metres → `49 in` (banner panel sizes read naturally in inches). */
export function formatIn(meters: number): string {
  return `${Math.round(meters * IN_PER_M)} in`
}

/** One-line banner description for the summary/quote text. */
export function bannerSummaryLine(part: CatalogPart, count: number, heightFt: number): string {
  const geom = bannerGeometry(part, heightFt)
  const sides = count === 2 ? 'opposite pair' : `${count}-side`
  if (!geom) return `${part.name} — ${sides} @ ${heightFt} ft`
  return (
    `${part.name} — ${sides}, banner height ${formatIn(geom.panelHeightM)} ` +
    `(top bar ${formatFtIn(geom.topBarM)} / bottom bar ${formatFtIn(geom.bottomBarM)} above grade)`
  )
}
