import type { PoleConfig, ProductLine, Slot } from '../types'
import type { ViewMode } from '../store'

const PART_KEYS = ['pole', 'baseCover', 'arm', 'fixture', 'finish'] as const

/** Slots that may carry a per-part finish override / spec-option set (Phase 0.10.5). */
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
export const SCENES = ['park', 'street', 'parking', 'blank'] as const
/**
 * 'custom' is a session-only scene backed by a user-uploaded photo (object
 * URL in the store) — it can't ride a share URL, so it's outside SCENES.
 */
export type Scene = (typeof SCENES)[number] | 'custom'
/**
 * Phase 0.11 (F1): the default backdrop is Blank — the clean studio background,
 * product first. NOTE the behaviour change: a pre-0.11 share URL with no `scene`
 * param used to restore Park and now restores Blank (the "omit the default"
 * rule means the param was never written for the then-default Park).
 */
export const DEFAULT_SCENE: Scene = 'blank'

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
  // Phase 0.10.5: arm orientation — omit the 0° default.
  if (config.armOrientation) {
    params.set('orient', String(config.armOrientation))
  }
  // Phase 0.8 (C/A4): banner accessory encoded as `armId~count~heightFt`.
  // Phase 0.11 (D): plus an optional trailing `~size` panel id. Trailing and
  // optional so pre-0.11 links (3 fields) still parse; without it a shared
  // 30x60 banner would silently come back as the 24x48 default.
  if (config.banner) {
    const size = config.banner.size ? `~${config.banner.size}` : ''
    params.set(
      'banner',
      `${config.banner.armId}~${config.banner.count}~${config.banner.heightFt}${size}`,
    )
  }
  // Phase 0.10.5: per-slot finish overrides as `slot:finishId,slot:finishId`
  // (base `finish` stays its own param for pre-0.10.5 link compatibility).
  if (config.finishes) {
    const fins = Object.entries(config.finishes)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    if (fins) params.set('fins', fins)
  }
  // Phase 0.10.5: accessory placements as `code~heightFt~orientation[~sides]`.
  // Phase 0.11 (D): optional trailing `~size` (banner-kit panel id). `sides`
  // is positional, so a placement with a size but no sides emits an EMPTY
  // sides field (`FSTR~6~90~~30x60`) rather than shifting size into its slot.
  if (config.accessoryPlacements) {
    const place = Object.entries(config.accessoryPlacements)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, p]) => {
        const head = `${code}~${+p.heightFt.toFixed(2)}~${p.orientation}`
        if (p.size) return `${head}~${p.sides ?? ''}~${p.size}`
        return p.sides !== undefined ? `${head}~${p.sides}` : head
      })
      .join(',')
    if (place) params.set('place', place)
  }
  // Phase 0.10.5: custom RAL colors as `slot:rrggbb` (hex without the #).
  if (config.finishRal) {
    const rals = Object.entries(config.finishRal)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v.replace('#', '')}`)
      .join(',')
    if (rals) params.set('ral', rals)
  }
  // Phase 0.8 (D), reshaped in 0.10.5: spec options as `slot.key:code,slot.key:code`;
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
  if (scene !== DEFAULT_SCENE && isScene(scene)) {
    params.set('scene', scene)
  }
  return params
}

/** Read the viewer scene from query params; unknown/absent → default (Blank). */
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
  // Phase 0.10.5: arm orientation — whitelist 90/180/270 (0 is the omitted default).
  const orientValue = params.get('orient')
  if (orientValue) {
    const deg = Number(orientValue)
    if ([90, 180, 270].includes(deg)) {
      partial.armOrientation = deg
      found = true
    }
  }
  // Phase 0.8 (C/A4): banner `armId~count~heightFt`; repairConfig validates the part.
  const bannerValue = params.get('banner')
  if (bannerValue) {
    const [armId, countStr, heightStr, sizeStr] = bannerValue.split('~')
    const count = Number(countStr)
    const heightFt = Number(heightStr)
    if (armId && Number.isFinite(count) && Number.isFinite(heightFt)) {
      // Phase 0.11 (D): trailing panel size, absent on pre-0.11 links.
      // repairConfig resolves an unknown id to the catalog default.
      partial.banner = sizeStr
        ? { armId, count, heightFt, size: sizeStr }
        : { armId, count, heightFt }
      found = true
    }
  }
  // Phase 0.10.5: per-slot finish overrides `slot:finishId,...`; repairConfig
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
  // Phase 0.10.5: accessory placements `code~heightFt~orientation`; repairConfig
  // clamps values and drops codes not actually selected on the pole.
  const placeValue = params.get('place')
  if (placeValue) {
    const accessoryPlacements: NonNullable<PoleConfig['accessoryPlacements']> = {}
    for (const entry of placeValue.split(',')) {
      const [code, ftStr, oStr, sidesStr, sizeStr] = entry.split('~')
      const heightFt = Number(ftStr)
      const orientation = Number(oStr)
      if (code && Number.isFinite(heightFt) && Number.isFinite(orientation)) {
        // `sides` may be an EMPTY field when a size follows it (see the
        // serializer) — treat '' as absent rather than as Number('') === 0.
        const sides = sidesStr ? Number(sidesStr) : undefined
        accessoryPlacements[code] = {
          heightFt,
          orientation,
          ...(sides !== undefined && Number.isFinite(sides) ? { sides } : {}),
          ...(sizeStr ? { size: sizeStr } : {}),
        }
      }
    }
    if (Object.keys(accessoryPlacements).length > 0) {
      partial.accessoryPlacements = accessoryPlacements
      found = true
    }
  }
  // Phase 0.10.5: custom RAL colors `slot:rrggbb`; repairConfig validates the hex
  // and drops entries whose slot finish isn't custom-ral.
  const ralValue = params.get('ral')
  if (ralValue) {
    const finishRal: Partial<Record<Slot, string>> = {}
    for (const pair of ralValue.split(',')) {
      const [slot, hex] = pair.split(':')
      if (slot && hex && isOptionSlot(slot) && /^[0-9a-fA-F]{6}$/.test(hex)) {
        finishRal[slot] = `#${hex.toLowerCase()}`
      }
    }
    if (Object.keys(finishRal).length > 0) {
      partial.finishRal = finishRal
      found = true
    }
  }
  // Phase 0.8 (D), reshaped in 0.10.5: spec options `slot.key:code,...` with `+`
  // joining multi-select codes. Legacy pre-0.10.5 pairs have no slot prefix —
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

/**
 * Build the link a customer gets. ALWAYS pass the live viewer scene: omitting
 * it falls back to DEFAULT_SCENE, which silently drops the backdrop the user is
 * actually looking at from the shared link (Phase 0.11 F3). UI code should go
 * through the store's `shareLink()` rather than calling this directly.
 */
export function shareUrl(config: PoleConfig, scene: Scene = DEFAULT_SCENE): string {
  if (typeof window === 'undefined') {
    // Test or SSR environment — just return relative URL with params
    return `?${configToParams(config, scene).toString()}`
  }
  const url = new URL(window.location.href)
  url.search = configToParams(config, scene).toString()
  return url.toString()
}
