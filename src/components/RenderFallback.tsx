import type { Catalog } from '../types'
import { partById } from '../lib/compat'

interface Props {
  catalog: Catalog
  /** Part ids waiting on a render asset (or the current config's part ids when
   * the manifest itself is unavailable). */
  partIds: string[]
  label?: string
}

/**
 * Calm "coming soon" card shown whenever the layered image compositor can't
 * produce a full assembly view — manifest unavailable, or one/more parts in
 * the current config have no render asset yet. Never renders a broken
 * viewer and never falls back to the old 3D placeholder primitives; just
 * names what's still pending, with a photo thumbnail when the catalog has
 * one for that part.
 */
export function RenderFallback({ catalog, partIds, label = 'Preview render coming' }: Props) {
  const parts = partIds
    .map((id) => partById(catalog, id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  return (
    <div className="composite-fallback">
      <div className="composite-fallback-icon" aria-hidden="true">
        ◐
      </div>
      <p className="composite-fallback-label">{label}</p>
      {parts.length > 0 && (
        <ul className="composite-fallback-list">
          {parts.map((part) => (
            <li key={part.id} className="composite-fallback-item">
              <span className="composite-fallback-thumb">
                {part.photo ? (
                  <img src={part.photo} alt="" />
                ) : (
                  <span className="composite-fallback-thumb-letter">
                    {part.family.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="composite-fallback-name">{part.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
