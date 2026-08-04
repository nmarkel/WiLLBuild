import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { bannerGeometry, formatFtIn, formatIn } from '../lib/banner'
import { configStatus, partById } from '../lib/compat'
import { armArrangementLabel, buildSummaryText, SUMMARY_ROWS } from '../lib/summary'
import { shareUrl } from '../lib/url'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

const QUOTE_URL = 'https://willbrands.com/pages/request-a-quote'

export function Summary({ catalog, config }: Props) {
  const [copied, setCopied] = useState(false)

  const finish = catalog.finishes.find((f) => f.id === config.finish)
  const status = configStatus(catalog, config)
  const quoteHref = `${QUOTE_URL}?configuration=${encodeURIComponent(buildSummaryText(catalog, config))}`

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl(config))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="summary">
      <div className="summary-head">
        <h2>Your Configuration</h2>
        <span className={`status-chip ${status.toLowerCase()}`}>{status}</span>
      </div>
      <ul>
        {SUMMARY_ROWS.map((r) => {
          const part = partById(catalog, config[r.key])
          return (
            <li key={r.label}>
              <span className="summary-label">{r.label}</span>
              {part ? (
                <a href={part.productUrl} target="_blank" rel="noreferrer">
                  {part.name}
                </a>
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
        {config.banner && (
          <li>
            <span className="summary-label">Banner Arm</span>
            <span>{bannerRowText(catalog, config)}</span>
          </li>
        )}
        <li>
          <span className="summary-label">Finish</span>
          <span>
            <span className="swatch inline" style={{ background: finish?.hex }} />
            {finish?.name}
          </span>
        </li>
      </ul>
      <div className="actions">
        <button className="btn secondary" onClick={copyLink}>
          {copied ? 'Link Copied ✓' : 'Share'}
        </button>
        <a className="btn primary" href={quoteHref} target="_blank" rel="noreferrer">
          Request a Quote
        </a>
      </div>
      <p className="config-id" title={config.configId}>
        Config ID: {config.configId.slice(0, 8)}
      </p>
    </div>
  )
}

/**
 * Phase 0.10 (C): the banner row labels its height and both bar distances —
 * the two bars are what actually define a banner.
 */
function bannerRowText(catalog: Catalog, config: PoleConfig): string {
  const banner = config.banner!
  const part = partById(catalog, banner.armId)
  if (!part) return `${banner.armId} · ${banner.count}-side @ ${banner.heightFt} ft`
  const geom = bannerGeometry(part, banner.heightFt)
  const sides = banner.count === 2 ? 'opposite pair' : `${banner.count}-side`
  if (!geom) return `${part.name} · ${sides} @ ${banner.heightFt} ft`
  return (
    `${part.name} · ${sides} · ${formatIn(geom.panelHeightM)} high · ` +
    `bars ${formatFtIn(geom.bottomBarM)}–${formatFtIn(geom.topBarM)}`
  )
}
