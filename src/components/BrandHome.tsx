import { useMemo } from 'react'
import type { Catalog, CatalogPart, ProductLine } from '../types'
import { useConfigurator } from '../store'

/** Tagline shown under each brand's title — mirrors willbrands.com/pages/products. */
const BRAND_TAGLINES: Partial<Record<ProductLine, string>> = {
  NAFCO: 'Commercial',
  WiLLsport: 'Sports & Large-Area',
  WiLLev: 'Charging Site Infrastructure',
  WiLLcloud: 'Software & Controls',
  WiLLstudio: 'Architectural & Decorative',
}

interface Props {
  catalog: Catalog
  brand: ProductLine
}

/**
 * Brand landing page (Tesla-style): the brand's products as an image-card grid,
 * grouped by the official site categories in page order. Clicking a card opens
 * the standalone product viewer.
 */
export function BrandHome({ catalog, brand }: Props) {
  const { openProduct } = useConfigurator()

  const sections = useMemo(() => {
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
  }, [catalog, brand])

  return (
    <div className="brand-home">
      <header className="brand-home-header">
        <h1 className="brand-home-title">{brand}</h1>
        {BRAND_TAGLINES[brand] && <p className="brand-home-tagline">{BRAND_TAGLINES[brand]}</p>}
      </header>

      {sections.map(([category, parts]) => (
        <section key={category} className="brand-home-section">
          <h2 className="brand-home-category">{category}</h2>
          <div className="brand-home-grid">
            {parts.map((part) => (
              <button
                key={part.id}
                className="brand-home-card"
                onClick={() => openProduct(part.id)}
              >
                <span className="brand-home-card-photo">
                  {part.photo ? (
                    <img src={part.photo} alt={part.name} loading="lazy" />
                  ) : (
                    <span className="brand-home-card-placeholder">
                      {part.family.charAt(0)}
                    </span>
                  )}
                </span>
                <span className="brand-home-card-name">{part.name}</span>
                {part.dropShip && <span className="brand-home-card-badge">External product</span>}
              </button>
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && <p className="brand-home-empty">No products listed yet.</p>}
    </div>
  )
}
