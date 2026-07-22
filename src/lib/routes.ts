import type { ProductLine } from '../types'
import type { ViewMode } from '../store'

/**
 * Maps each ProductLine to its URL slug.
 * WiLLstudio gets the pole builder at /studio/design; every other brand gets a
 * Tesla-style brand home (product grid) at /<slug> with products at
 * /<slug>/product/<id>. `Other` has no route.
 */
export const BRAND_SLUGS: Record<ProductLine, string | null> = {
  WiLLstudio: 'studio',
  NAFCO: 'nafco',
  WiLLsport: 'sport',
  WiLLev: 'ev',
  WiLLcloud: 'cloud',
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
 * Brands whose catalog contains wizard (assembly) parts and therefore get a
 * configurator; WiLLev/WiLLcloud have nothing that assembles and land on the
 * product showroom instead. Mirrors the promotions in scripts/merge-inventory.mjs.
 */
export const BUILDER_BRANDS: ReadonlySet<ProductLine> = new Set([
  'WiLLstudio',
  'NAFCO',
  'WiLLsport',
])

/** Default view for a brand: builder brands open their configurator, others the showroom. */
function homeView(brand: ProductLine): ViewMode {
  return BUILDER_BRANDS.has(brand) ? { kind: 'builder' } : { kind: 'home' }
}

/**
 * Returns the landing path for a brand — the configurator for builder brands,
 * the product showroom for everything else.
 */
export function brandHomePath(brand: ProductLine): string {
  if (BUILDER_BRANDS.has(brand)) return builderPath(brand)
  const slug = BRAND_SLUGS[brand] ?? BRAND_SLUGS[DEFAULT_BRAND]!
  return `/${slug}`
}

/**
 * Parses a pathname into a brand + view.
 * Format: /<brand-slug>                → brand home (builder for WiLLstudio)
 *         /<brand-slug>/design         → builder
 *         /<brand-slug>/product/<id>   → product
 * Anything else → default (WiLLstudio builder).
 */
export function parseRoute(pathname: string): { brand: ProductLine; view: ViewMode } {
  // Split on '/' and drop empty segments
  const segments = pathname.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return DEFAULT_RESULT

  const brand = SLUG_TO_BRAND[segments[0]]
  if (!brand) return DEFAULT_RESULT

  if (segments.length === 1) {
    return { brand, view: homeView(brand) }
  }
  if (segments[1] === 'design') {
    return { brand, view: { kind: 'builder' } }
  }
  if (segments[1] === 'product' && segments[2]) {
    return { brand, view: { kind: 'product', productId: segments[2] } }
  }

  return { brand, view: homeView(brand) }
}
