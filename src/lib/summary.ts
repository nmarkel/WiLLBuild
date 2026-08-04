import type { Catalog, PoleConfig } from '../types'
import { bannerSummaryLine } from './banner'
import { configStatus, partById } from './compat'
import { partNumbersText, resolveAssemblyPartNumbers } from './partNumber'
import { shareUrl } from './url'

export const SUMMARY_ROWS: { label: string; key: 'fixture' | 'arm' | 'pole' | 'baseCover' }[] = [
  { label: 'Fixture', key: 'fixture' },
  { label: 'Arm', key: 'arm' },
  { label: 'Pole', key: 'pole' },
  { label: 'Base Cover', key: 'baseCover' },
]

/**
 * Phase 0.8 / 0.10: human label for a radial arm count. Arms sit on a 90°
 * drilled tenon, so a triple is 3@90 with one leg empty — not 3@120.
 */
export function armArrangementLabel(count: number): string {
  return (
    { 1: 'Single', 2: 'Twin (2 @ 180°)', 3: 'Triple (3 @ 90°)', 4: 'Quad (4 @ 90°)' }[count] ??
    `${count} arms`
  )
}

/** Human-readable config block — attached to quote requests and copyable from the output tray. */
export function buildSummaryText(catalog: Catalog, config: PoleConfig): string {
  const finish = catalog.finishes.find((f) => f.id === config.finish)
  const armCount = config.armCount ?? 1
  const banner = config.banner
  const bannerPart = banner ? partById(catalog, banner.armId) : undefined
  // Phase 0.10 (Workstream 0): the part numbers lead — they are what a designer
  // drops into the project spec.
  const numbers = resolveAssemblyPartNumbers(catalog, config)
  // Phase 0.8 (D) / 0.10 (B): the customer's ordering-matrix selections, per part.
  const optionLines: string[] = []
  for (const number of numbers) {
    const part = partById(catalog, number.partId)
    if (!part) continue
    const selections = config.partOptions?.[part.id]
    if (!selections) continue
    const chosen: string[] = []
    for (const [key, code] of Object.entries(selections.codes ?? {})) {
      const column = part.options?.find((o) => o.key === key)
      const value = column?.values.find((v) => v.code === code)
      const design = part.ordering?.designs.find((d) => d.code === code)
      const label = column?.label ?? (key === 'design' ? 'Design' : key)
      chosen.push(`${label}: ${code}${value ? ` — ${value.label}` : design ? ` — ${design.label}` : ''}`)
    }
    for (const code of selections.addOns ?? []) {
      const matrixOption = part.ordering?.options?.find((o) => o.code === code)
      const value = part.options?.flatMap((o) => o.values).find((v) => v.code === code)
      chosen.push(`Options: ${code}${matrixOption ? ` — ${matrixOption.label}` : value ? ` — ${value.label}` : ''}`)
    }
    if (chosen.length > 0) {
      optionLines.push(`  ${part.name}:`, ...chosen.map((c) => `    ${c}`))
    }
  }
  return [
    'Part numbers:',
    ...partNumbersText(numbers).map((l) => `  ${l}`),
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...SUMMARY_ROWS.map((r) => `${r.label}: ${partById(catalog, config[r.key])?.name ?? '—'}`),
    ...(armCount > 1 ? [`Arm arrangement: ${armArrangementLabel(armCount)}`] : []),
    ...(banner && bannerPart
      ? [`Banner arm: ${bannerSummaryLine(bannerPart, banner.count, banner.heightFt)}`]
      : banner
        ? [`Banner arm: ${banner.armId} — ${banner.count}-side @ ${banner.heightFt} ft`]
        : []),
    `Finish: ${finish?.name ?? '—'}${finish?.code ? ` (${finish.code})` : ''}`,
    ...(optionLines.length ? ['Product options:', ...optionLines] : []),
    `Link: ${shareUrl(config)}`,
  ].join('\n')
}
