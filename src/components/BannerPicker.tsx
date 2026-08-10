import type { Catalog, PoleConfig } from '../types'
import { bannerGeometry, formatFtIn, formatIn } from '../lib/banner'
import { BANNER_MIN_FT, partById } from '../lib/compat'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/** Phase 0.8 (C): banner side-count labels (1 / opposite pair / four sides). */
const SIDE_LABELS: Record<number, string> = {
  1: 'One side',
  2: 'Opposite pair',
  4: 'Four sides',
}

/**
 * Phase 0.8 (Workstream C): choose a mid-shaft banner-arm accessory — the
 * bracket set, how many radial sides it repeats on, and its height up the
 * shaft. Banner *hardware* only; custom banner artwork is deferred (the render
 * shows a plain placeholder panel). Valid side counts come from the catalog
 * part's `arrangements`, so the UI only offers real layouts.
 */
export function BannerPicker({ catalog, config }: Props) {
  const setBanner = useConfigurator((s) => s.setBanner)
  const bannerParts = catalog.parts.filter((p) => p.slot === 'banner' && p.line === config.brand)
  if (bannerParts.length === 0) return null

  const pole = partById(catalog, config.pole)
  const poleFt = pole?.heightFt ?? 20
  const maxFt = Math.max(BANNER_MIN_FT, Math.round(poleFt - 2))
  const active = config.banner
  const part = active ? (partById(catalog, active.armId) ?? bannerParts[0]) : bannerParts[0]
  const sides = part?.arrangements ?? [1, 2, 4]
  // Phase 0.10 (C): the banner's labelled dimensions — a banner is defined by
  // the two bars that hold it — derived from the part's catalog placeholder
  // geometry rather than a new free variable (see src/lib/banner.ts).
  const geom = active && part ? bannerGeometry(part, active.heightFt) : null

  const enable = () =>
    setBanner({ armId: part.id, count: sides[0] ?? 1, heightFt: Math.min(BANNER_MIN_FT, maxFt) })

  return (
    <div className="banner-picker">
      <h3>Banner Arm</h3>
      <label className="banner-toggle">
        <input
          type="checkbox"
          checked={!!active}
          onChange={(e) => (e.target.checked ? enable() : setBanner(null))}
        />
        <span>Add a banner arm (hardware + placeholder panel)</span>
      </label>

      {active && part && (
        <div className="banner-controls">
          <div className="banner-arm-choice">
            {bannerParts.map((bp) => (
              <button
                key={bp.id}
                className={`arm-count-chip ${active.armId === bp.id ? 'selected' : ''}`}
                onClick={() => setBanner({ ...active, armId: bp.id })}
              >
                <span className="arm-count-name">{bp.name}</span>
                <span className="arm-count-sub">{bp.family}</span>
              </button>
            ))}
          </div>

          <p className="arm-count-label">Sides</p>
          <div className="arm-count-options">
            {sides.map((n) => (
              <button
                key={n}
                className={`arm-count-chip ${active.count === n ? 'selected' : ''}`}
                onClick={() => setBanner({ ...active, count: n })}
              >
                <span className="arm-count-name">{SIDE_LABELS[n] ?? `${n} sides`}</span>
                <span className="arm-count-sub">{n}×</span>
              </button>
            ))}
          </div>

          <label className="banner-height">
            <span>Height up shaft: {active.heightFt} ft</span>
            <input
              type="range"
              min={BANNER_MIN_FT}
              max={maxFt}
              step={1}
              value={Math.min(active.heightFt, maxFt)}
              onChange={(e) => setBanner({ ...active, heightFt: Number(e.target.value) })}
            />
          </label>

          {geom && (
            <dl className="banner-dims">
              <div>
                <dt>Banner height</dt>
                <dd>
                  {formatIn(geom.panelHeightM)}{' '}
                  <span className="subtle">({formatFtIn(geom.panelHeightM)})</span>
                </dd>
              </div>
              <div>
                <dt>Top bar above grade</dt>
                <dd>{formatFtIn(geom.topBarM)}</dd>
              </div>
              <div>
                <dt>Bottom bar above grade</dt>
                <dd>{formatFtIn(geom.bottomBarM)}</dd>
              </div>
              <div>
                <dt>Banner width</dt>
                <dd>{formatIn(geom.panelWidthM)}</dd>
              </div>
            </dl>
          )}

          <p className="spec-options-note subtle">Custom banner artwork is a future feature — not included in this preview.</p>
        </div>
      )}
    </div>
  )
}
