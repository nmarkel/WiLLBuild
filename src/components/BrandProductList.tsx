import { useMemo } from 'react'
import type { Catalog, CatalogPart, ProductLine } from '../types'
import { useConfigurator } from '../store'

/** The brand's standalone products grouped by official site category, in page order. */
export function brandProductSections(
  catalog: Catalog,
  brand: ProductLine,
): [string, CatalogPart[]][] {
  const byCategory = new Map<string, CatalogPart[]>()
  for (const p of catalog.parts) {
    if (p.slot !== 'standalone' || p.line !== brand) continue
    if (!byCategory.has(p.category)) byCategory.set(p.category, [])
    byCategory.get(p.category)!.push(p)
  }
  const order = catalog.categories?.[brand] ?? []
  return Array.from(byCategory.entries()).sort(([a], [b]) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/** Default product to render when a brand landing opens — first in site order. */
export function firstBrandProduct(catalog: Catalog, brand: ProductLine): CatalogPart | null {
  const sections = brandProductSections(catalog, brand)
  return sections[0]?.[1][0] ?? null
}

interface Props {
  catalog: Catalog
  brand: ProductLine
  activeId?: string
}

/**
 * Left-panel product picker for a brand showroom: categories in site order,
 * one row per product. Selecting a product renders it in the main 3D viewer.
 */
export function BrandProductList({ catalog, brand, activeId }: Props) {
  const { openProduct } = useConfigurator()
  const sections = useMemo(() => brandProductSections(catalog, brand), [catalog, brand])

  return (
    <div className="brand-list">
      {sections.map(([category, parts]) => (
        <section key={category} className="brand-list-section">
          <h3 className="brand-list-category">{category}</h3>
          <div className="brand-list-items">
            {parts.map((part) => (
              <button
                key={part.id}
                className={`brand-list-item${part.id === activeId ? ' active' : ''}`}
                onClick={() => openProduct(part.id)}
                aria-pressed={part.id === activeId}
              >
                <span className="brand-list-thumb">
                  {part.photo ? (
                    <img src={part.photo} alt="" loading="lazy" />
                  ) : (
                    part.family.charAt(0)
                  )}
                </span>
                <span className="brand-list-name">{part.name}</span>
                {part.dropShip && <span className="brand-list-badge">External</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {sections.length === 0 && <p className="brand-list-empty">No products listed yet.</p>}
    </div>
  )
}
