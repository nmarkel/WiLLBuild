import type { PoleConfig, ProductLine, Slot } from '../types'
import type { ViewMode } from '../store'

const PART_KEYS = ['pole', 'baseCover', 'arm', 'fixture', 'finish'] as const

/** Slots that may carry a per-part finish override / spec-option set (Phase 1.0). */
const OPTION_SLOTS: readonly Slot[] = ['fixture', 'arm', 'pole', 'baseCover']

function isOptionSlot(v: string): v is Slot {
  return (OPTION_SLOTS as readonly string[]).includes(v)
}

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
  // Phase 0.8 (A4): arm count — omit the single-arm default to keep URLs clean.
  if (config.armCount && config.armCount > 1) {
    params.set('arms', String(config.armCount))
  }
  // Phase 0.8 (C/A4): banner accessory encoded as `armId~count~heightFt`.
  if (config.banner) {
    params.set(
      'banner',
      `${config.banner.armId}~${config.banner.count}~${config.banner.heightFt}`,
    )
  }
  // Phase 1.0: per-slot finish overrides as `slot:finishId,slot:finishId`
  // (base `finish` stays its own param for pre-1.0 link compatibility).
  if (config.finishes) {
    const fins = Object.entries(config.finishes)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    if (fins) params.set('fins', fins)
  }
  // Phase 0.8 (D), reshaped 1.0: spec options as `slot.key:code,slot.key:code`;
  // multi-select columns join their codes with `+` (`fixture.options:WHP3NP+N5P`).
  if (config.specOptions) {
    const opts = Object.entries(config.specOptions)
      .flatMap(([slot, chosen]) =>
        Object.entries(chosen ?? {})
          .map(([k, v]) => [k, Array.isArray(v) ? v.filter(Boolean).join('+') : v] as const)
          .filter(([, v]) => v)
          .map(([k, v]) => `${slot}.${k}:${v}`),
      )
      .sort((a, b) => a.localeCompare(b))
      .join(',')
    if (opts) params.set('opts', opts)
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
  // Phase 0.8 (A4): arm count — whitelist to 1..4; repairConfig clamps further.
  const armsValue = params.get('arms')
  if (armsValue) {
    const n = Number(armsValue)
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      partial.armCount = n
      found = true
    }
  }
  // Phase 0.8 (C/A4): banner `armId~count~heightFt`; repairConfig validates the part.
  const bannerValue = params.get('banner')
  if (bannerValue) {
    const [armId, countStr, heightStr] = bannerValue.split('~')
    const count = Number(countStr)
    const heightFt = Number(heightStr)
    if (armId && Number.isFinite(count) && Number.isFinite(heightFt)) {
      partial.banner = { armId, count, heightFt }
      found = true
    }
  }
  // Phase 1.0: per-slot finish overrides `slot:finishId,...`; repairConfig
  // validates the finish ids.
  const finsValue = params.get('fins')
  if (finsValue) {
    const finishes: Partial<Record<Slot, string>> = {}
    for (const pair of finsValue.split(',')) {
      const [slot, id] = pair.split(':')
      if (slot && id && isOptionSlot(slot)) finishes[slot] = id
    }
    if (Object.keys(finishes).length > 0) {
      partial.finishes = finishes
      found = true
    }
  }
  // Phase 0.8 (D), reshaped 1.0: spec options `slot.key:code,...` with `+`
  // joining multi-select codes. Legacy pre-1.0 pairs have no slot prefix —
  // they were always fixture options. repairConfig normalizes shapes (string
  // for ordering columns, string[] for options & accessories).
  const optsValue = params.get('opts')
  if (optsValue) {
    const specOptions: NonNullable<PoleConfig['specOptions']> = {}
    for (const pair of optsValue.split(',')) {
      const [k, v] = pair.split(':')
      if (!k || !v) continue
      const dot = k.indexOf('.')
      const slot = dot > 0 ? k.slice(0, dot) : 'fixture'
      const key = dot > 0 ? k.slice(dot + 1) : k
      if (!key || !isOptionSlot(slot)) continue
      const codes = v.split('+').filter(Boolean)
      if (codes.length === 0) continue
      ;(specOptions[slot] ??= {})[key] = codes.length > 1 ? codes : codes[0]
    }
    if (Object.keys(specOptions).length > 0) {
      partial.specOptions = specOptions
      found = true
    }
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
