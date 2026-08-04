import type { Catalog, PoleConfig, Slot } from '../types'
import { configStatus, finishFor, optionLabel, partById, specCodes } from './compat'
import { shareUrl } from './url'

/**
 * Phase 1.0: the part's full ordering part number, assembled the way the spec
 * sheet's ordering example does (e.g. WD-DRX-80-30-MV-3M-3T-BK): every base
 * configuration column in sheet order joined with `-`, then each selected
 * option/accessory code appended with `-`. Columns the customer hasn't chosen
 * yet show `_`; columns the UI answers elsewhere fill themselves in — the
 * product family/design from the part card, the finish color from the step's
 * finish (via SpecOptionValue.mapsTo). Returns undefined for parts without a
 * parsed ordering table (no sheet, no part number).
 */
export function buildPartNumber(
  catalog: Catalog,
  config: PoleConfig,
  slot: Slot,
): string | undefined {
  const part = partById(catalog, config[slot])
  if (!part) return undefined
  // Arms carry official per-configuration model codes (SH1, SS3, AR2, …) —
  // that code IS the arm's ordering part number for the chosen count.
  if (slot === 'arm' && part.modelCodes) {
    return part.modelCodes[config.armCount ?? 1]
  }
  const options = part.options
  if (!options || options.length === 0) return undefined
  const chosen = config.specOptions?.[slot] ?? {}
  const finishId = finishFor(config, slot)
  const byPosition = (a: { orderPosition: number }, b: { orderPosition: number }) =>
    a.orderPosition - b.orderPosition

  const segments: string[] = []
  for (const opt of options.filter((o) => o.group === 'ordering').sort(byPosition)) {
    const selected = specCodes(chosen[opt.key])[0]
    if (selected) {
      segments.push(selected)
    } else if (opt.key.startsWith('finish-color')) {
      // The sheet's own code when it lists this finish, else the palette code
      // (covers sheets whose finish column predates a newly added color).
      segments.push(
        opt.values.find((v) => v.mapsTo === finishId)?.code ??
          catalog.finishes.find((f) => f.id === finishId)?.code ??
          '_',
      )
    } else if (opt.key === 'finish-type') {
      // Finish type is a function of the picked color: FP painted / AN anodized.
      segments.push(catalog.finishes.find((f) => f.id === finishId)?.typeCode ?? opt.values[0].code)
    } else if (opt.values.length === 1) {
      segments.push(opt.values[0].code)
    } else if (opt.values.some((v) => v.code === part.family)) {
      // The part card IS this choice (e.g. the DRX design column).
      segments.push(part.family)
    } else {
      segments.push('_')
    }
  }
  for (const opt of options.filter((o) => o.group === 'options-accessories').sort(byPosition)) {
    segments.push(...specCodes(chosen[opt.key]))
  }
  return segments.join('-')
}

export const SUMMARY_ROWS: { label: string; key: 'fixture' | 'arm' | 'pole' | 'baseCover' }[] = [
  { label: 'Fixture', key: 'fixture' },
  { label: 'Arm', key: 'arm' },
  { label: 'Pole', key: 'pole' },
  { label: 'Base Cover', key: 'baseCover' },
]

/** Phase 0.8: human label for a radial arm count. */
export function armArrangementLabel(count: number): string {
  return { 1: 'Single', 2: 'Twin (180°)', 3: 'Triple (120°)', 4: 'Quad (90°)' }[count] ?? `${count} arms`
}

/**
 * Human-readable config block — attached to quote requests and copyable from
 * the output tray. Phase 1.0: each part carries its own finish and its own
 * spec-sheet choices (indented under the part), with a quote flag on anything
 * not confirmed buildable online.
 */
export function buildSummaryText(catalog: Catalog, config: PoleConfig): string {
  const armCount = config.armCount ?? 1
  const banner = config.banner
  const bannerPart = banner ? partById(catalog, banner.armId) : undefined

  const partLines: string[] = []
  for (const r of SUMMARY_ROWS) {
    const part = partById(catalog, config[r.key])
    const finish = catalog.finishes.find((f) => f.id === finishFor(config, r.key))
    // Custom RAL carries the picked color so the quote knows what to match.
    const ralHex = finish?.id === 'custom-ral' ? config.finishRal?.[r.key] : undefined
    const finishName = finish ? `${finish.name}${ralHex ? ` (${ralHex.toUpperCase()})` : ''}` : ''
    partLines.push(`${r.label}: ${part ? `${part.name}${finishName ? ` — ${finishName}` : ''}` : '—'}`)
    const partNumber = buildPartNumber(catalog, config, r.key)
    if (partNumber) partLines.push(`  Part No: ${partNumber}`)
    const chosen = config.specOptions?.[r.key]
    if (part?.options && chosen) {
      for (const opt of part.options) {
        // Multi-select columns list one line per selected code.
        for (const code of specCodes(chosen[opt.key])) {
          const value = opt.values.find((v) => v.code === code)
          const quote = value && value.buildable !== true ? ' (quote only)' : ''
          // Placed accessories carry their shaft position for the quote.
          const placement = config.accessoryPlacements?.[code]
          const sides = placement?.sides && placement.sides > 1 ? `, ${placement.sides} sides` : ''
          const placed = placement
            ? ` — placed ${placement.heightFt} ft @ ${placement.orientation}°${sides}`
            : ''
          partLines.push(`  ${optionLabel(opt)}: ${code}${value ? ` — ${value.label}` : ''}${quote}${placed}`)
        }
      }
    }
  }

  return [
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...partLines,
    ...(armCount > 1 ? [`Arm arrangement: ${armArrangementLabel(armCount)}`] : []),
    ...(config.armOrientation ? [`Arm orientation: ${config.armOrientation}°`] : []),
    ...(banner
      ? [`Banner arm: ${bannerPart?.name ?? banner.armId} — ${banner.count}-side @ ${banner.heightFt} ft`]
      : []),
    `Link: ${shareUrl(config)}`,
  ].join('\n')
}
