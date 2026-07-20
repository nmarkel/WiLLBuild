import { useState } from 'react'
import type { Catalog, PoleConfig, Slot } from '../types'
import { compatibleParts, partById } from '../lib/compat'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

// Fixture-first per Round 1 feedback: downstream steps filter on the fixture's
// mounting requirements.
const STEPS: { key: Slot | 'finish'; label: string }[] = [
  { key: 'fixture', label: 'Fixture' },
  { key: 'arm', label: 'Arm' },
  { key: 'pole', label: 'Pole' },
  { key: 'baseCover', label: 'Base Cover' },
  { key: 'finish', label: 'Finish' },
]

export function Panel({ catalog, config }: Props) {
  const select = useConfigurator((s) => s.select)
  const [openStep, setOpenStep] = useState<Slot | 'finish'>('fixture')

  // Hide steps the brand has no parts for (e.g. NAFCO has no base covers)
  const steps = STEPS.filter(
    (step) =>
      step.key === 'finish' || compatibleParts(catalog, config, step.key as Slot).length > 0,
  )

  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const isFinish = step.key === 'finish'
        const selectedName = isFinish
          ? catalog.finishes.find((f) => f.id === config.finish)?.name
          : partById(catalog, config[step.key])?.name
        const open = openStep === step.key

        return (
          <section key={step.key} className={`step ${open ? 'open' : ''}`}>
            <button className="step-header" onClick={() => setOpenStep(step.key)}>
              <span className="step-num">{i + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="step-selected">{selectedName}</span>
            </button>
            {open && (
              <div className={isFinish ? 'options finishes' : 'options'}>
                {isFinish && catalog.finishesProvisional && (
                  <p className="finish-note">Standard WiLLcoat palette pending confirmation — colors shown are provisional.</p>
                )}
                {isFinish
                  ? catalog.finishes.map((f) => (
                      <button
                        key={f.id}
                        className={`finish-chip ${config.finish === f.id ? 'selected' : ''}`}
                        onClick={() => select('finish', f.id)}
                        title={f.name}
                      >
                        <span className="swatch" style={{ background: f.hex }} />
                        <span>{f.name}</span>
                      </button>
                    ))
                  : compatibleParts(catalog, config, step.key as Slot).map((part) => (
                      <button
                        key={part.id}
                        className={`option-card ${config[step.key] === part.id ? 'selected' : ''}`}
                        onClick={() => select(step.key, part.id)}
                      >
                        <span className="thumb">
                          {part.thumbnail ? (
                            <img src={import.meta.env.BASE_URL + part.thumbnail} alt="" />
                          ) : part.photo ? (
                            <img src={part.photo} alt="" loading="lazy" />
                          ) : (
                            part.family.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <span className="option-name">{part.name}</span>
                        <span className="option-family">{part.family}</span>
                      </button>
                    ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
