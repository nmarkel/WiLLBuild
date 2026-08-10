import type { Catalog, PoleConfig } from '../types'
import { configStatus, finishFor, partById } from '../lib/compat'
import { armArrangementLabel, buildPartNumber, SUMMARY_ROWS } from '../lib/summary'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

// Phase 0.10.5_TO: Share / Request a Quote moved to the builder's BottomBar.
export function Summary({ catalog, config }: Props) {
  const status = configStatus(catalog, config)

  return (
    <div className="summary">
      <div className="summary-head">
        <h2>Your Configuration</h2>
        <span className={`status-chip ${status.toLowerCase()}`}>{status}</span>
      </div>
      <ul>
        {SUMMARY_ROWS.map((r) => {
          const part = partById(catalog, config[r.key])
          // Phase 0.10.5: each part shows its own finish (per-slot override or base).
          const finish = catalog.finishes.find((f) => f.id === finishFor(config, r.key))
          const partNumber = buildPartNumber(catalog, config, r.key)
          return (
            <li key={r.label} className={partNumber ? 'has-pn' : undefined}>
              <span className="summary-label">{r.label}</span>
              {part ? (
                <span className="summary-part">
                  <span>
                    {finish && (
                      <span
                        className="swatch inline"
                        style={{ background: config.finishRal?.[r.key] ?? finish.hex }}
                        title={finish.name}
                      />
                    )}
                    <a href={part.productUrl} target="_blank" rel="noreferrer">
                      {part.name}
                    </a>
                  </span>
                  {partNumber && (
                    <code className="summary-pn" title="Full ordering part number">
                      {partNumber}
                    </code>
                  )}
                </span>
              ) : (
                <span>—</span>
              )}
            </li>
          )
        })}
        {(config.armCount ?? 1) > 1 && (
          <li>
            <span className="summary-label">Arms</span>
            <span>{armArrangementLabel(config.armCount ?? 1)}</span>
          </li>
        )}
        {!!config.armOrientation && (
          <li>
            <span className="summary-label">Orientation</span>
            <span>{config.armOrientation}°</span>
          </li>
        )}
        {config.banner && (
          <li>
            <span className="summary-label">Banner Arm</span>
            <span>
              {partById(catalog, config.banner.armId)?.name ?? config.banner.armId} · {config.banner.count}-side @{' '}
              {config.banner.heightFt} ft
            </span>
          </li>
        )}
      </ul>
      <p className="config-id" title={config.configId}>
        Config ID: {config.configId.slice(0, 8)}
      </p>
    </div>
  )
}
