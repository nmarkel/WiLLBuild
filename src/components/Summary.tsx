import type { Catalog, PoleConfig } from '../types'
import { activeDisclaimers, ASSEMBLY_MODE_LABEL, assemblyModeFor, bannerPanelSize, configStatus, finishFor, partById, slotAppliesInMode } from '../lib/compat'
import { bannerSummaryLine } from '../lib/banner'
import { armArrangementLabel, buildPartNumber, SUMMARY_ROWS } from '../lib/summary'
import { displayPartName } from '../lib/display'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/**
 * Phase 0.10.5_TO: Share / Request a Quote moved to the builder's BottomBar.
 * Phase 0.11 (F3)'s live-scene fix moved WITH them — see BottomBar. Summary is
 * now pure readout, so it deliberately holds no share/quote state.
 */
export function Summary({ catalog, config }: Props) {
  const status = configStatus(catalog, config)
  // Phase 0.21: a slot the build's mode does not use reads "Not applicable",
  // not the "—" an UNCHOSEN slot shows. They are different statements, and on
  // a wall mount the dash sends the reader looking for a pole. Matches the
  // rail's grayed sections and buildSummaryText's quote line.
  const mode = assemblyModeFor(catalog, config)

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
                      {displayPartName(part.name)}
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
              ) : slotAppliesInMode(mode, r.key) ? (
                <span>—</span>
              ) : (
                <span className="summary-na" title={ASSEMBLY_MODE_LABEL[mode]}>
                  Not applicable
                </span>
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
      <p className="config-id" title={config.configId}>
        Config ID: {config.configId.slice(0, 8)}
      </p>
      {/* Phase 0.17 (Tyler 8/19): the attention lines live HERE, together,
          below the configuration — inline they blended into the option rows.
          Distinct but tactful: structure and placement, not shouting. */}
      {(() => {
        const notes = activeDisclaimers(catalog, config)
        if (notes.length === 0) return null
        return (
          <div className="config-notes">
            <p className="config-notes-title">Please note</p>
            <ul>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )
      })()}
    </div>
  )
}
