import type { PoleConfig, ProductLine } from '../types'
import type { ViewMode } from '../store'

const PART_KEYS = ['pole', 'baseCover', 'arm', 'fixture', 'finish'] as const

const DEFAULT_BRAND: ProductLine = 'WiLLstudio'

/** Serialize the selection into query params so any config is shareable as a URL. */
export function configToParams(config: PoleConfig): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of PART_KEYS) {
    if (config[key]) params.set(key, config[key])
  }
  // Only serialize brand when it differs from the default — keeps share URLs clean.
  if (config.brand && config.brand !== DEFAULT_BRAND) {
    params.set('brand', config.brand)
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
  const brandValue = params.get('brand')
  if (brandValue) {
    partial.brand = brandValue as ProductLine
    found = true
  }
  return found ? partial : null
}

/** Serialize a product view into query params. */
export function productToParams(productId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('product', productId)
  return params
}

/**
 * Determine the current view mode from query params.
 * Product param wins if both product and config params are present.
 */
export function paramsToViewMode(params: URLSearchParams): ViewMode {
  const productId = params.get('product')
  if (productId) return { kind: 'product', productId }
  return { kind: 'builder' }
}

export function shareUrl(config: PoleConfig): string {
  if (typeof window === 'undefined') {
    // Test or SSR environment — just return relative URL with params
    return `?${configToParams(config).toString()}`
  }
  const url = new URL(window.location.href)
  url.search = configToParams(config).toString()
  return url.toString()
}
