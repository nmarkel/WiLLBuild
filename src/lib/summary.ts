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
  const options = part?.options
  if (!part || !options || options.length === 0) return undefined
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
      segments.push(opt.values.find((v) => v.mapsTo === finishId)?.code ?? '_')
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
    partLines.push(`${r.label}: ${part ? `${part.name}${finish ? ` — ${finish.name}` : ''}` : '—'}`)
    const partNumber = buildPartNumber(catalog, config, r.key)
    if (partNumber) partLines.push(`  Part No: ${partNumber}`)
    const chosen = config.specOptions?.[r.key]
    if (part?.options && chosen) {
      for (const opt of part.options) {
        // Multi-select columns list one line per selected code.
        for (const code of specCodes(chosen[opt.key])) {
          const value = opt.values.find((v) => v.code === code)
          const quote = value && value.buildable !== true ? ' (quote only)' : ''
          partLines.push(`  ${optionLabel(opt)}: ${code}${value ? ` — ${value.label}` : ''}${quote}`)
        }
      }
    }
  }

  return [
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...partLines,
    ...(armCount > 1 ? [`Arm arrangement: ${armArrangementLabel(armCount)}`] : []),
    ...(banner
      ? [`Banner arm: ${bannerPart?.name ?? banner.armId} — ${banner.count}-side @ ${banner.heightFt} ft`]
      : []),
    `Link: ${shareUrl(config)}`,
  ].join('\n')
}
