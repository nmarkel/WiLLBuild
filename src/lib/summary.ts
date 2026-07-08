import type { Catalog, PoleConfig } from '../types'
import { configStatus, partById } from './compat'
import { shareUrl } from './url'

export const SUMMARY_ROWS: { label: string; key: 'fixture' | 'arm' | 'pole' | 'baseCover' }[] = [
  { label: 'Fixture', key: 'fixture' },
  { label: 'Arm', key: 'arm' },
  { label: 'Pole', key: 'pole' },
  { label: 'Base Cover', key: 'baseCover' },
]

/** Human-readable config block — attached to quote requests and copyable from the output tray. */
export function buildSummaryText(catalog: Catalog, config: PoleConfig): string {
  const finish = catalog.finishes.find((f) => f.id === config.finish)
  return [
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...SUMMARY_ROWS.map((r) => `${r.label}: ${partById(catalog, config[r.key])?.name ?? '—'}`),
    `Finish: ${finish?.name ?? '—'}`,
    `Link: ${shareUrl(config)}`,
  ].join('\n')
}
