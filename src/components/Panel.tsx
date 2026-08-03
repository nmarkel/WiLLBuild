import { useState } from 'react'
import type { Catalog, PoleConfig, Slot } from '../types'
import { allowedArmCounts, compatibleParts, partById } from '../lib/compat'
import { useConfigurator } from '../store'

/** Phase 0.8 (A1): labels for the radial arm-count selector. */
const ARM_COUNT_LABELS: Record<number, { label: string; sub: string }> = {
  1: { label: 'Single', sub: '1 arm' },
  2: { label: 'Twin', sub: '2 arms · 180°' },
  3: { label: 'Triple', sub: '3 arms · 120°' },
  4: { label: 'Quad', sub: '4 arms · 90°' },
}

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
  const setArmCount = useConfigurator((s) => s.setArmCount)
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
                {/* Phase 0.8 (A1/A2): radial arm-count selector — only shown when
                    the chosen pole + arm actually support multiples (catalog rule). */}
                {step.key === 'arm' && <ArmCountSelector catalog={catalog} config={config} onSelect={setArmCount} />}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * Phase 0.8 (A1/A2): choose how many arms mount radially around the pole top.
 * The available options come straight from catalog rules (allowedArmCounts) so
 * only real, mountable layouts appear; hidden entirely when only single is valid.
 */
function ArmCountSelector({
  catalog,
  config,
  onSelect,
}: {
  catalog: Catalog
  config: PoleConfig
  onSelect: (count: number) => void
}) {
  const counts = allowedArmCounts(catalog, config)
  if (counts.length <= 1) return null
  const current = config.armCount ?? 1
  return (
    <div className="arm-count">
      <p className="arm-count-label">Arms</p>
      <div className="arm-count-options">
        {counts.map((n) => {
          const meta = ARM_COUNT_LABELS[n] ?? { label: `${n}`, sub: `${n} arms` }
          return (
            <button
              key={n}
              className={`arm-count-chip ${current === n ? 'selected' : ''}`}
              onClick={() => onSelect(n)}
              title={`${meta.label} — ${meta.sub}`}
            >
              <span className="arm-count-name">{meta.label}</span>
              <span className="arm-count-sub">{meta.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
