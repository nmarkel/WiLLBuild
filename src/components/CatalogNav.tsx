import { useState, useMemo } from 'react'
import type { Catalog, CatalogPart, ProductLine } from '../types'
import { useConfigurator } from '../store'

const LINE_ORDER: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport', 'WiLLev', 'WiLLcloud']

interface Props {
  catalog: Catalog
}

export function CatalogNav({ catalog }: Props) {
  const { openProduct, openBuilder, view } = useConfigurator()
  const [expanded, setExpanded] = useState(false)
  const [activeLine, setActiveLine] = useState<ProductLine | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // Standalone parts (non-wizard parts) grouped by line + category
  const standaloneByLine = useMemo(() => {
    const map = new Map<ProductLine, Map<string, CatalogPart[]>>()
    for (const p of catalog.parts) {
      if (p.slot !== 'standalone') continue
      const line = p.line as ProductLine
      if (!map.has(line)) map.set(line, new Map())
      const byCategory = map.get(line)!
      if (!byCategory.has(p.category)) byCategory.set(p.category, [])
      byCategory.get(p.category)!.push(p)
    }
    return map
  }, [catalog])

  const availableLines = useMemo(
    () => LINE_ORDER.filter((l) => standaloneByLine.has(l) || l === 'WiLLstudio'),
    [standaloneByLine],
  )

  const currentLine = activeLine ?? availableLines[0] ?? null
  const categoriesForLine = currentLine ? standaloneByLine.get(currentLine) : null
  const categoryList = categoriesForLine ? Array.from(categoriesForLine.keys()) : []
  const currentCategory = activeCategory && categoryList.includes(activeCategory)
    ? activeCategory
    : categoryList[0] ?? null
  const partsForCategory = currentCategory && categoriesForLine
    ? (categoriesForLine.get(currentCategory) ?? [])
    : []

  function handleLineClick(line: ProductLine) {
    setActiveLine(line)
    setActiveCategory(null)
  }

  if (!expanded) {
    return (
      <div className="catalog-nav-collapsed">
        <button
          className="catalog-nav-toggle"
          onClick={() => setExpanded(true)}
          aria-expanded="false"
        >
          Browse full catalog
          <span className="catalog-nav-toggle-arrow">›</span>
        </button>
      </div>
    )
  }

  return (
    <div className="catalog-nav" aria-label="Full catalog browser">
      <div className="catalog-nav-header">
        <span className="catalog-nav-title">Browse full catalog</span>
        <button className="catalog-nav-close" onClick={() => setExpanded(false)} aria-label="Close catalog">
          ✕
        </button>
      </div>

      {/* Line tabs */}
      <div className="catalog-nav-lines" role="tablist" aria-label="Product lines">
        {availableLines.map((line) => (
          <button
            key={line}
            role="tab"
            aria-selected={currentLine === line}
            className={`catalog-nav-line-tab${currentLine === line ? ' active' : ''}`}
            onClick={() => handleLineClick(line)}
          >
            {line}
          </button>
        ))}
      </div>

      {/* Category pills — only if there are categories */}
      {categoryList.length > 1 && (
        <div className="catalog-nav-categories">
          {categoryList.map((cat) => (
            <button
              key={cat}
              className={`catalog-nav-cat-pill${currentCategory === cat ? ' active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Product cards */}
      <div className="catalog-nav-cards">
        {/* Pole System Builder card — always first in WiLLstudio */}
        {currentLine === 'WiLLstudio' && (
          <button
            className={`catalog-card catalog-card-builder${view.kind === 'builder' ? ' active' : ''}`}
            onClick={openBuilder}
            aria-pressed={view.kind === 'builder'}
          >
            <div className="catalog-card-photo catalog-card-photo-builder">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <rect x="8" y="8" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="catalog-card-name">Pole System Builder</div>
            <div className="catalog-card-family">Configure your pole assembly</div>
          </button>
        )}

        {partsForCategory.map((part) => {
          const isActive = view.kind === 'product' && view.productId === part.id
          return (
            <button
              key={part.id}
              className={`catalog-card${isActive ? ' active' : ''}`}
              onClick={() => openProduct(part.id)}
              aria-pressed={isActive}
            >
              <div className="catalog-card-photo">
                {part.photo ? (
                  <img
                    src={part.photo}
                    alt={part.name}
                    loading="lazy"
                    width={72}
                    height={72}
                  />
                ) : (
                  <span className="catalog-card-photo-placeholder">{part.family.charAt(0)}</span>
                )}
              </div>
              <div className="catalog-card-name">{part.name}</div>
              {part.dropShip && <div className="catalog-card-badge">External product</div>}
            </button>
          )
        })}

        {/* Empty state for a line with no standalone parts */}
        {currentLine !== 'WiLLstudio' && partsForCategory.length === 0 && (
          <p className="catalog-nav-empty">No products listed yet.</p>
        )}
      </div>
    </div>
  )
}
