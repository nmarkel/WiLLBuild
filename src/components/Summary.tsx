import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { bannerPanelSize, configStatus, finishFor, partById } from '../lib/compat'
import { bannerSummaryLine } from '../lib/banner'
import { armArrangementLabel, buildPartNumber, buildSummaryText, SUMMARY_ROWS } from '../lib/summary'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

const QUOTE_URL = 'https://willbrands.com/pages/request-a-quote'

export function Summary({ catalog, config }: Props) {
  const [copied, setCopied] = useState(false)
  // Phase 0.11 (F3): share the build the customer is actually looking at —
  // `shareLink()` carries the live viewer scene, which `shareUrl(config)` alone
  // silently replaced with the default backdrop.
  const shareLink = useConfigurator((s) => s.shareLink)
  const scene = useConfigurator((s) => s.scene)

  const status = configStatus(catalog, config)
  // The quote body embeds the same link, so it needs the same live scene.
  const quoteHref = `${QUOTE_URL}?configuration=${encodeURIComponent(buildSummaryText(catalog, config, scene))}`

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareLink())
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
                  {/* Phase 0.11 (F2): one part number PER PART, never merged into a
                      combined assembly number. The "Part No." tag makes it readable as
                      an ordering number (matches buildSummaryText's `Part No:` lines)
                      instead of an unlabeled code, and the aria-label ties it to its
                      part for screen readers. */}
                  {partNumber && (
                    <span className="summary-pn-row">
                      <span className="summary-pn-tag">Part No.</span>
                      <code
                        className="summary-pn"
                        aria-label={`${r.label} part number`}
                        title={`${r.label} ordering part number`}
                      >
                        {partNumber}
                      </code>
                    </span>
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
            {/* Phase 0.11 (D): "N-side @ X ft" named neither the ordered panel
                nor what the height measures to — the same class of bug as the
                arm-arrangement label fixed in 0.10.5. Route it through the one
                function the quote text and the PDF already share. */}
            <span>
              {(() => {
                const part = partById(catalog, config.banner.armId)
                return part
                  ? bannerSummaryLine(
                      part,
                      config.banner.count,
                      config.banner.heightFt,
                      bannerPanelSize(catalog, config.banner.size),
                    )
                  : `${config.banner.armId} · ${config.banner.count}-side, ${config.banner.heightFt} ft to bottom`
              })()}
            </span>
          </li>
        )}
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
