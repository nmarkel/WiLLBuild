import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { compatibleParts, configStatus, partById } from '../lib/compat'
import { armArrangementLabel, buildSummaryText, SUMMARY_ROWS } from '../lib/summary'
import { displayPartName } from '../lib/display'
import { useConfigurator } from '../store'
import type { Slot } from '../types'

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
 * Share/Quote behavior moved here from Summary.
 *
 * Phase 0.11 (F3) came WITH them: share the build the customer is actually
 * looking at. `shareLink()` carries the live viewer scene, which a bare
 * `shareUrl(config)` silently replaced with the default backdrop — so the
 * pasted link restored a different scene than the one they shared. Both
 * branches touched this code in parallel; the fix has to live wherever the
 * buttons live, which is now here rather than Summary.
 */
export function BottomBar({ catalog, config, onOpenDownloads }: Props) {
  const [copied, setCopied] = useState(false)
  const shareLink = useConfigurator((s) => s.shareLink)
  const scene = useConfigurator((s) => s.scene)

  const status = configStatus(catalog, config)
  // Blank-slate builder: quoting or downloading a half-built pole ships a
  // half-meaningful artifact — both wait until every slot the brand offers is
  // chosen. Share stays live (sharing a work-in-progress is legitimate).
  const incomplete = (['fixture', 'arm', 'pole', 'baseCover'] as Slot[]).some(
    (slot) => !config[slot] && compatibleParts(catalog, config, slot).length > 0,
  )
  // The quote body embeds the same link, so it needs the same live scene.
  const quoteHref = `${QUOTE_URL}?configuration=${encodeURIComponent(buildSummaryText(catalog, config, scene))}`
  const names = SUMMARY_ROWS.map((r) => {
    const part = partById(catalog, config[r.key])
    return part && displayPartName(part.name)
  }).filter(Boolean)
  if ((config.armCount ?? 1) > 1) names.splice(2, 0, armArrangementLabel(config.armCount ?? 1))

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareLink())
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
        <button
          className="btn secondary"
          onClick={onOpenDownloads}
          disabled={incomplete}
          title={incomplete ? 'Finish your build to unlock downloads' : undefined}
        >
          Downloads
        </button>
        <button className="btn secondary" onClick={copyLink}>
          {copied ? 'Link Copied ✓' : 'Share'}
        </button>
        {incomplete ? (
          <button className="btn primary" disabled title="Finish your build to request a quote">
            Request a Quote
          </button>
        ) : (
          <a className="btn primary" href={quoteHref} target="_blank" rel="noreferrer">
            Request a Quote
          </a>
        )}
      </div>
    </div>
  )
}
