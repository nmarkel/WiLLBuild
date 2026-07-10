import { useState } from 'react'
import type { CatalogPart } from '../types'

interface Props {
  part: CatalogPart
}

/**
 * Photo-card fallback for tier-3 (standalone/no-3D) products.
 * Shows the product photo (with a silver placeholder on error), name,
 * family/line, category chip, dropShip badge, and a productUrl link.
 * Never renders a 3D canvas.
 */
export function PhotoCard({ part }: Props) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="photo-card">
      <div className="photo-card-image-wrap">
        {part.photo && !imgError ? (
          <img
            className="photo-card-image"
            src={part.photo}
            alt={part.name}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="photo-card-image-placeholder" aria-label="Product image not available">
            <span className="photo-card-image-placeholder-letter">
              {part.family.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="photo-card-body">
        <div className="photo-card-chips">
          <span className="photo-card-category">{part.category}</span>
          {part.dropShip && (
            <span className="photo-card-badge-external">External product</span>
          )}
        </div>

        <h1 className="photo-card-name">{part.name}</h1>
        <p className="photo-card-family">
          {part.family}
          {part.line && part.line !== 'Other' ? ` · ${part.line}` : ''}
        </p>

        {part.productUrl && (
          <a
            className="photo-card-link btn primary"
            href={part.productUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on willbrands.com ↗
          </a>
        )}
      </div>
    </div>
  )
}
