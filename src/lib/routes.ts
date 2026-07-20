import type { ProductLine } from '../types'
import type { ViewMode } from '../store'

/**
 * Maps each ProductLine to its URL slug.
 * Only WiLLstudio has a live flow — all others are null (Coming soon).
 */
export const BRAND_SLUGS: Record<ProductLine, string | null> = {
  WiLLstudio: 'studio',
  NAFCO: null,
  WiLLsport: null,
  WiLLev: null,
  WiLLcloud: null,
  Other: null,
}

/** Reverse map: slug → brand */
const SLUG_TO_BRAND: Record<string, ProductLine> = {}
for (const brand of Object.keys(BRAND_SLUGS) as ProductLine[]) {
  const slug = BRAND_SLUGS[brand]
  if (slug !== null) {
    SLUG_TO_BRAND[slug] = brand
  }
}

const DEFAULT_BRAND: ProductLine = 'WiLLstudio'

/** The default resolved state — WiLLstudio builder. */
const DEFAULT_RESULT = { brand: DEFAULT_BRAND as ProductLine, view: { kind: 'builder' } as ViewMode }

/**
 * Returns the path for the brand's builder view.
 * Falls back to WiLLstudio if the brand has no slug.
 */
export function builderPath(brand: ProductLine): string {
  const slug = BRAND_SLUGS[brand] ?? BRAND_SLUGS[DEFAULT_BRAND]!
  return `/${slug}/design`
}

/**
 * Returns the path for a product view within a brand.
 * Falls back to WiLLstudio if the brand has no slug.
 */
export function productPath(brand: ProductLine, id: string): string {
  const slug = BRAND_SLUGS[brand] ?? BRAND_SLUGS[DEFAULT_BRAND]!
  return `/${slug}/product/${id}`
}

/**
 * Parses a pathname into a brand + view.
 * Format: /<brand-slug>/design  → builder
 *         /<brand-slug>/product/<id>  → product
 * Anything else → default (WiLLstudio builder).
 */
export function parseRoute(pathname: string): { brand: ProductLine; view: ViewMode } {
  // Split on '/' and drop empty segments
  const segments = pathname.split('/').filter((s) => s.length > 0)
  // segments[0] = brand slug, segments[1] = 'design'|'product', segments[2] = id
  if (segments.length < 2) return DEFAULT_RESULT

  const brand = SLUG_TO_BRAND[segments[0]]
  if (!brand) return DEFAULT_RESULT

  if (segments[1] === 'design') {
    return { brand, view: { kind: 'builder' } }
  }
  if (segments[1] === 'product' && segments[2]) {
    return { brand, view: { kind: 'product', productId: segments[2] } }
  }

  return DEFAULT_RESULT
}
