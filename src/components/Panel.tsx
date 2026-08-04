import { useEffect, useState } from 'react'
import type { Catalog, PoleConfig, Slot } from '../types'
import { compatibleParts, partById } from '../lib/compat'
import { resolvePartNumber } from '../lib/partNumber'
import { useConfigurator } from '../store'
import { OptionsStep } from './OptionsStep'
import { PartConfigure } from './PartConfigure'
import { PartNumberChip } from './PartNumbers'

/**
 * Phase 0.10, Workstream A2 — the Sternberg-style flow.
 *
 * Tyler's liked model (Sternberg Genesis3D): **choose a part → configure it →
 * next part → configure it**, sequentially. So each step now has two halves —
 * pick the product, then configure that product (its ordering columns, its arm
 * count, its Options) — and ends with a "Next" hand-off to the following part.
 * The step header carries that component's live WiLL part number, because the
 * number is the deliverable (Workstream 0).
 *
 * Base cover and banner are no longer steps of their own: they are entries in
 * the Options step (Workstream B).
 */

type StepKey = Slot | 'options' | 'finish'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

// Fixture-first per Round 1 feedback: downstream steps filter on the fixture's
// mounting requirements. Base cover left the stepper in 0.10 (it is an Option).
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'fixture', label: 'Fixture' },
  { key: 'arm', label: 'Arm' },
  { key: 'pole', label: 'Pole' },
  { key: 'options', label: 'Options' },
  { key: 'finish', label: 'Finish' },
]

const isPartStep = (key: StepKey): key is Slot => key !== 'options' && key !== 'finish'

export function Panel({ catalog, config }: Props) {
  const select = useConfigurator((s) => s.select)
  const [openStep, setOpenStep] = useState<StepKey>('fixture')

  // Hide part steps the brand has no parts for (e.g. a line with no arms).
  const steps = STEPS.filter(
    (step) => !isPartStep(step.key) || compatibleParts(catalog, config, step.key).length > 0,
  )

  // Keep the open step valid when the brand switch removes it.
  useEffect(() => {
    if (!steps.some((s) => s.key === openStep)) setOpenStep(steps[0]?.key ?? 'finish')
  }, [steps, openStep])

  const stepIndex = steps.findIndex((s) => s.key === openStep)
  const nextStep = steps[stepIndex + 1]

  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const open = openStep === step.key
        // Narrow once, so the part branch below can index the config by slot.
        const slot: Slot | null = isPartStep(step.key) ? step.key : null
        const part = slot ? partById(catalog, config[slot]) : undefined
        const selectedName =
          step.key === 'finish'
            ? catalog.finishes.find((f) => f.id === config.finish)?.name
            : step.key === 'options'
              ? optionsSummary(catalog, config)
              : part?.name
        const number = part ? resolvePartNumber(catalog, config, part.id) : undefined

        return (
          <section key={step.key} className={`step ${open ? 'open' : ''}`}>
            <button className="step-header" onClick={() => setOpenStep(step.key)}>
              <span className="step-num">{i + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="step-selected">{selectedName}</span>
              <PartNumberChip number={number} />
            </button>
            {open && (
              <div className={step.key === 'finish' ? 'options finishes' : 'step-body'}>
                {/* --- 1. Choose the part --- */}
                {step.key === 'finish' ? (
                  <>
                    {catalog.finishesProvisional && (
                      <p className="finish-note">
                        Standard WiLLcoat palette pending confirmation — colors shown are provisional.
                      </p>
                    )}
                    {catalog.finishes.map((f) => (
                      <button
                        key={f.id}
                        className={`finish-chip ${config.finish === f.id ? 'selected' : ''}`}
                        onClick={() => select('finish', f.id)}
                        title={f.code ? `${f.name} (${f.code})` : f.name}
                      >
                        <span className="swatch" style={{ background: f.hex }} />
                        <span>{f.name}</span>
                        {f.code && <span className="finish-code">{f.code}</span>}
                      </button>
                    ))}
                  </>
                ) : step.key === 'options' ? (
                  <OptionsStep catalog={catalog} config={config} />
                ) : slot ? (
                  <>
                    <div className="options">
                      {compatibleParts(catalog, config, slot).map((option) => (
                        <button
                          key={option.id}
                          className={`option-card ${config[slot] === option.id ? 'selected' : ''}`}
                          onClick={() => select(slot, option.id)}
                        >
                          <span className="thumb">
                            {option.thumbnail ? (
                              <img src={import.meta.env.BASE_URL + option.thumbnail} alt="" />
                            ) : option.photo ? (
                              <img src={option.photo} alt="" loading="lazy" />
                            ) : (
                              option.family.slice(0, 2).toUpperCase()
                            )}
                          </span>
                          <span className="option-name">{option.name}</span>
                          <span className="option-family">
                            {option.ordering?.familyLabel ?? option.family}
                          </span>
                        </button>
                      ))}
                    </div>
                    {/* --- 2. Configure the chosen part --- */}
                    {part && <PartConfigure catalog={catalog} config={config} part={part} />}
                  </>
                ) : null}

                {/* --- 3. On to the next part --- */}
                {nextStep && (
                  <div className="step-next">
                    <button className="btn primary" onClick={() => setOpenStep(nextStep.key)}>
                      Next: {nextStep.label} →
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Header text for the Options step: what the customer has actually added. */
function optionsSummary(catalog: Catalog, config: PoleConfig): string {
  const chosen: string[] = []
  if (config.baseCover) chosen.push(partById(catalog, config.baseCover)?.name ?? 'Base cover')
  if (config.banner) chosen.push('Banner arm')
  return chosen.length > 0 ? chosen.join(' · ') : 'None'
}
