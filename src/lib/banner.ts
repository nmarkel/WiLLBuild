import type { BannerPanelSize, CatalogPart, PlaceholderSpec } from '../types'

/**
 * Feet → metres. Deliberately defined here rather than imported from
 * `composite.ts`: `composite.ts` needs `bannerLayerOriginM` below to place the
 * banner layer at the new bottom-edge reference, and importing FT_TO_M back
 * out of it would make that a circular import. It is a unit conversion, not
 * catalog knowledge, so the two definitions cannot drift meaningfully.
 */
const FT_TO_M = 0.3048

/**
 * Phase 0.10, Workstream C — banner dimensions, labelled.
 *
 * Tyler (8/3): label the banner height, and label the distance to the TOP BAR
 * and the BOTTOM BAR — a banner is defined by the two bars that hold it.
 *
 * Phase 0.11, Workstream D — the reference point and the panel size.
 *
 * The configured mounting height is now the BOTTOM OF THE BANNER (Puddy's
 * spec measures to the bottom edge), not the panel's vertical centre. That was
 * a real bug, not a labelling nicety: a 24×48 banner mounted at the 8 ft
 * minimum used to hang down to ~6 ft while the app reported it compliant.
 *
 * The panel itself is now an ordered size (18×36 / 24×48 / 30×60 in) rather
 * than whatever the placeholder solid happened to be. What stays DERIVED from
 * the catalog placeholder is how far the mounting bars sit outside the panel
 * edges — that's bracket hardware geometry, and inventing it would put a number
 * in the quote that no drawing backs up.
 */

/** Heights are metres above grade; the panel height is the banner itself. */
export interface BannerGeometry {
  panelHeightM: number
  panelWidthM: number
  /** Bottom edge of the banner panel, above grade — the configured mounting height. */
  bottomM: number
  /** Centre of the upper mounting bar, above grade. */
  topBarM: number
  /** Centre of the lower mounting bar, above grade. */
  bottomBarM: number
  /** Vertical centre of the banner panel, above grade (derived, not configured). */
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
 * Derive the banner's labelled dimensions. The panel comes from the ordered
 * `size` when one is given, else from the part's placeholder solid (the tallest
 * box child is the panel, the others are the mounting bars). Bar overhang — how
 * far each bar's centre sits beyond the panel edge — always comes from the
 * placeholder, so it tracks the modelled bracket rather than being invented.
 * Returns null for a banner part with no group placeholder.
 */
export function bannerGeometry(
  part: CatalogPart,
  heightFt: number,
  size?: BannerPanelSize,
): BannerGeometry | null {
  const placeholder = part.placeholder
  if (!placeholder || placeholder.kind !== 'group') return null
  const boxes = placeholder.children.filter((c) => c.spec.kind === 'box')
  if (boxes.length === 0) return null

  const heightOf = (c: (typeof boxes)[number]) => (c.spec.kind === 'box' ? c.spec.sizeM[1] : 0)
  const widthOf = (c: (typeof boxes)[number]) => (c.spec.kind === 'box' ? c.spec.sizeM[0] : 0)
  const panel = boxes.reduce((tallest, c) => (heightOf(c) > heightOf(tallest) ? c : tallest), boxes[0])
  const bars = boxes.filter((c) => c !== panel)

  // Placeholder extents, in the part's own mount-origin frame.
  const modelPanelHeightM = heightOf(panel)
  const modelPanelY = childCenterY(panel)
  const modelTopM = modelPanelY + modelPanelHeightM / 2
  const modelBottomM = modelPanelY - modelPanelHeightM / 2
  const barYs = bars.map(childCenterY)
  // With only one bar modelled (or none), the overhang collapses to zero and
  // the bar labels fall back to the panel's own edges — honest, not invented.
  const topOverhangM = barYs.length ? Math.max(0, Math.max(...barYs) - modelTopM) : 0
  const bottomOverhangM = barYs.length ? Math.max(0, modelBottomM - Math.min(...barYs)) : 0

  const panelHeightM = size ? size.heightIn / IN_PER_M : modelPanelHeightM
  const panelWidthM = size ? size.widthIn / IN_PER_M : widthOf(panel)
  // Phase 0.11 (D1): the configured height IS the bottom of the banner.
  const bottomM = heightFt * FT_TO_M

  return {
    panelHeightM,
    panelWidthM,
    bottomM,
    topBarM: bottomM + panelHeightM + topOverhangM,
    bottomBarM: bottomM - bottomOverhangM,
    centerM: bottomM + panelHeightM / 2,
  }
}

/**
 * Where the banner layer's ORIGIN goes, in metres above grade, for a banner
 * whose BOTTOM edge is configured at `heightFt` (Phase 0.11, D1).
 *
 * The pre-rendered banner layer is a picture of the part's placeholder solid,
 * whose panel straddles the part origin — so pinning the origin at the
 * configured height (what `composite.ts` did through 0.10.5) draws the panel
 * CENTRED on it. Placing it correctly means lifting the origin by the distance
 * from the origin down to the modelled panel's bottom edge, which is read from
 * the catalog placeholder here rather than hardcoded in the viewer.
 *
 * Falls back to the plain height for a part with no derivable panel.
 */
export function bannerLayerOriginM(part: CatalogPart, heightFt: number): number {
  const placeholder = part.placeholder
  if (!placeholder || placeholder.kind !== 'group') return heightFt * FT_TO_M
  const boxes = placeholder.children.filter((c) => c.spec.kind === 'box')
  if (boxes.length === 0) return heightFt * FT_TO_M
  const heightOf = (c: (typeof boxes)[number]) => (c.spec.kind === 'box' ? c.spec.sizeM[1] : 0)
  const panel = boxes.reduce((tallest, c) => (heightOf(c) > heightOf(tallest) ? c : tallest), boxes[0])
  const originToPanelBottomM = childCenterY(panel) - heightOf(panel) / 2
  return heightFt * FT_TO_M - originToPanelBottomM
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

/** A panel size as customers say it: `24 × 48 in`. */
export function formatPanelSize(size: BannerPanelSize): string {
  return `${size.widthIn} × ${size.heightIn} in`
}

/**
 * One-line banner description for the summary/quote text. `size` is optional
 * so the geometry-service-facing summary keeps working unchanged; when it is
 * supplied the line names the ordered panel as well as the derived heights.
 */
export function bannerSummaryLine(
  part: CatalogPart,
  count: number,
  heightFt: number,
  size?: BannerPanelSize,
): string {
  const geom = bannerGeometry(part, heightFt, size)
  const sides = count === 2 ? 'opposite pair' : `${count}-side`
  if (!geom) return `${part.name} — ${sides} @ ${heightFt} ft`
  const panel = size ? `${formatPanelSize(size)} panel, ` : ''
  return (
    `${part.name} — ${sides}, ${panel}banner height ${formatIn(geom.panelHeightM)} ` +
    `(bottom of banner ${formatFtIn(geom.bottomM)}; ` +
    `top bar ${formatFtIn(geom.topBarM)} / bottom bar ${formatFtIn(geom.bottomBarM)} above grade)`
  )
}
