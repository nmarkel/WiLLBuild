import type { PoleConfig } from '../types'

const PART_KEYS = ['pole', 'baseCover', 'arm', 'fixture', 'finish'] as const

/** Serialize the selection into query params so any config is shareable as a URL. */
export function configToParams(config: PoleConfig): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of PART_KEYS) {
    if (config[key]) params.set(key, config[key])
  }
  return params
}

/**
 * Read a partial config from query params. Returns null if no config keys are
 * present. IDs are not validated here — callers repair against the catalog.
 */
export function paramsToPartialConfig(params: URLSearchParams): Partial<PoleConfig> | null {
  const partial: Partial<PoleConfig> = {}
  let found = false
  for (const key of PART_KEYS) {
    const value = params.get(key)
    if (value) {
      partial[key] = value
      found = true
    }
  }
  return found ? partial : null
}

export function shareUrl(config: PoleConfig): string {
  const url = new URL(window.location.href)
  url.search = configToParams(config).toString()
  return url.toString()
}
