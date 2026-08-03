import type { Catalog, PoleConfig } from '../types'
import { configStatus, partById } from './compat'
import { shareUrl } from './url'

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

/** Human-readable config block — attached to quote requests and copyable from the output tray. */
export function buildSummaryText(catalog: Catalog, config: PoleConfig): string {
  const finish = catalog.finishes.find((f) => f.id === config.finish)
  const armCount = config.armCount ?? 1
  const banner = config.banner
  const bannerPart = banner ? partById(catalog, banner.armId) : undefined
  // Phase 0.8 (D): selected spec-sheet options for the active fixture, with a
  // quote flag on anything not confirmed buildable online.
  const fixture = partById(catalog, config.fixture)
  const specLines: string[] = []
  if (fixture?.options && config.specOptions) {
    for (const opt of fixture.options) {
      const code = config.specOptions[opt.key]
      if (!code) continue
      const value = opt.values.find((v) => v.code === code)
      const quote = value && value.buildable !== true ? ' (quote only)' : ''
      specLines.push(`${opt.label}: ${code}${value ? ` — ${value.label}` : ''}${quote}`)
    }
  }
  return [
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...SUMMARY_ROWS.map((r) => `${r.label}: ${partById(catalog, config[r.key])?.name ?? '—'}`),
    ...(armCount > 1 ? [`Arm arrangement: ${armArrangementLabel(armCount)}`] : []),
    ...(banner
      ? [`Banner arm: ${bannerPart?.name ?? banner.armId} — ${banner.count}-side @ ${banner.heightFt} ft`]
      : []),
    `Finish: ${finish?.name ?? '—'}`,
    ...(specLines.length ? ['Product options:', ...specLines.map((l) => `  ${l}`)] : []),
    `Link: ${shareUrl(config)}`,
  ].join('\n')
}
