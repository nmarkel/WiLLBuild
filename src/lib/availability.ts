import type { CatalogPart, ProductLine } from '../types'

/**
 * Phase 0.12, Workstream D — "Coming Soon" for products still on placeholder
 * geometry.
 *
 * Tyler, 8/11: we're past the point where a placeholder render can sit next to
 * a real product as if the two were equivalent. A product whose geometry is
 * still a placeholder solid gets a Coming Soon badge and goes inert — visible
 * in the showroom (it's the roadmap teaser), but not selectable, no part
 * number, no downloads. Nothing is deleted.
 *
 * The rule is machine-checkable and driven off the generated `realCad` flag, so
 * parts re-enable BY THEMSELVES as Workstream A lands their alignment. There is
 * deliberately no hand-maintained list of ids to fall out of date.
 */

/**
 * Lines the rule is switched on for.
 *
 * Scoped to WiLLstudio for 0.12 on purpose. The rule itself is brand-agnostic,
 * but WiLLstudio is the only line whose real-vs-placeholder split has actually
 * been audited (the 8/11 coverage matrix), and it is the line Tyler's GVX + TEX
 * finish-line cut is about. Switching NAFCO on today would badge 51 more parts
 * on the strength of an audit nobody has done — the NAFCO tab inherits this
 * mechanic when its pilot runs (0.12 "Out of scope": still waiting on Cole's
 * simplified NAFCO STEPs).
 *
 * Adding a line here is the entire change needed to extend it.
 */
export const COMING_SOON_LINES: readonly ProductLine[] = ['WiLLstudio']

/**
 * Whether a part is presented as Coming Soon: visible, but inert.
 *
 * Three conditions, in the order they matter:
 *  1. its line is switched on (see COMING_SOON_LINES);
 *  2. it is not a pseudo-part (a configuration concept needing no CAD);
 *  3. its renders do not come from real CAD.
 */
export function isComingSoon(part: CatalogPart | undefined): boolean {
  if (!part) return false
  if (!COMING_SOON_LINES.includes(part.line)) return false
  if (part.pseudoPart) return false
  return part.realCad !== true
}

/** The inverse, for readability at call sites that gate on availability. */
export function isConfigurable(part: CatalogPart | undefined): boolean {
  return part !== undefined && !isComingSoon(part)
}

/** Badge copy — one string, so the showroom and the builder can never disagree. */
export const COMING_SOON_LABEL = 'Coming Soon'

/**
 * Why a Coming Soon part is not configurable yet, for a tooltip.
 *
 * Deliberately says nothing about dates: 11 of the 21 currently badged parts are
 * waiting on CAD from Cole, and the rest on our own alignment work, so any
 * timeframe here would be invention.
 */
export const COMING_SOON_HINT =
  'Not yet configurable — this product is still being modelled from engineering CAD.'
