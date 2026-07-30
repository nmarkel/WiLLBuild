import type { PoleConfig, ProductLine } from '../types'
import type { ViewMode } from '../store'

const PART_KEYS = ['pole', 'baseCover', 'arm', 'fixture', 'finish'] as const

const DEFAULT_BRAND: ProductLine = 'WiLLstudio'

/** Valid ProductLine values for URL parameter validation. */
const VALID_BRANDS = ['NAFCO', 'WiLLsport', 'WiLLstudio', 'WiLLev', 'WiLLcloud', 'Other'] as const

/**
 * Viewer daytime backdrop presets. A separate axis from day/night `mode` and
 * from the config itself — it decorates the viewer, it does not change the
 * product. Persisted in store state (survives config changes) and, when
 * non-default, in the share URL (same "omit the default" rule as `brand`).
 */
export const SCENES = ['park', 'street', 'courtyard', 'blank'] as const
export type Scene = (typeof SCENES)[number]
export const DEFAULT_SCENE: Scene = 'park'

function isScene(v: string | null): v is Scene {
  return v != null && (SCENES as readonly string[]).includes(v)
}

/**
 * Serialize the selection into query params so any config is shareable as a
 * URL. `scene` is an optional viewer-state extra (not part of the config
 * object); it is only written when it differs from the default, keeping share
 * URLs clean.
 */
export function configToParams(config: PoleConfig, scene: Scene = DEFAULT_SCENE): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of PART_KEYS) {
    if (config[key]) params.set(key, config[key])
  }
  // Only serialize brand when it differs from the default — keeps share URLs clean.
  if (config.brand !== DEFAULT_BRAND) {
    params.set('brand', config.brand)
  }
  if (scene !== DEFAULT_SCENE) {
    params.set('scene', scene)
  }
  return params
}

/** Read the viewer scene from query params; unknown/absent → default (Park). */
export function paramsToScene(params: URLSearchParams): Scene {
  const value = params.get('scene')
  return isScene(value) ? value : DEFAULT_SCENE
}

/**
 * Read a partial config from query params. Returns null if no config keys are
 * present. IDs are not validated here — callers repair against the catalog.
 * Invalid brand values are silently ignored.
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
  if (brandValue && (VALID_BRANDS as readonly string[]).includes(brandValue)) {
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

export function shareUrl(config: PoleConfig, scene: Scene = DEFAULT_SCENE): string {
  if (typeof window === 'undefined') {
    // Test or SSR environment — just return relative URL with params
    return `?${configToParams(config, scene).toString()}`
  }
  const url = new URL(window.location.href)
  url.search = configToParams(config, scene).toString()
  return url.toString()
}
