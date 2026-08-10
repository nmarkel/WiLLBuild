import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { configStatus, partById } from '../lib/compat'
import { armArrangementLabel, buildSummaryText, SUMMARY_ROWS } from '../lib/summary'
import { shareUrl } from '../lib/url'

const QUOTE_URL = 'https://willbrands.com/pages/request-a-quote'

interface Props {
  catalog: Catalog
  config: PoleConfig
  onOpenDownloads: () => void
}

/**
 * Phase 0.10.5_TO (Tesla-style builder): sticky bar under the viewer — the
 * "Order Now" strip. Left: the build at a glance; right: Downloads / Share /
 * Request a Quote (the quote CTA is the order analog — no pricing exists).
 * Share/Quote behavior moved here from Summary unchanged.
 */
export function BottomBar({ catalog, config, onOpenDownloads }: Props) {
  const [copied, setCopied] = useState(false)

  const status = configStatus(catalog, config)
  const quoteHref = `${QUOTE_URL}?configuration=${encodeURIComponent(buildSummaryText(catalog, config))}`
  const names = SUMMARY_ROWS.map((r) => partById(catalog, config[r.key])?.name).filter(Boolean)
  if ((config.armCount ?? 1) > 1) names.splice(2, 0, armArrangementLabel(config.armCount ?? 1))

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl(config))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="builder-bottom-bar">
      <div className="bottom-bar-info">
        <span className="bottom-bar-summary" title={names.join(' · ')}>
          {names.join(' · ')}
        </span>
        <span className="bottom-bar-meta">
          <span className={`status-chip ${status.toLowerCase()}`}>{status}</span>
          <span className="bottom-bar-config-id" title={config.configId}>
            Config ID: {config.configId.slice(0, 8)}
          </span>
        </span>
      </div>
      <div className="bottom-bar-actions">
        <button className="btn secondary" onClick={onOpenDownloads}>
          Downloads
        </button>
        <button className="btn secondary" onClick={copyLink}>
          {copied ? 'Link Copied ✓' : 'Share'}
        </button>
        <a className="btn primary" href={quoteHref} target="_blank" rel="noreferrer">
          Request a Quote
        </a>
      </div>
    </div>
  )
}
