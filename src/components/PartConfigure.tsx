import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { allowedArmCounts } from '../lib/compat'
import {
  designsForCount,
  mergedMultiSelectFields,
  resolvePartNumber,
  singleSelectColumns,
} from '../lib/partNumber'
import { armArrangementLabel } from '../lib/summary'
import { useConfigurator } from '../store'

/**
 * Phase 0.10, Workstream A2 — the "configure it" half of the Sternberg flow.
 *
 * Tyler's liked model is: choose a part → configure it → next part → configure
 * it. This block is what a chosen part gets configured with: its arm count (which
 * resolves the ordering-matrix Design code), its single-select ordering columns,
 * and its multi-select **Options** field. Everything is driven by the part's own
 * matrix data, so a part with no matrix simply shows nothing.
 *
 * Workstream B: no "quote" flagging anywhere in here — Tyler asked for the quote
 * reference to come out of the option dropdowns (reversing 0.8's D flagging).
 */

interface Props {
  catalog: Catalog
  config: PoleConfig
  part: CatalogPart
}

export function PartConfigure({ catalog, config, part }: Props) {
  const setPartOption = useConfigurator((s) => s.setPartOption)
  const togglePartAddOn = useConfigurator((s) => s.togglePartAddOn)
  const setArmCount = useConfigurator((s) => s.setArmCount)

  const selections = config.partOptions?.[part.id] ?? {}
  const counts = part.slot === 'arm' ? allowedArmCounts(catalog, config) : []
  const designChoices = part.slot === 'arm' ? designsForCount(part, config.armCount ?? 1) : []
  const single = singleSelectColumns(part)
  const multi = mergedMultiSelectFields(part)
  const number = resolvePartNumber(catalog, config, part.id)

  const hasArmControls = counts.length > 1 || designChoices.length > 1
  if (!hasArmControls && single.length === 0 && multi.length === 0 && number.unavailable) return null

  return (
    <div className="part-configure">
      <p className="part-configure-title">Configure {part.name}</p>

      {/* --- Arm family + count → Design code (Workstream A) --- */}
      {counts.length > 1 && (
        <div className="arm-count">
          <p className="arm-count-label">
            Number of arms <span className="subtle">— sets the {part.ordering?.familyLabel ?? 'design'} code</span>
          </p>
          <div className="arm-count-options">
            {counts.map((n) => {
              const design = designsForCount(part, n)
              const code = design.length === 1 ? design[0].code : undefined
              return (
                <button
                  key={n}
                  className={`arm-count-chip ${(config.armCount ?? 1) === n ? 'selected' : ''}`}
                  onClick={() => setArmCount(n)}
                  title={armArrangementLabel(n)}
                >
                  <span className="arm-count-name">{armArrangementLabel(n)}</span>
                  {code && <span className="arm-count-sub">{code}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {counts.length === 1 && part.ordering && (
        <p className="part-configure-fixed">
          {part.ordering.familyLabel} ships as {armArrangementLabel(counts[0]).toLowerCase()}
          {designsForCount(part, counts[0])[0]?.code
            ? ` (${designsForCount(part, counts[0])[0].code})`
            : ''}
          .
        </p>
      )}

      {/* Several designs share one arm count (upsweep 24"/36") — the customer picks. */}
      {designChoices.length > 1 && (
        <label className="spec-option">
          <span className="spec-option-label">Design</span>
          <select
            value={selections.codes?.design ?? ''}
            onChange={(e) => setPartOption(part.id, 'design', e.target.value)}
          >
            <option value="">Choose a design…</option>
            {designChoices.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* --- Single-select ordering columns from the spec sheet --- */}
      {single.map((column) => (
        <label className="spec-option" key={column.key}>
          <span className="spec-option-label">{column.label}</span>
          <select
            value={selections.codes?.[column.key] ?? ''}
            onChange={(e) => setPartOption(part.id, column.key, e.target.value)}
          >
            <option value="">Not specified</option>
            {column.values.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code} — {v.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {/* --- The multi-select Options field (Workstream B) --- */}
      {(multi.length > 0 || (part.ordering?.options?.length ?? 0) > 0) && (
        <fieldset className="add-ons">
          <legend>Options — select any that apply</legend>
          {part.ordering?.options?.map((option) => (
            <AddOn
              key={option.code}
              code={option.code}
              label={option.label}
              checked={(selections.addOns ?? []).includes(option.code)}
              onChange={(on) => togglePartAddOn(part.id, option.code, on)}
            />
          ))}
          {multi.map((column) => (
            <div className="add-on-group" key={column.key}>
              <p className="add-on-group-label">{column.label}</p>
              {column.values.map((value) => (
                <AddOn
                  key={value.code}
                  code={value.code}
                  label={value.label}
                  checked={(selections.addOns ?? []).includes(value.code)}
                  onChange={(on) => togglePartAddOn(part.id, value.code, on)}
                />
              ))}
            </div>
          ))}
        </fieldset>
      )}

      {/* --- What all of that resolves to --- */}
      {number.unavailable ? (
        <p className="part-configure-number pending">
          Part number: <span className="muted">ordering matrix pending for this product</span>
        </p>
      ) : (
        <p className={`part-configure-number ${number.complete ? 'complete' : 'incomplete'}`}>
          Part number: <code>{number.code}</code>
        </p>
      )}
    </div>
  )
}

function AddOn({
  code,
  label,
  checked,
  onChange,
}: {
  code: string
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className={`add-on ${checked ? 'selected' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <code>{code}</code>
      <span>{label}</span>
    </label>
  )
}
