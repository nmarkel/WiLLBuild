import type { Catalog, PoleConfig } from '../types'
import { bannerGeometry, formatFtIn, formatIn } from '../lib/banner'
import { partById } from '../lib/compat'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/**
 * Phase 0.8 (C) / 0.10 (C): configure the mid-shaft banner-arm accessory — the
 * bracket set, how many radial sides it repeats on, and its height up the shaft.
 *
 * 0.10 changes, per Tyler + Nick (8/3):
 *  - the banner height and BOTH bar distances are labelled (a banner is defined
 *    by its two mounting bars) — derived from the part's geometry in
 *    `src/lib/banner.ts`, so the labels always match what is drawn;
 *  - an opposite pair is the confirmed maximum for now (the 4-side layout is
 *    retired until Puddy confirms the true quantity per pole);
 *  - the toggle itself now lives in the Options step, not the Pole step.
 *
 * Banner *hardware* only; custom banner artwork is still deferred.
 */
export function BannerPicker({ catalog, config }: Props) {
  const setBanner = useConfigurator((s) => s.setBanner)
  const bannerParts = catalog.parts.filter((p) => p.slot === 'banner' && p.line === config.brand)
  const active = config.banner
  if (bannerParts.length === 0 || !active) return null

  const part = partById(catalog, active.armId) ?? bannerParts[0]
  const pole = partById(catalog, config.pole)
  const poleFt = pole?.heightFt ?? 20
  const maxFt = Math.max(4, Math.round(poleFt - 2))
  const sides = part.arrangements ?? [1, 2]
  const geom = bannerGeometry(part, active.heightFt)

  const SIDE_LABELS: Record<number, string> = { 1: 'One side', 2: 'Opposite pair' }

  return (
    <div className="banner-picker">
      {bannerParts.length > 1 && (
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
      )}

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
        <span>Mounting height (banner centre): {active.heightFt} ft</span>
        <input
          type="range"
          min={4}
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
              {formatIn(geom.panelHeightM)} <span className="subtle">({formatFtIn(geom.panelHeightM)})</span>
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

      <p className="spec-options-note subtle">
        Banner quantity is capped at an opposite pair pending confirmation of the true maximum per pole.
        Custom banner artwork is a future feature — not included in this preview.
      </p>
    </div>
  )
}
