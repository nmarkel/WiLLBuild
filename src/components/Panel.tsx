import { useState } from 'react'
import type { AssemblyMode, Catalog, CatalogPart, PoleConfig, Slot, SpecOption } from '../types'
import { ACCENT_FINISH_KEY, accentFinishFor, accessoryHeightRange, accessorySideOptions, allowedArmCounts, armOrientationOptions, assemblyModeFor, cordCodeFor, fixtureBottomFt, isPlaceable, placementInstances, poleAccessoryValue, poleMountingCodeFor, slotAppliesInMode, snapPlacementHeightFt, valueCompatibleWithChosen, valueText, bannerPanelSize, bannerSizesForLabel, codeAllowedOnPart, compatibleParts, exclusiveFamily, finishFor, isBannerKitLabel, optionLabel, partById, partsForSlot, specCodes, voltageCompatible } from '../lib/compat'
import { formatPanelSize } from '../lib/banner'

/** Side-count labels for accessory placements (banner kits, couplings). */
const SIDE_LABELS: Record<number, string> = {
  1: 'One Side',
  2: 'Opposite Pair · 2@180',
  4: 'Four Sides',
}

/**
 * Phase 0.17 (Tyler 8/19, placement clarity pass): the short customer noun
 * for an accessory label — drives "Hand hole 2" instance headers and
 * "+ Add another hand hole" (the raw label made that read "add another
 * additional hand hole").
 */
function accessoryNoun(label: string): string {
  return label
    .split(',')[0]
    .replace(/^Additional\s+/i, '')
    .replace(/\s+Power\s+Provision$/i, '')
    .replace(/\s+Kit$/i, '')
    .toLowerCase()
}

/** Heights under 4 ft read better in inches (37″), above in feet (8 ft). */
function heightLabel(ft: number): string {
  return ft < 4 ? `${Math.round(ft * 12)}″` : ftLabel(ft)
}

/** Feet as a friendly label — whole feet plain, otherwise feet′ inches″. */
function ftLabel(ft: number): string {
  const totalIn = Math.round(ft * 12)
  const f = Math.floor(totalIn / 12)
  const i = totalIn % 12
  return i === 0 ? `${f} ft` : `${f}′ ${i}″`
}
import { useConfigurator } from '../store'
import { displayArmName, displayPartName } from '../lib/display'
import { nearestRal } from '../lib/ral'
import { COMING_SOON_HINT, COMING_SOON_LABEL, isComingSoon } from '../lib/availability'
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

// Phase 0.10.5 (concierge steps): one distinct chapter per part of the structure,
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
 * Why a step is grayed out, per assembly mode (Phase 0.21).
 *
 * The reason is mode-specific and worth saying: "ground-mounted and complete on
 * its own" and "mounts to a wall" send the customer somewhere different. `pole`
 * has an entry only for exhaustiveness — in pole mode every slot applies, so it
 * is unreachable; a generic string beats leaving the map partial and needing a
 * non-null assertion at the call site.
 */
const NOT_APPLICABLE_NOTE: Record<AssemblyMode, (stepLabel: string) => string> = {
  pole: (step) => `No ${step} to configure.`,
  ground: (step) => `This product is ground-mounted and complete on its own — no ${step} to configure.`,
  wall: (step) => `This bracket mounts to a wall, so the build has no ${step}.`,
}

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
// finish-type is derived from the picked color (FP painted / AN anodized).
// length is derived from the chosen pole's own heightFt (Phase 0.10.5/summary.ts
// buildPartNumber) — a customer-facing "Length" dropdown independent of the
// pole height they already picked would let the two disagree.
// pole-fit is derived from the chosen pole's diameter (Tyler 8/12) — the
// base cover asks the customer nothing.
// fixture-mounting is derived from the bracket (CR-OPT-15) — never asked.
const IMPLIED_COLUMNS = new Set(['product-family', 'design', 'finish-type', 'length', 'pole-fit', 'fixture-mounting'])

function isImpliedColumn(_slot: Slot, opt: SpecOption): boolean {
  // Single-value columns (fixed segments like AB anchor bolts / SB base type /
  // FP finish type) offer no choice — they auto-fill the part number instead.
  return IMPLIED_COLUMNS.has(opt.key) || opt.values.length === 1
}

export function Panel({ catalog, config }: Props) {
  const select = useConfigurator((s) => s.select)
  const setArmCount = useConfigurator((s) => s.setArmCount)
  // Phase 0.12_TO (Tyler, 8/12): the categories collapse — ONE open at a
  // time, the one being worked on. Shared store state so viewer callouts can
  // open their section. (Picking a part still never moves the camera.)
  const openStep = useConfigurator((s) => s.openStep)
  const setOpenStep = useConfigurator((s) => s.setOpenStep)

  // Phase 0.14 (Tyler 8/14), generalized in 0.21: a build whose mode does not
  // use a slot GRAYS THAT SECTION OUT rather than vanishing it, so the customer
  // sees it is deliberately not applicable. A ground-mounted fixture (RXB/SXB
  // bollard) is a complete product; a wall bracket (WM1/WM2) needs no pole or
  // base cover but keeps its own Bracket step live.
  const mode = assemblyModeFor(catalog, config)

  // Hide steps the brand has no parts for (e.g. NAFCO has no base covers) —
  // but keep a section the MODE emptied visible in its grayed state.
  const steps = STEPS.filter(
    (step) =>
      compatibleParts(catalog, config, step.key).length > 0 ||
      (!slotAppliesInMode(mode, step.key) &&
        partsForSlot(catalog, step.key, config.brand).length > 0),
  )

  // Phase 0.10.5_TO (Tesla-style): every section always open in one scroll —
  // no accordion, no "Continue" ceremony. The heavy sub-UI self-collapses
  // (spec-option groups default closed), so the rail stays digestible.
  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const part = partById(catalog, config[step.key])
        const finish = catalog.finishes.find((f) => f.id === finishFor(config, step.key))

        // Phase 0.14/0.21: grayed "not applicable" section — the build's
        // assembly mode does not use this slot, so nothing can be picked here.
        const notApplicable =
          !slotAppliesInMode(mode, step.key) &&
          compatibleParts(catalog, config, step.key).length === 0
        if (notApplicable) {
          return (
            <section key={step.key} id={`builder-step-${step.key}`} className="step step-na">
              <div className="step-heading step-na-heading">
                <span className="step-num">{i + 1}</span>
                <span className="step-label">{step.label}</span>
                <span className="step-selected">Not applicable</span>
              </div>
              <p className="step-na-note">{NOT_APPLICABLE_NOTE[mode](step.label.toLowerCase())}</p>
            </section>
          )
        }

        const open = openStep === step.key
        return (
          <section key={step.key} id={`builder-step-${step.key}`} className={`step${open ? ' open' : ''}`}>
            <button
              type="button"
              className="step-heading"
              aria-expanded={open}
              onClick={() => setOpenStep(open ? null : step.key)}
            >
              <span className="step-num">{i + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="step-selected">
                {finish && (
                  <span
                    className="swatch inline"
                    style={{ background: config.finishRal?.[step.key] ?? finish.hex }}
                  />
                )}
                {part ? (part.slot === 'arm' ? displayArmName(part) : displayPartName(part.name)) : '—'}
              </span>
              <span className="step-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
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
              {/* Phase 0.10.5: rotate the arrangement about the pole (0/90/180/270°). */}
              {step.key === 'arm' && <ArmOrientationSelector catalog={catalog} config={config} />}
              <StepFinish catalog={catalog} config={config} slot={step.key} part={part} />
              {part && (
                <StepSpecOptions catalog={catalog} config={config} slot={step.key} part={part} />
              )}
              {/* Phase 0.9 (A2), retired for accessory-driven brands in 0.10.5:
                  the Banner Arm box shows only when the pole's sheet has no
                  banner-kit accessory (BA24/BA30) — those configure banners
                  through Options & accessories placements instead. */}
              {step.key === 'pole' &&
                part &&
                !part.options?.some(
                  (o) =>
                    o.group === 'options-accessories' &&
                    o.values.some((v) => v.label.includes('Banner Arm Kit')),
                ) && <BannerPicker catalog={catalog} config={config} />}
            </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * Phase 0.10.5: this part's own finish. Selecting a swatch overrides the base
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
  // Phase 0.12: parts whose sheet carries a second finish column get a second
  // swatch row. Driven off the part's own options, so a future two-finish sheet
  // needs no code change here.
  const accentColumn = part?.options?.find((o) => o.key === ACCENT_FINISH_KEY)
  // Offer the finishes this part comes in; an empty list means unrestricted.
  // Custom RAL is always offered — it's a match-anything order code.
  const offered =
    part && part.finishes.length > 0
      ? catalog.finishes.filter((f) => f.id === 'custom-ral' || part.finishes.includes(f.id))
      : catalog.finishes
  if (offered.length === 0) return null
  return (
    <div className="step-group">
      <p className="step-group-title">{accentColumn ? 'Housing Finish' : 'Finish'}</p>
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
        <div className="ral-block">
          <label className="ral-picker">
            <input
              type="color"
              value={ralHex ?? '#b0b0b3'}
              onChange={(e) => setFinishRal(slot, e.target.value)}
            />
            <span>Pick your color{ralHex ? ` — ${ralHex.toUpperCase()}` : ''}</span>
          </label>
          {/* Phase 0.17 (Tyler 8/19): live RAL cross-reference — name the
              closest RAL Classic shade as they pick, with a one-click snap so
              the preview shows the shade the paint match will actually chase. */}
          {ralHex && (() => {
            const match = nearestRal(ralHex)
            const exact = ralHex.toUpperCase() === match.hex.toUpperCase()
            return (
              <div className="ral-cross">
                <span className="swatch" style={{ background: match.hex }} />
                <span>
                  {exact ? 'Showing' : 'Closest RAL we finish:'}{' '}
                  <strong>RAL {match.ral} {match.name}</strong>
                </span>
                {!exact && (
                  <button
                    type="button"
                    className="ral-snap"
                    onClick={() => setFinishRal(slot, match.hex.toLowerCase())}
                  >
                    Use RAL {match.ral}
                  </button>
                )}
              </div>
            )
          })()}
        </div>
      )}
      {accentColumn && (
        <StepAccentFinish
          config={config}
          slot={slot}
          offered={offered}
          label={accentColumn.label}
        />
      )}
    </div>
  )
}

/**
 * Phase 0.12: the SECOND finish swatch row, for a part whose sheet carries two
 * finish segments — today TEX's Spider Mount & Accent Line.
 *
 * The sheet requires the accent designation even on side mounts (where the
 * mounting arm matches the housing), so this row is never hidden by the
 * mounting choice. Untouched, the accent follows the housing finish — the same
 * fallback shape as a slot finish following the base finish, so the part number
 * always carries a real colour rather than a `_`.
 *
 * IT DOES NOT REPAINT THE PREVIEW, and the row says so (Tyler, 0.21). The
 * render manifest is keyed (partId, angle, finish) — ONE colour per part — and
 * the ingest converts the six fixture masters with `paintAll`, putting every
 * solid into the single paintable `will-body` material. So there is no second
 * paintable region for an accent colour to land on, and a swatch row that looks
 * exactly like the housing row was read (correctly) as broken. What it really
 * does is change the ORDERING SEGMENT: `WD-TEX-…-BK-WH` instead of `…-BK-BK`,
 * and the quote's "Spider Mount & Accent Line" line. Making the preview honour
 * it needs a second paintable material through ingest + rig + a per-region
 * tint, which is gated on agreeing the paintable-surface convention with Cole
 * (the "authored-colour convention" open decision).
 */
function StepAccentFinish({
  config,
  slot,
  offered,
  label,
}: {
  config: PoleConfig
  slot: Slot
  offered: Catalog['finishes']
  label: string
}) {
  const setAccentFinish = useConfigurator((s) => s.setAccentFinish)
  const current = accentFinishFor(config, slot)
  const explicit = config.accentFinishes?.[slot] !== undefined
  return (
    <div className="accent-finish">
      <p className="step-group-title">{label.replace(/^Finish Color\s*/, '')}</p>
      {/* Say what this control does and does not do. It changes the part
          number and the quote; it cannot change the preview until the accent
          has a paintable region of its own. Without this the row is
          indistinguishable from the housing swatches and reads as broken. */}
      <p className="step-note">
        {explicit
          ? 'Ordering colour for this segment — it changes the part number, not the preview.'
          : 'Matching the housing finish. Picking a different colour changes the part number, not the preview.'}
      </p>
      <div className="options finishes">
        {offered.map((f) => (
          <button
            key={f.id}
            className={`finish-chip ${current === f.id ? 'selected' : ''}`}
            onClick={() => setAccentFinish(slot, f.id)}
            title={f.name}
          >
            {f.id === 'custom-ral' ? (
              <span className="swatch ral-rainbow" />
            ) : (
              <span className="swatch" style={{ background: f.hex }} />
            )}
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      <p className="step-note">
        Ordered as its own finish code — required even when it matches the housing.
      </p>
    </div>
  )
}

/**
 * Phase 0.8 (Workstream D), moved into the step in 0.10.5: the part's spec-sheet
 * ordering table, split the way the sheet is — base configuration (ordering
 * columns) and options & accessories. Values not confirmed buildable online
 * are flagged "quote". Parts without a parsed sheet render nothing.
 */
function StepSpecOptions({
  catalog,
  config,
  slot,
  part,
}: {
  catalog: Catalog
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

  // Phase 0.11 (B3): Options and Accessories are different things — an Option
  // is a configuration choice that bears a part-number code, an Accessory is a
  // separate add-on product ("adder", the pole sheet's own word). They were
  // rendered as one flat, undifferentiated checkbox list under a single
  // hardcoded heading; each column now carries the sheet's own name. Repeated
  // names (the MVX sheet's parser-split "Options" / "options-2") print once.
  const voltage = specCodes(chosen['voltage'])[0]
  let lastLabel = ''
  const extraGroups = extraOpts
    .map((opt) => {
      const values = opt.values.filter(
        // Phase 0.11 (C3): never offer a code this product may not carry
        // (CF1/CF2/CF3 outside SH1) — mirrors repairConfig's own guard.
        (v) => voltageCompatible(voltage, v.label) && codeAllowedOnPart(part, v.code),
      )
      return { opt, values, label: optionLabel(opt) }
    })
    .filter((g) => g.values.length > 0)
    .map((g) => {
      const showLabel = g.label !== lastLabel
      lastLabel = g.label
      return { ...g, showLabel }
    })

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
            <span className="step-group-title">Configure Product Spec (Optional)</span>
            <span className="extras-meta">
              {baseCount > 0 && <span className="extras-count">{baseCount} set</span>}
              <span className="extras-arrow">{showBase ? '▾' : '▸'}</span>
            </span>
          </button>
          {showBase &&
            baseOpts.map((opt) => {
              // Phase 0.10.5_TO: single-select boxes instead of dropdowns —
              // every value visible, one tap to pick. Nothing is selected by
              // default (the whole spec is optional; picking values just
              // derives more of the part number); tapping the selected value
              // again clears it back to unspecified.
              const current = specCodes(chosen[opt.key])[0] ?? ''
              return (
                <div className="spec-option" key={opt.key}>
                  <span className="spec-option-label">{optionLabel(opt)}</span>
                  <div className="spec-choices" role="radiogroup" aria-label={optionLabel(opt)}>
                    {opt.values.map((v) => {
                      // CR-OPT-14: grey out values incompatible with other
                      // chosen columns (PF flush fit → walls C is out).
                      // CR-OPT-15: the bracket-derived mounting counts as
                      // chosen (SH1 → PF greys the C wall).
                      const derivedMounting =
                        slot === 'pole' ? poleMountingCodeFor(catalog, config) : undefined
                      const effective = derivedMounting
                        ? { ...chosen, 'fixture-mounting': derivedMounting }
                        : chosen
                      const compatible = valueCompatibleWithChosen(part, effective, opt.key, v)
                      return (
                        <button
                          key={v.code}
                          type="button"
                          role="radio"
                          aria-checked={current === v.code}
                          className={`spec-choice${current === v.code ? ' selected' : ''}${compatible ? '' : ' incompatible'}`}
                          disabled={!compatible}
                          onClick={() =>
                            setSpecOption(slot, opt.key, current === v.code ? '' : v.code)
                          }
                          title={
                            compatible
                              ? `${v.code} — ${v.label}`
                              : `Not available with the current selections${v.note ? ` — ${v.note}` : ''}`
                          }
                        >
                          {v.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>
      )}
      {/* Gate on the groups that actually have something to show: a column
          whose every value is filtered out (wrong voltage, or a code this part
          may not carry) must not leave an empty disclosure behind. */}
      {extraGroups.length > 0 && (
        <div className="step-group">
          <button
            type="button"
            className="extras-toggle"
            onClick={() => setShowExtras((v) => !v)}
            aria-expanded={showExtras}
          >
            <span className="step-group-title">Add Options &amp; Accessories</span>
            <span className="extras-meta">
              {extrasCount > 0 && <span className="extras-count">{extrasCount} selected</span>}
              <span className="extras-arrow">{showExtras ? '▾' : '▸'}</span>
            </span>
          </button>
          {showExtras &&
            extraGroups.map(({ opt, values, label, showLabel }) => (
              // Multi-select: check any combination. Values in an exclusive
              // family (cord / surge / photocontrol / shepherds-hook centre
              // feature) render single-select instead — the store swaps them,
              // so a checkbox would misrepresent the model.
              <div className="spec-option spec-option-group" key={opt.key}>
                {showLabel && <p className="spec-option-group-label">{label}</p>}
                {values.map((v) => {
                  // CR-OPT-06: a derived row (the bracket cord) isn't a
                  // choice — it renders as a locked "included" box once the
                  // pairing that derives it exists, and hides until then.
                  if (v.derived) {
                    if (!cordCodeFor(catalog, config)) return null
                    return (
                      <div key={v.code} className="spec-check checked derived">
                        <span className="spec-check-text">
                          <span className="spec-check-name">{v.label}</span>
                          {v.note && <span className="spec-check-note">{v.note}</span>}
                        </span>
                        <span className="spec-check-included">Included</span>
                      </div>
                    )
                  }
                  const checked = specCodes(chosen[opt.key]).includes(v.code)
                  // CR-OPT-13 (UI): the shaft-access group caps at 2 TOTAL.
                  // A checked accessory with no committed placement still
                  // occupies a slot, so it counts as 1. When full, unchecked
                  // group members lock and say why.
                  const vGroup = v.placement?.spacingGroup
                  const vGroupCap = v.placement?.groupMaxInstances
                  const groupFull =
                    !checked &&
                    vGroup !== undefined &&
                    vGroupCap !== undefined &&
                    (part.options ?? [])
                      .filter((o2) => o2.group === 'options-accessories')
                      .flatMap((o2) => o2.values)
                      .filter((v2) => v2.placement?.spacingGroup === vGroup)
                      .reduce((n, v2) => {
                        const inst = placementInstances(config, v2.code).length
                        const isChecked = (part.options ?? []).some((o2) =>
                          specCodes(chosen[o2.key]).includes(v2.code),
                        )
                        return n + (isChecked ? Math.max(1, inst) : inst)
                      }, 0) >= vGroupCap
                  const placeable = slot === 'pole' && isPlaceable(v)
                  const family = exclusiveFamily(v.code)
                  return (
                    <div key={v.code}>
                      <label
                        className={`spec-check ${checked ? 'checked' : ''}${groupFull ? ' incompatible' : ''}`}
                        title={
                          family && checked ? 'Click again to clear this choice' : undefined
                        }
                      >
                        {family ? (
                          // Radio semantics, but de-selectable: none of these
                          // families is mandatory, and a radio group with no
                          // "None" row would otherwise be a one-way door.
                          // Clicking the checked radio fires no change event,
                          // so the toggle hangs off onClick.
                          <input
                            type="radio"
                            name={`${slot}-${family}`}
                            checked={checked}
                            readOnly
                            onClick={() => !groupFull && toggleSpecOption(slot, opt.key, v.code)}
                            disabled={groupFull}
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => !groupFull && toggleSpecOption(slot, opt.key, v.code)}
                            disabled={groupFull}
                          />
                        )}
                        {/* Phase 0.12_TO (Tyler): plain English only — the
                            order code drives the part number but is not shown
                            on the row. The sheet note becomes the caption. */}
                        <span className="spec-check-text">
                          <span className="spec-check-name">{v.label}</span>
                          {v.note && <span className="spec-check-note">{v.note}</span>}
                        </span>
                      </label>
                      {groupFull && (
                        <p className="spec-options-note placement-blocked">
                          Maximum of {vGroupCap} total hand holes + festoons per pole — reach
                          out to engineering if you need more.
                        </p>
                      )}
                      {checked && placeable && (
                        <AccessoryPlacementBox
                          catalog={catalog}
                          code={v.code}
                          config={config}
                          poleFt={part.heightFt ?? 20}
                          label={valueText(v)}
                        />
                      )}
                    </div>
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
 * The part number / design code shown as a card's subtitle: an arm's base
 * model code (SH1, AR1…), else the part's single-value Design column code
 * (CL1…SC2 base covers), else its family (DRX/GVX fixtures — already codes).
 */
function partDesignCode(part: CatalogPart): string {
  if (part.modelCodes?.[1]) return part.modelCodes[1]
  const design = part.options?.find((o) => o.key === 'design')
  if (design && design.values.length === 1) return design.values[0].code
  return part.family
}

/**
 * Phase 0.10.5: the step's part choices. Normally a card grid; when every choice
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
          {byHeight.map((p) => {
            const soon = isComingSoon(p)
            return (
              <button
                key={p.id}
                className={`arm-count-chip ${selectedId === p.id ? 'selected' : ''} ${
                  soon ? 'coming-soon' : ''
                }`}
                onClick={() => onSelect(p.id)}
                disabled={soon}
                aria-disabled={soon}
                title={soon ? COMING_SOON_HINT : p.name}
              >
                <span className="arm-count-name">{p.heightFt} ft</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="options">
      {parts.map((p) => {
        // Phase 0.12 (D): still on placeholder geometry — shown, but inert.
        const soon = isComingSoon(p)
        return (
          <button
            key={p.id}
            className={`option-card ${selectedId === p.id ? 'selected' : ''} ${
              soon ? 'coming-soon' : ''
            }`}
            onClick={() => onSelect(p.id)}
            disabled={soon}
            aria-disabled={soon}
            title={soon ? COMING_SOON_HINT : p.name}
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
            <span className="option-name">{p.slot === 'arm' ? displayArmName(p) : displayPartName(p.name)}</span>
            <span className="option-family">{partDesignCode(p)}</span>
            {soon && <span className="coming-soon-badge">{COMING_SOON_LABEL}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Phase 0.10.5: shaft placement for a checked pole accessory that specifies
 * height & orientation (festoon, couplings, extra hand holes, flag/plant
 * holders) — the banner arm's pattern, generalized. Orientation is relative
 * to the 0° hand-hole reference. Product renders will later drive a viewer
 * layer from this same data.
 */
function AccessoryPlacementBox({
  catalog,
  code,
  config,
  poleFt,
  label,
}: {
  catalog: Catalog
  code: string
  config: PoleConfig
  poleFt: number
  label: string
}) {
  const setAccessoryPlacement = useConfigurator((s) => s.setAccessoryPlacement)
  // CR-OPT-11: placements are instanced; multi accessories (couplings, hand
  // holes) render one box per instance plus an "Add another" affordance.
  const instances = placementInstances(config, code)
  const accessoryValueOuter = poleAccessoryValue(catalog, config, code)
  const isMulti = accessoryValueOuter?.placement?.multi === true
  // CR-OPT-13: a spacing group's combined cap (hand holes + festoons: 2,
  // mix and match) counts every group member's instances.
  const groupName = accessoryValueOuter?.placement?.spacingGroup
  const groupCap = accessoryValueOuter?.placement?.groupMaxInstances
  const groupCount = groupName
    ? (partById(catalog, config.pole)?.options ?? [])
        .filter((o) => o.group === 'options-accessories')
        .flatMap((o) => o.values)
        .filter((v) => v.placement?.spacingGroup === groupName)
        .reduce((n, v) => n + placementInstances(config, v.code).length, 0)
    : instances.length
  const effectiveCap = Math.min(
    accessoryValueOuter?.placement?.maxInstances ?? Infinity,
    groupCap ?? Infinity,
  )
  const capCount = groupCap !== undefined ? groupCount : instances.length
  const shown = instances.length > 0 ? instances : [undefined]
  const commit = (idx: number, p: import('../types').AccessoryPlacement) => {
    const next = [...(instances.length > 0 ? instances : [])]
    next[idx] = p
    setAccessoryPlacement(code, next)
  }
  const noun = accessoryNoun(label)
  // Phase 0.17 (Tyler 8/19): state the limits ONCE, up front, generated from
  // the same placement data repair enforces — never hand-written per value,
  // so copy and behavior cannot disagree.
  const rules: string[] = []
  const pl = accessoryValueOuter?.placement
  if (pl) {
    if (groupCap !== undefined && groupName) {
      const nouns = (partById(catalog, config.pole)?.options ?? [])
        .filter((o) => o.group === 'options-accessories')
        .flatMap((o) => o.values)
        .filter((v) => v.placement?.spacingGroup === groupName)
        .map((v) => `${accessoryNoun(v.label)}s`)
      rules.push(`Up to ${groupCap} ${nouns.join(' + ')} combined`)
    } else if (pl.maxInstances) {
      rules.push(`Up to ${pl.maxInstances} per pole`)
    }
    if (pl.minFt !== undefined && pl.maxFt !== undefined) {
      rules.push(`${heightLabel(pl.minFt)}–${heightLabel(pl.maxFt)} above grade`)
    } else if (pl.minFt !== undefined) {
      rules.push(`at least ${heightLabel(pl.minFt)} above grade`)
    }
    if (pl.minGapFt) {
      rules.push(
        groupName
          ? `${heightLabel(pl.minGapFt)} apart`
          : `${heightLabel(pl.minGapFt)} apart on the same side`,
      )
    }
  }
  return (
    <>
      {rules.length > 0 && <p className="placement-rules">{rules.join(' · ')}</p>}
      {shown.map((existingInstance, idx) => (
        <PlacementInstance
          key={idx}
          catalog={catalog}
          code={code}
          config={config}
          poleFt={poleFt}
          label={label}
          existing={existingInstance}
          onChange={(p) => commit(idx, p)}
          onRemove={
            isMulti && idx > 0
              ? () => setAccessoryPlacement(code, instances.filter((_, i) => i !== idx))
              : undefined
          }
          ordinal={isMulti && shown.length > 1 ? idx + 1 : undefined}
          noun={noun}
        />
      ))}
      {isMulti && capCount >= effectiveCap && (
        <p className="spec-options-note">
          Need more than {effectiveCap}? Reach out to engineering — we’ll spec it with you.
        </p>
      )}
      {isMulti && capCount < effectiveCap && (
        <button
          type="button"
          className="placement-add"
          onClick={() => {
            const base = shown[shown.length - 1]
            const template = base ?? { heightFt: 4, orientation: 0 }
            setAccessoryPlacement(code, [
              ...(instances.length > 0 ? instances : [template]),
              { ...template },
            ])
          }}
        >
          + Add another {noun}
        </button>
      )}
    </>
  )
}

function PlacementInstance({
  catalog,
  code,
  config,
  poleFt,
  label,
  existing,
  onChange,
  onRemove,
  ordinal,
  noun,
}: {
  catalog: Catalog
  code: string
  config: PoleConfig
  poleFt: number
  label: string
  existing: import('../types').AccessoryPlacement | undefined
  onChange: (p: import('../types').AccessoryPlacement) => void
  onRemove?: () => void
  ordinal?: number
  noun?: string
}) {
  const sideOptions = accessorySideOptions(label)
  const bannerKit = isBannerKitLabel(label)
  // Phase 0.11 (D3): the height window comes from the same function
  // repairConfig clamps with. Before 0.11 this box floored banner kits at 2 ft
  // while repairConfig floored them at 8 ft, so the slider offered heights the
  // store immediately overrode.
  const accessoryValue = poleAccessoryValue(catalog, config, code)
  const { minFt, maxFt, fits } = accessoryHeightRange(
    catalog,
    poleFt,
    label,
    existing?.size,
    // CR-PLC-05: banner top ≥ 1 ft below the fixture bottom (pendants).
    fixtureBottomFt(catalog, config),
    // CR-PLC-07: the accessory's own window (FH/PH: 8–12 ft).
    accessoryValue?.placement,
  )
  const stepFt = (accessoryValue?.placement?.stepIn ?? 1) / 12
  const ruleDefaultFt = accessoryValue?.placement?.defaultFt
  // A label-declared minimum (FSTR's 37", a banner kit's 8 ft floor) is also
  // the default placement.
  // CR-PLC-07: the accessory's own default (FH 10 ft / PH 9 ft) beats the
  // generic floor-or-4ft heuristic; always clamped to the live window.
  const defaultFt = Math.min(
    maxFt,
    Math.max(minFt, ruleDefaultFt ?? (minFt > 2 ? minFt : Math.min(4, maxFt))),
  )
  const placement = existing ?? {
    heightFt: defaultFt,
    orientation: 0,
    ...(sideOptions ? { sides: 1 } : {}),
  }
  return (
    <div className="placement-box">
      {(ordinal !== undefined || onRemove) && (
        <div className="placement-instance-head">
          {ordinal !== undefined && (
            <span className="placement-ordinal">
              {(noun ?? 'placement').replace(/^./, (c) => c.toUpperCase())} {ordinal}
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              className="placement-remove"
              onClick={onRemove}
              aria-label={`Remove ${noun ?? 'placement'} ${ordinal ?? ''}`.trim()}
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      )}
      {/* Phase 0.11 (D2): panel size on a banner kit — only the sizes this
          kit's arms can carry (BA24's 24" arms can't fly a 30" banner). */}
      {bannerKit && (
        <>
          <p className="arm-count-label">Banner size (W × H)</p>
          <div className="arm-count-options">
            {bannerSizesForLabel(catalog, label).map((s) => (
              <button
                key={s.id}
                className={`arm-count-chip ${
                  bannerPanelSize(catalog, placement.size).id === s.id ? 'selected' : ''
                }`}
                onClick={() => onChange({ ...placement, size: s.id })}
              >
                <span className="arm-count-name">{formatPanelSize(s)}</span>
                {s.default && <span className="arm-count-sub">Most common</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="banner-height">
        {/* Phase 0.11 (D1): name the reference point. "Height up shaft"
            disclosed nothing; a banner's height is measured to its bottom. */}
        <span className="placement-height-row">
          <span>{bannerKit ? 'Height to bottom of banner' : 'Height above grade'}</span>
          <strong>{ftLabel(placement.heightFt)}</strong>
        </span>
        <input
          type="range"
          min={minFt}
          max={maxFt}
          // "any" + snap-on-change: the 37" floor sits OFF the 6" grid (first
          // step is 5", to 42"), which a native stepped range can't express.
          step="any"
          value={Math.min(Math.max(placement.heightFt, minFt), maxFt)}
          onChange={(e) =>
            onChange({
              ...placement,
              heightFt: Math.min(
                maxFt,
                snapPlacementHeightFt(Number(e.target.value), minFt, stepFt),
              ),
            })
          }
        />
      </label>
      {!fits &&
        (bannerKit ? (
          <p className="spec-options-note">
            A {formatPanelSize(bannerPanelSize(catalog, placement.size))} banner does not clear a{' '}
            {poleFt} ft pole above the {minFt} ft minimum — choose a smaller panel or a taller pole.
          </p>
        ) : (
          <p className="spec-options-note">
            This accessory’s {ftLabel(minFt)} minimum leaves no room on a {poleFt} ft pole — we’ll
            confirm the placement with your quote.
          </p>
        ))}
      {sideOptions && (
        <>
          <p className="arm-count-label">Sides</p>
          <div className="arm-count-options">
            {sideOptions.map((n) => (
              <button
                key={n}
                className={`arm-count-chip ${(placement.sides ?? 1) === n ? 'selected' : ''}`}
                onClick={() => onChange({ ...placement, sides: n })}
                title={SIDE_LABELS[n] ?? `${n} sides`}
              >
                <span className="arm-count-name">{SIDE_LABELS[n] ?? `${n} sides`}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {/* Tyler 8/12: only orientations that produce distinct layouts for the
          chosen sides — an opposite pair offers 0/90; four sides need no
          orientation at all (every 90° rotation is the same picture). */}
      {armOrientationOptions(placement.sides ?? 1).length > 1 && (
        <>
          <p className="arm-count-label">Orientation</p>
          <div className="arm-count-options orientation-options">
            {armOrientationOptions(placement.sides ?? 1).map((deg) => (
              <button
                key={deg}
                className={`arm-count-chip ${placement.orientation === deg ? 'selected' : ''}`}
                onClick={() => onChange({ ...placement, orientation: deg })}
                title={`${deg}° from the hand-hole reference`}
              >
                <span className="arm-count-name">{deg}°</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Phase 0.10.5: rotate the whole arm arrangement about the pole — 0/90/180/270°.
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
  // Only orientations that produce distinct layouts for this arrangement
  // (Tyler 8/12: a twin offers 0/90 — 180/270 are the same picture).
  const offered = armOrientationOptions(config.armCount ?? 1)
  if (offered.length <= 1) return null
  return (
    <div className="arm-count arm-orientation">
      <p className="arm-count-label">Orientation</p>
      <div className="arm-count-options">
        {offered.map((deg) => (
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
