import type { Catalog, PoleConfig } from '../types'
import { partById } from '../lib/compat'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/**
 * Phase 0.8 (Workstream D): configurator dropdowns driven entirely by the
 * active fixture's spec-sheet ordering matrix (parsed into `part.options` — see
 * scripts/spec-parse + docs/spec-options.md). Values that aren't confirmed
 * buildable online (`buildable !== true`) are flagged "quote" so the customer
 * knows to add them to a quote request rather than treating them as buildable.
 */
export function SpecOptions({ catalog, config }: Props) {
  const setSpecOption = useConfigurator((s) => s.setSpecOption)
  const fixture = partById(catalog, config.fixture)
  const options = fixture?.options
  if (!fixture || !options || options.length === 0) return null

  const groups = [...options].sort((a, b) => a.orderPosition - b.orderPosition)
  const partial = fixture.optionsMeta?.parseStatus === 'partial'

  return (
    <div className="spec-options">
      <h3>Product Options</h3>
      <p className="spec-options-note">
        From the {fixture.name} spec sheet. Options marked <em>quote</em> aren’t confirmed buildable online yet —
        include them in your quote request.
      </p>
      {groups.map((opt) => {
        const selected = config.specOptions?.[opt.key] ?? ''
        return (
          <label className="spec-option" key={opt.key}>
            <span className="spec-option-label">{opt.label}</span>
            <select value={selected} onChange={(e) => setSpecOption(opt.key, e.target.value)}>
              <option value="">Standard / not specified</option>
              {opt.values.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.code} — {v.label}
                  {v.buildable !== true ? ' · quote' : ''}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      {partial && (
        <p className="spec-options-note subtle">
          Some columns on this sheet need a human review pass ({fixture.optionsMeta?.gaps.length ?? 0} flagged).
        </p>
      )}
    </div>
  )
}
