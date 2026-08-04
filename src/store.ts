import { create } from 'zustand'
import type { Catalog, PoleConfig, ProductLine, Slot } from './types'
import { defaultConfig, defaultSpecOptions, exclusiveFamily, partById, repairConfig, specCodes } from './lib/compat'
import { parseDescription } from './lib/parse'
import {
  configToParams,
  paramsToPartialConfig,
  paramsToViewMode,
  paramsToScene,
  DEFAULT_SCENE,
} from './lib/url'
import type { Scene } from './lib/url'
import { brandHomePath, builderPath, productPath, parseRoute } from './lib/routes'

export type SceneMode = 'day' | 'night'
export type { Scene } from './lib/url'
export type ViewMode =
  | { kind: 'builder' }
  | { kind: 'product'; productId: string }
  /** Brand landing (Tesla-style product grid) — non-WiLLstudio brands. */
  | { kind: 'home' }

interface ConfiguratorState {
  catalog: Catalog | null
  config: PoleConfig | null
  showScale: boolean
  /** Day/night preset. Night is a conceptual preview, not a photometric simulation. */
  mode: SceneMode
  /**
   * Viewer daytime backdrop preset (Park/Street/Courtyard). A separate axis
   * from `mode` and from `config` — it decorates the viewer only and survives
   * config changes because it lives here, not in `config`.
   */
  scene: Scene
  /** Current view mode: builder (3D wizard) or product (standalone product page). */
  view: ViewMode
  /**
   * Phase 1.0: assembly view rotation in 45° steps (0..315). A viewer-state
   * axis like `scene` — spins the whole composited assembly via the
   * per-azimuth renders; it never changes the config.
   */
  viewYaw: number
  setViewYaw: (deg: number) => void
  /** Phase 1.0: object URL of the user-uploaded custom backdrop (session-only). */
  customSceneUrl: string | null
  /** Store an uploaded backdrop photo and switch to it. */
  setCustomScene: (url: string) => void
  /** Active brand — drives routing and catalog scoping. */
  brand: ProductLine
  loadCatalog: () => Promise<void>
  select: (slot: Slot, id: string) => void
  /** Phase 1.0: set one part's finish (per-slot override on the base finish). */
  setFinish: (slot: Slot, id: string) => void
  /** Phase 1.1: set one part's custom RAL color (#rrggbb) — only meaningful when its finish is custom-ral. */
  setFinishRal: (slot: Slot, hex: string) => void
  /** Phase 0.8 (A1): set the radial arm count (1 single / 2 twin / 3 triple / 4 quad). */
  setArmCount: (count: number) => void
  /** Phase 1.0: rotate the arm arrangement about the pole (0 / 90 / 180 / 270°). */
  setArmOrientation: (deg: number) => void
  /** Phase 0.8 (C): set or clear the mid-shaft banner-arm accessory. */
  setBanner: (banner: import('./types').BannerConfig | null) => void
  /** Phase 1.0: place a selected pole accessory (FSTR/CPL/FH/PH/…) on the shaft. */
  setAccessoryPlacement: (code: string, placement: import('./types').AccessoryPlacement) => void
  /** Phase 0.8 (D), reshaped 1.0: pick a single-choice ordering column value for one part's step. */
  setSpecOption: (slot: Slot, key: string, code: string) => void
  /**
   * Phase 1.0: toggle a multi-select options/accessories code for one part's
   * step. Checking a code in an exclusive family (cord/surge/photocontrol)
   * unchecks that family's previous code across all of the part's columns.
   */
  toggleSpecOption: (slot: Slot, key: string, code: string) => void
  /** Describe-your-product box: parse keywords, pre-select matching steps. */
  applyDescription: (text: string) => string[]
  toggleScale: () => void
  toggleMode: () => void
  /** Choose a viewer backdrop scene; persists to state + (non-default) the URL. */
  setScene: (scene: Scene) => void
  /** Navigate to a standalone product view (switches brand to the product's line). */
  openProduct: (id: string) => void
  /** Return to the current brand's landing (builder for WiLLstudio, product grid otherwise). */
  openHome: () => void
  /** High-res capture registered by the mounted viewer (CompositeViewer/ProductViewer); null until mounted. */
  snapshot: (() => Promise<Blob | null>) | null
  registerSnapshot: (fn: (() => Promise<Blob | null>) | null) => void
}

function syncUrl(brand: ProductLine, config: PoleConfig, scene: Scene) {
  window.history.replaceState(
    null,
    '',
    `${builderPath(brand)}?${configToParams(config, scene)}`,
  )
}

function syncProductUrl(brand: ProductLine, productId: string) {
  window.history.replaceState(null, '', productPath(brand, productId))
}

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  catalog: null,
  config: null,
  showScale: false,
  mode: 'day',
  scene: DEFAULT_SCENE,
  view: { kind: 'builder' },
  brand: 'WiLLstudio',

  loadCatalog: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`)
    const catalog: Catalog = await res.json()
    // Parse path for brand + view, then fall back to query-param product for back-compat
    const routeResult = parseRoute(window.location.pathname)
    const searchParams = new URLSearchParams(window.location.search)
    // Query-param product wins for legacy share links (?product=<id>)
    const queryView = paramsToViewMode(searchParams)
    const initialView = queryView.kind === 'product' ? queryView : routeResult.view
    const initialBrand = routeResult.brand
    const fromUrl = paramsToPartialConfig(searchParams)
    const config = fromUrl
      ? repairConfig(catalog, { ...defaultConfig(catalog, initialBrand), ...fromUrl, brand: initialBrand })
      : defaultConfig(catalog, initialBrand)
    const scene = paramsToScene(searchParams)
    // Sync URL to match the resolved view
    if (initialView.kind === 'product') {
      syncProductUrl(initialBrand, initialView.productId)
    } else if (initialView.kind === 'home') {
      window.history.replaceState(null, '', brandHomePath(initialBrand))
    } else {
      syncUrl(initialBrand, config, scene)
    }
    set({ catalog, config, view: initialView, brand: initialBrand, scene })
  },

  select: (slot, id) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || config[slot] === id) return
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return
    // Phase 1.0: choosing a different part resets that slot's spec choices to
    // the part's defaults (e.g. the 6' cord) — the old choices belonged to a
    // different product's ordering table.
    const specOptions = { ...(config.specOptions ?? {}), [slot]: defaultSpecOptions(partById(catalog, id)) }
    const next = repairConfig(catalog, { ...config, [slot]: id, specOptions, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setArmCount: (count) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || (config.armCount ?? 1) === count) return
    if (view.kind === 'product') return
    const next = repairConfig(catalog, { ...config, armCount: count, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setArmOrientation: (deg) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || (config.armOrientation ?? 0) === deg) return
    if (view.kind === 'product') return
    const next = repairConfig(catalog, { ...config, armOrientation: deg, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setBanner: (banner) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config) return
    if (view.kind === 'product') return
    const next = repairConfig(catalog, { ...config, banner, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setFinish: (slot, id) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || view.kind === 'product') return
    if ((config.finishes?.[slot] ?? config.finish) === id) return
    const finishes = { ...(config.finishes ?? {}), [slot]: id }
    const next = repairConfig(catalog, { ...config, finishes, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setAccessoryPlacement: (code, placement) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || view.kind === 'product') return
    const accessoryPlacements = { ...(config.accessoryPlacements ?? {}), [code]: placement }
    const next = repairConfig(catalog, { ...config, accessoryPlacements, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setFinishRal: (slot, hex) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || view.kind === 'product') return
    if (config.finishRal?.[slot] === hex) return
    const finishRal = { ...(config.finishRal ?? {}), [slot]: hex }
    const next = repairConfig(catalog, { ...config, finishRal, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  setSpecOption: (slot, key, code) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || view.kind === 'product') return
    const forSlot = { ...(config.specOptions?.[slot] ?? {}), [key]: code }
    const specOptions = { ...(config.specOptions ?? {}), [slot]: forSlot }
    const next = repairConfig(catalog, { ...config, specOptions, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  toggleSpecOption: (slot, key, code) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config || view.kind === 'product') return
    const forSlot: Record<string, string | string[]> = { ...(config.specOptions?.[slot] ?? {}) }
    const current = specCodes(forSlot[key])
    if (current.includes(code)) {
      forSlot[key] = current.filter((c) => c !== code)
    } else {
      // One per exclusive family: strip the family's previous code from every
      // multi-select column before adding (repairConfig keeps first-in-sheet,
      // so the stale one must go here for the new pick to survive).
      const family = exclusiveFamily(code)
      if (family) {
        for (const k of Object.keys(forSlot)) {
          const codes = specCodes(forSlot[k])
          if (Array.isArray(forSlot[k]) || k === key) {
            forSlot[k] = codes.filter((c) => exclusiveFamily(c) !== family)
          }
        }
      }
      forSlot[key] = [...specCodes(forSlot[key]), code]
    }
    const specOptions = { ...(config.specOptions ?? {}), [slot]: forSlot }
    const next = repairConfig(catalog, { ...config, specOptions, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
  },

  applyDescription: (text) => {
    const { catalog, config, view, brand, scene } = get()
    if (!catalog || !config) return []
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return []
    const { matched, matchedTerms } = parseDescription(catalog, text)
    if (matchedTerms.length === 0) return []
    const next = repairConfig(catalog, { ...config, ...matched, rev: config.rev + 1 })
    syncUrl(brand, next, scene)
    set({ config: next })
    return matchedTerms
  },

  viewYaw: 0,
  setViewYaw: (deg) => set({ viewYaw: ((Math.round(deg / 45) * 45) % 360 + 360) % 360 }),

  customSceneUrl: null,
  setCustomScene: (url) => {
    const prev = get().customSceneUrl
    if (prev && prev !== url) URL.revokeObjectURL(prev)
    set({ customSceneUrl: url, scene: 'custom' })
  },

  toggleScale: () => set((s) => ({ showScale: !s.showScale })),

  toggleMode: () => set((s) => ({ mode: s.mode === 'day' ? 'night' : 'day' })),

  setScene: (scene) => {
    const { catalog, config, view, brand } = get()
    set({ scene })
    // Keep the share URL in sync while building (product view uses a bare
    // product path and carries no scene param).
    if (catalog && config && view.kind === 'builder') {
      syncUrl(brand, config, scene)
    }
  },

  openProduct: (id) => {
    const { catalog, brand } = get()
    // A product view belongs to the product's own brand line — keeps URLs canonical
    const partLine = catalog?.parts.find((p) => p.id === id)?.line
    const nextBrand: ProductLine = partLine && partLine !== 'Other' ? partLine : brand
    syncProductUrl(nextBrand, id)
    set({ brand: nextBrand, view: { kind: 'product', productId: id } })
  },

  openHome: () => {
    const { config, brand, scene } = get()
    if (brand === 'WiLLstudio') {
      if (config) syncUrl(brand, config, scene)
      set({ view: { kind: 'builder' } })
      return
    }
    window.history.replaceState(null, '', brandHomePath(brand))
    set({ view: { kind: 'home' } })
  },

  snapshot: null,
  registerSnapshot: (fn) => set({ snapshot: fn }),
}))
