import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import {
  partNumbersText,
  resolveAssemblyPartNumbers,
  unresolvedCount,
  type PartNumber,
} from '../lib/partNumber'

/**
 * Phase 0.10, Workstream 0 — the headline output.
 *
 * Per Tyler (8/3) the configured **part number is what we're chasing**: the
 * designer copies the WiLL SKU into their project spec and it becomes the
 * basis of design. So the numbers get the most prominent card in the panel,
 * every component gets its own, and anything unfinished says so out loud
 * instead of looking spec-able.
 */

interface Props {
  catalog: Catalog
  config: PoleConfig
}

export function PartNumbers({ catalog, config }: Props) {
  const [copied, setCopied] = useState(false)
  const numbers = resolveAssemblyPartNumbers(catalog, config)
  if (numbers.length === 0) return null

  const copy = async () => {
    await navigator.clipboard.writeText(partNumbersText(numbers).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const incomplete = numbers.filter((n) => !n.unavailable && !n.complete).length
  const pending = numbers.filter((n) => n.unavailable).length

  return (
    <section className="part-numbers">
      <div className="part-numbers-head">
        <h2>WiLL Part Numbers</h2>
        <button className="btn secondary small" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy all'}
        </button>
      </div>
      <ul className="part-number-list">
        {numbers.map((number) => (
          <PartNumberRow key={number.partId} number={number} />
        ))}
      </ul>
      {incomplete > 0 && (
        <p className="part-numbers-note">
          {incomplete} number{incomplete === 1 ? '' : 's'} still {incomplete === 1 ? 'has' : 'have'}{' '}
          <code>?</code> segments — open that component and choose the highlighted options to make it
          spec-able.
        </p>
      )}
      {pending > 0 && (
        <p className="part-numbers-note subtle">
          {pending} component{pending === 1 ? '' : 's'} {pending === 1 ? 'has' : 'have'} no published
          ordering matrix yet — we show nothing rather than guess a code.
        </p>
      )}
    </section>
  )
}

function PartNumberRow({ number }: { number: PartNumber }) {
  const [open, setOpen] = useState(false)
  const missing = unresolvedCount(number)

  if (number.unavailable) {
    return (
      <li className="part-number pending">
        <span className="part-number-slot">{number.slotLabel}</span>
        <span className="part-number-code muted">Ordering matrix pending</span>
        <span className="part-number-name">{number.partName}</span>
      </li>
    )
  }

  return (
    <li className={`part-number ${number.complete ? 'complete' : 'incomplete'}`}>
      <button
        type="button"
        className="part-number-main"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Show how this number is built"
      >
        <span className="part-number-slot">{number.slotLabel}</span>
        <code className="part-number-code">{number.code}</code>
        <span className="part-number-state">
          {number.complete ? '✓' : `${missing} to choose`}
          <span className="part-number-arrow">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="part-number-breakdown">
          <p className="part-number-name">{number.partName}</p>
          <table>
            <tbody>
              {number.segments.map((segment, i) => (
                <tr key={`${segment.label}-${segment.code ?? i}`} className={segment.code ? '' : 'unset'}>
                  <th>{segment.label}</th>
                  <td>
                    <code>{segment.code ?? '?'}</code>
                  </td>
                  <td>{segment.valueLabel ?? (segment.code ? '' : 'not specified')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {number.parseFlagged && (
            <p className="part-numbers-note subtle">
              Parsed from this product's spec sheet; some columns are flagged for human review.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** Compact chip for a step header — the component's number at a glance. */
export function PartNumberChip({ number }: { number: PartNumber | undefined }) {
  if (!number || number.unavailable) return null
  return (
    <code className={`part-number-chip ${number.complete ? 'complete' : 'incomplete'}`}>
      {number.code}
    </code>
  )
}
