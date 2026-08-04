import { useState } from 'react'
import type { Catalog, CatalogPart, PoleConfig, Slot, SpecOption } from '../types'
import { allowedArmCounts, ARM_ORIENTATIONS, compatibleParts, finishFor, optionLabel, partById, specCodes, voltageCompatible } from '../lib/compat'
import { useConfigurator } from '../store'
import { BannerPicker } from './BannerPicker'

/** Phase 0.8 (A1): labels for the radial arm-count selector (official layouts: 2@180, 3@90, 4@90). */
const ARM_COUNT_LABELS: Record<number, { label: string; sub: string }> = {
  1: { label: 'Single', sub: '1 arm' },
  2: { label: 'Twin', sub: '2 arms · 180°' },
  3: { label: 'Triple', sub: '3 arms · 90°' },
  4: { label: 'Quad', sub: '4 arms · 90°' },
}

interface Props {
  catalog: Catalog
  config: PoleConfig
}

// Phase 1.0 (concierge steps): one distinct chapter per part of the structure,
// fixture-first per Round 1 feedback — downstream steps filter on the fixture's
// mounting requirements. Finish is no longer a global step: each part carries
// its own finish, and each spec-parsed part exposes its sheet's ordering table
// (base configuration) and options & accessories inside its own step.
const STEPS: { key: Slot; label: string; tagline: string }[] = [
  { key: 'fixture', label: 'Fixture', tagline: 'Start with the light itself — everything else follows from the fixture.' },
  { key: 'arm', label: 'Arm', tagline: 'How the fixture reaches out from the pole.' },
  { key: 'pole', label: 'Pole', tagline: 'The structure that carries it all.' },
  { key: 'baseCover', label: 'Base Cover', tagline: 'The finishing touch at the foundation.' },
]

/**
 * Ordering columns whose values are the paint color. The step's finish swatch
 * row IS this choice (it also drives the render), so the raw dropdown is
 * hidden to avoid asking for the same thing twice.
 */
function isFinishColumn(opt: SpecOption): boolean {
  return opt.key.startsWith('finish-color')
}

/**
 * Ordering columns already answered by picking the step's part itself
 * (choosing "GVX Pendant" or the WiLLstudio pole IS the product family +
 * design), so their dropdowns are hidden from every step. They stay in the
 * catalog data so the part number still carries their codes.
 */
const IMPLIED_COLUMNS = new Set(['product-family', 'design'])

function isImpliedColumn(_slot: Slot, opt: SpecOption): boolean {
  return IMPLIED_COLUMNS.has(opt.key)
}

export function Panel({ catalog, config }: Props) {
  const select = useConfigurator((s) => s.select)
  const setArmCount = useConfigurator((s) => s.setArmCount)
  const [openStep, setOpenStep] = useState<Slot>('fixture')

  // Hide steps the brand has no parts for (e.g. NAFCO has no base covers)
  const steps = STEPS.filter((step) => compatibleParts(catalog, config, step.key).length > 0)

  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const part = partById(catalog, config[step.key])
        const finish = catalog.finishes.find((f) => f.id === finishFor(config, step.key))
        const open = openStep === step.key
        const nextStep = steps[i + 1]

        return (
          <section key={step.key} className={`step ${open ? 'open' : ''}`}>
            <button className="step-header" onClick={() => setOpenStep(step.key)}>
              <span className="step-num">{i + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="step-selected">
                {finish && (
                  <span
                    className="swatch inline"
                    style={{ background: config.finishRal?.[step.key] ?? finish.hex }}
                  />
                )}
                {part?.name ?? '—'}
              </span>
            </button>
            {open && (
              <div className="step-body">
                <p className="step-tagline">{step.tagline}</p>
                <PartChoice
                  parts={compatibleParts(catalog, config, step.key)}
                  selectedId={config[step.key]}
                  onSelect={(id) => select(step.key, id)}
                />
                {/* Phase 0.8 (A1/A2): radial arm-count selector — only shown when
                    the chosen pole + arm actually support multiples (catalog rule). */}
                {step.key === 'arm' && <ArmCountSelector catalog={catalog} config={config} onSelect={setArmCount} />}
                {/* Phase 1.0: rotate the arrangement about the pole (0/90/180/270°). */}
                {step.key === 'arm' && <ArmOrientationSelector catalog={catalog} config={config} />}
                <StepFinish catalog={catalog} config={config} slot={step.key} part={part} />
                {part && <StepSpecOptions config={config} slot={step.key} part={part} />}
                {/* Phase 0.9 (A2): banner-arm accessory mounts on the pole shaft,
                    so its controls live inside the Pole step (no standalone section). */}
                {step.key === 'pole' && <BannerPicker catalog={catalog} config={config} />}
                {nextStep && (
                  <button className="step-continue" onClick={() => setOpenStep(nextStep.key)}>
                    Continue to {nextStep.label} →
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * Phase 1.0: this part's own finish. Selecting a swatch overrides the base
 * finish for this slot only; parts left untouched follow the base finish (so
 * the describe-box "in a black finish" still colors the whole structure).
 */
function StepFinish({
  catalog,
  config,
  slot,
  part,
}: {
  catalog: Catalog
  config: PoleConfig
  slot: Slot
  part: CatalogPart | undefined
}) {
  const setFinish = useConfigurator((s) => s.setFinish)
  const setFinishRal = useConfigurator((s) => s.setFinishRal)
  const current = finishFor(config, slot)
  const ralHex = config.finishRal?.[slot]
  // Offer the finishes this part comes in; an empty list means unrestricted.
  // Custom RAL is always offered — it's a match-anything order code.
  const offered =
    part && part.finishes.length > 0
      ? catalog.finishes.filter((f) => f.id === 'custom-ral' || part.finishes.includes(f.id))
      : catalog.finishes
  if (offered.length === 0) return null
  return (
    <div className="step-group">
      <p className="step-group-title">Finish</p>
      <div className="options finishes">
        {offered.map((f) => {
          const isRal = f.id === 'custom-ral'
          return (
            <button
              key={f.id}
              className={`finish-chip ${current === f.id ? 'selected' : ''}`}
              onClick={() => setFinish(slot, f.id)}
              title={f.name}
            >
              {isRal && !ralHex ? (
                <span className="swatch ral-rainbow" />
              ) : (
                <span className="swatch" style={{ background: isRal ? ralHex : f.hex }} />
              )}
              <span>{f.name}</span>
            </button>
          )
        })}
      </div>
      {current === 'custom-ral' && (
        <label className="ral-picker">
          <input
            type="color"
            value={ralHex ?? '#b0b0b3'}
            onChange={(e) => setFinishRal(slot, e.target.value)}
          />
          <span>
            Pick your RAL match color{ralHex ? ` — ${ralHex.toUpperCase()}` : ''}. We’ll match the
            closest RAL shade with your quote.
          </span>
        </label>
      )}
    </div>
  )
}

/**
 * Phase 0.8 (Workstream D), moved into the step in 1.0: the part's spec-sheet
 * ordering table, split the way the sheet is — base configuration (ordering
 * columns) and options & accessories. Values not confirmed buildable online
 * are flagged "quote". Parts without a parsed sheet render nothing.
 */
function StepSpecOptions({
  config,
  slot,
  part,
}: {
  config: PoleConfig
  slot: Slot
  part: CatalogPart
}) {
  const setSpecOption = useConfigurator((s) => s.setSpecOption)
  const toggleSpecOption = useConfigurator((s) => s.toggleSpecOption)
  // Both spec-sheet groups stay tucked behind disclosures — the standard
  // build needs neither, so they shouldn't crowd the step until asked for.
  const [showBase, setShowBase] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const options = part.options
  if (!options || options.length === 0) return null

  const chosen = config.specOptions?.[slot] ?? {}
  const byPosition = (a: SpecOption, b: SpecOption) => a.orderPosition - b.orderPosition
  const baseOpts = options
    .filter((o) => o.group === 'ordering' && !isFinishColumn(o) && !isImpliedColumn(slot, o))
    .sort(byPosition)
  const extraOpts = options.filter((o) => o.group === 'options-accessories').sort(byPosition)
  const baseCount = baseOpts.reduce((n, o) => n + (specCodes(chosen[o.key])[0] ? 1 : 0), 0)
  const extrasCount = extraOpts.reduce((n, o) => n + specCodes(chosen[o.key]).length, 0)
  const partial = part.optionsMeta?.parseStatus === 'partial'

  return (
    <>
      {baseOpts.length > 0 && (
        <div className="step-group">
          <button
            type="button"
            className="extras-toggle"
            onClick={() => setShowBase((v) => !v)}
            aria-expanded={showBase}
          >
            <span className="step-group-title">Base configuration</span>
            <span className="extras-meta">
              {baseCount > 0 ? (
                <span className="extras-count">{baseCount} set</span>
              ) : (
                <span className="extras-optional">standard</span>
              )}
              <span className="extras-arrow">{showBase ? '▾' : '▸'}</span>
            </span>
          </button>
          {showBase &&
            baseOpts.map((opt) => (
              <label className="spec-option" key={opt.key}>
                <span className="spec-option-label">{optionLabel(opt)}</span>
                <select
                  value={specCodes(chosen[opt.key])[0] ?? ''}
                  onChange={(e) => setSpecOption(slot, opt.key, e.target.value)}
                >
                  <option value="">Standard / not specified</option>
                  {opt.values.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.code} — {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
      {extraOpts.length > 0 && (
        <div className="step-group">
          <button
            type="button"
            className="extras-toggle"
            onClick={() => setShowExtras((v) => !v)}
            aria-expanded={showExtras}
          >
            <span className="step-group-title">Options &amp; accessories</span>
            <span className="extras-meta">
              {extrasCount > 0 ? (
                <span className="extras-count">{extrasCount} selected</span>
              ) : (
                <span className="extras-optional">optional</span>
              )}
              <span className="extras-arrow">{showExtras ? '▾' : '▸'}</span>
            </span>
          </button>
          {showExtras &&
            extraOpts.map((opt) => (
              // Multi-select: check any combination; exclusive families
              // (cord/surge/photocontrol) auto-swap in the store, and a
              // chosen voltage hides gear rated for the other range.
              <div className="spec-option" key={opt.key}>
                {opt.values
                  .filter((v) => voltageCompatible(specCodes(chosen['voltage'])[0], v.label))
                  .map((v) => {
                    const checked = specCodes(chosen[opt.key]).includes(v.code)
                    return (
                      <label className={`spec-check ${checked ? 'checked' : ''}`} key={v.code}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSpecOption(slot, opt.key, v.code)}
                        />
                        <span className="spec-check-text">
                          <span className="spec-check-code">{v.code}</span> {v.label}
                        </span>
                      </label>
                    )
                  })}
              </div>
            ))}
        </div>
      )}
      <p className="spec-options-note subtle">
        From the {part.name} spec sheet — your selections are included in the quote request.
        {partial && ` Some columns need a human review pass (${part.optionsMeta?.gaps.length ?? 0} flagged).`}
      </p>
    </>
  )
}

/**
 * Phase 1.0: the step's part choices. Normally a card grid; when every choice
 * is the same design at a different height (single family, all with heightFt —
 * the WiLLstudio pole system), the design is implied by the step itself and
 * the cards collapse to a "Height" chip row, sorted short → tall.
 */
function PartChoice({
  parts,
  selectedId,
  onSelect,
}: {
  parts: CatalogPart[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const singleDesign =
    parts.length > 1 &&
    new Set(parts.map((p) => p.family)).size === 1 &&
    parts.every((p) => p.heightFt !== undefined)

  if (singleDesign) {
    const byHeight = [...parts].sort((a, b) => (a.heightFt ?? 0) - (b.heightFt ?? 0))
    return (
      <div className="arm-count">
        <p className="arm-count-label">Height</p>
        <div className="arm-count-options">
          {byHeight.map((p) => (
            <button
              key={p.id}
              className={`arm-count-chip ${selectedId === p.id ? 'selected' : ''}`}
              onClick={() => onSelect(p.id)}
              title={p.name}
            >
              <span className="arm-count-name">{p.heightFt} ft</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="options">
      {parts.map((p) => (
        <button
          key={p.id}
          className={`option-card ${selectedId === p.id ? 'selected' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          <span className="thumb">
            {p.thumbnail ? (
              <img src={import.meta.env.BASE_URL + p.thumbnail} alt="" />
            ) : p.photo ? (
              <img src={p.photo} alt="" loading="lazy" />
            ) : (
              p.family.slice(0, 2).toUpperCase()
            )}
          </span>
          <span className="option-name">{p.name}</span>
          <span className="option-family">{p.family}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Phase 1.0: rotate the whole arm arrangement about the pole — 0/90/180/270°.
 * Hidden for arms with no lateral reach (the direct-mount tenon adapter),
 * where rotation changes nothing; reach is read from the arm's fixture socket,
 * never from a hardcoded part list.
 */
function ArmOrientationSelector({ catalog, config }: { catalog: Catalog; config: PoleConfig }) {
  const setArmOrientation = useConfigurator((s) => s.setArmOrientation)
  const arm = partById(catalog, config.arm)
  const socket = Object.values(arm?.sockets ?? {})[0]
  const reach = socket ? Math.hypot(socket.position[0], socket.position[2]) : 0
  if (reach < 0.05) return null
  const current = config.armOrientation ?? 0
  return (
    <div className="arm-count">
      <p className="arm-count-label">Orientation</p>
      <div className="arm-count-options">
        {ARM_ORIENTATIONS.map((deg) => (
          <button
            key={deg}
            className={`arm-count-chip ${current === deg ? 'selected' : ''}`}
            onClick={() => setArmOrientation(deg)}
            title={`Rotate the arm arrangement to ${deg}°`}
          >
            <span className="arm-count-name">{deg}°</span>
          </button>
        ))}
      </div>
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
      <p className="arm-count-label">Design Configuration</p>
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
