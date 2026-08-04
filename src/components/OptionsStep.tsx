import type { Catalog, PoleConfig } from '../types'
import { compatibleParts, partById } from '../lib/compat'
import { useConfigurator } from '../store'
import { BannerPicker } from './BannerPicker'
import { PartConfigure } from './PartConfigure'

/**
 * Phase 0.10, Workstream B — the assembly-level Options step.
 *
 * Tyler (8/3): the base cover is "technically an option", and the banner goes
 * inside Options too. Both are therefore multi-select entries here rather than
 * steps of their own — ticking one reveals its own configuration. (This
 * supersedes 0.9's "banner inside the Pole step".)
 *
 * Per-product spec-sheet Options (the fixture's accessories, the pole's
 * couplings…) stay with their own part in the Sternberg configure block, which is
 * where that sheet's Options column belongs.
 */

interface Props {
  catalog: Catalog
  config: PoleConfig
}

export function OptionsStep({ catalog, config }: Props) {
  const setBaseCover = useConfigurator((s) => s.setBaseCover)
  const setBanner = useConfigurator((s) => s.setBanner)

  const covers = compatibleParts(catalog, config, 'baseCover')
  const bannerParts = catalog.parts.filter((p) => p.slot === 'banner' && p.line === config.brand)
  const activeCover = config.baseCover ? partById(catalog, config.baseCover) : undefined

  if (covers.length === 0 && bannerParts.length === 0) {
    return <p className="options-empty">No add-on options for this product line yet.</p>
  }

  return (
    <div className="assembly-options">
      {covers.length > 0 && (
        <div className={`assembly-option ${activeCover ? 'selected' : ''}`}>
          <label className="assembly-option-toggle">
            <input
              type="checkbox"
              checked={!!activeCover}
              onChange={(e) => setBaseCover(e.target.checked ? covers[0].id : '')}
            />
            <span className="assembly-option-name">Base cover</span>
            <span className="assembly-option-sub">Decorative cover over the pole base</span>
          </label>
          {activeCover && (
            <div className="assembly-option-body">
              <div className="options">
                {covers.map((cover) => (
                  <button
                    key={cover.id}
                    className={`option-card ${config.baseCover === cover.id ? 'selected' : ''}`}
                    onClick={() => setBaseCover(cover.id)}
                  >
                    <span className="thumb">
                      {cover.thumbnail ? (
                        <img src={import.meta.env.BASE_URL + cover.thumbnail} alt="" />
                      ) : cover.photo ? (
                        <img src={cover.photo} alt="" loading="lazy" />
                      ) : (
                        cover.family.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="option-name">{cover.name}</span>
                    <span className="option-family">{cover.family}</span>
                  </button>
                ))}
              </div>
              <PartConfigure catalog={catalog} config={config} part={activeCover} />
            </div>
          )}
        </div>
      )}

      {bannerParts.length > 0 && (
        <div className={`assembly-option ${config.banner ? 'selected' : ''}`}>
          <label className="assembly-option-toggle">
            <input
              type="checkbox"
              checked={!!config.banner}
              onChange={(e) =>
                e.target.checked
                  ? setBanner({
                      armId: bannerParts[0].id,
                      // Workstream C: an opposite pair is the confirmed layout.
                      count: bannerParts[0].arrangements?.includes(2) ? 2 : 1,
                      heightFt: Math.min(8, Math.max(4, Math.round((partById(catalog, config.pole)?.heightFt ?? 20) - 2))),
                    })
                  : setBanner(null)
              }
            />
            <span className="assembly-option-name">Banner arm</span>
            <span className="assembly-option-sub">Mid-shaft bracket pair + banner panel</span>
          </label>
          {config.banner && (
            <div className="assembly-option-body">
              <BannerPicker catalog={catalog} config={config} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
