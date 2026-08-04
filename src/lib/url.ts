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
/**
 * Phase 0.10 (B): the base cover is an Option, so "no base cover" is a real
 * choice a share link has to carry — an omitted param means "unspecified" and
 * would be filled back in from the default build.
 */
export const NO_BASE_COVER = 'none'

export function configToParams(config: PoleConfig, scene: Scene = DEFAULT_SCENE): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of PART_KEYS) {
    if (config[key]) params.set(key, config[key])
  }
  if (config.baseCover === '') params.set('baseCover', NO_BASE_COVER)
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
  // Phase 0.8 (D): selected spec-sheet options as `key:code,key:code`. Only
  // pre-0.10 configs carry this (repairConfig folds it into partOptions).
  if (config.specOptions && Object.keys(config.specOptions).length > 0) {
    const opts = Object.entries(config.specOptions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    params.set('opts', opts)
  }
  // Phase 0.10 (Workstream 0/B): per-part ordering selections. Two flat, sorted
  // lists so share links stay deterministic and diffable:
  //   popts  = <partId>.<optionKey>=<code>,…   (single-select ordering columns)
  //   addons = <partId>.<code>,…               (multi-select Options/Accessories)
  // Part ids and option keys never contain '.', '=' or ',', so the split is safe.
  if (config.partOptions) {
    const codes: string[] = []
    const addOns: string[] = []
    for (const [partId, selections] of Object.entries(config.partOptions).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      for (const [key, code] of Object.entries(selections.codes ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        codes.push(`${partId}.${key}=${code}`)
      }
      for (const code of [...(selections.addOns ?? [])].sort()) {
        addOns.push(`${partId}.${code}`)
      }
    }
    if (codes.length > 0) params.set('popts', codes.join(','))
    if (addOns.length > 0) params.set('addons', addOns.join(','))
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
      // Phase 0.10 (B): an explicit "no base cover" choice.
      partial[key] = key === 'baseCover' && value === NO_BASE_COVER ? '' : value
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
  // Phase 0.8 (D): spec options `key:code,key:code`.
  const optsValue = params.get('opts')
  if (optsValue) {
    const specOptions: Record<string, string> = {}
    for (const pair of optsValue.split(',')) {
      const [k, v] = pair.split(':')
      if (k && v) specOptions[k] = v
    }
    if (Object.keys(specOptions).length > 0) {
      partial.specOptions = specOptions
      found = true
    }
  }
  // Phase 0.10: per-part selections. repairPartOptions validates every code
  // against the part's real matrix, so junk here can never reach a part number.
  const partOptions: Record<string, { codes?: Record<string, string>; addOns?: string[] }> = {}
  const poptsValue = params.get('popts')
  if (poptsValue) {
    for (const entry of poptsValue.split(',')) {
      const [lhs, code] = entry.split('=')
      if (!lhs || !code) continue
      const dot = lhs.indexOf('.')
      if (dot <= 0) continue
      const partId = lhs.slice(0, dot)
      const key = lhs.slice(dot + 1)
      if (!key) continue
      const selections = (partOptions[partId] ??= {})
      selections.codes = { ...(selections.codes ?? {}), [key]: code }
    }
  }
  const addonsValue = params.get('addons')
  if (addonsValue) {
    for (const entry of addonsValue.split(',')) {
      const dot = entry.indexOf('.')
      if (dot <= 0) continue
      const partId = entry.slice(0, dot)
      const code = entry.slice(dot + 1)
      if (!code) continue
      const selections = (partOptions[partId] ??= {})
      selections.addOns = [...(selections.addOns ?? []), code]
    }
  }
  if (Object.keys(partOptions).length > 0) {
    partial.partOptions = partOptions
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
