import { create } from 'zustand'
import type { Catalog, PoleConfig, ProductLine, Slot } from './types'
import { defaultConfig, repairConfig } from './lib/compat'
import { parseDescription } from './lib/parse'
import { configToParams, paramsToPartialConfig, paramsToViewMode } from './lib/url'
import { builderPath, productPath, parseRoute } from './lib/routes'

export type SceneMode = 'day' | 'night'
export type ViewMode = { kind: 'builder' } | { kind: 'product'; productId: string }

interface ConfiguratorState {
  catalog: Catalog | null
  config: PoleConfig | null
  showScale: boolean
  /** Day/night preset. Night is a conceptual preview, not a photometric simulation. */
  mode: SceneMode
  /** Current view mode: builder (3D wizard) or product (standalone product page). */
  view: ViewMode
  /** Active brand — drives routing and catalog scoping. */
  brand: ProductLine
  loadCatalog: () => Promise<void>
  select: (slot: Slot | 'finish', id: string) => void
  /** Describe-your-product box: parse keywords, pre-select matching steps. */
  applyDescription: (text: string) => string[]
  toggleScale: () => void
  toggleMode: () => void
  /** Navigate to a standalone product view. */
  openProduct: (id: string) => void
  /** Return to the builder; restores config URL params. */
  openBuilder: () => void
  /** High-res capture registered by SnapshotRig (mounted inside the R3F Canvas); null until mounted. */
  snapshot: (() => Promise<Blob | null>) | null
  registerSnapshot: (fn: (() => Promise<Blob | null>) | null) => void
}

function syncUrl(brand: ProductLine, config: PoleConfig) {
  window.history.replaceState(null, '', `${builderPath(brand)}?${configToParams(config)}`)
}

function syncProductUrl(brand: ProductLine, productId: string) {
  window.history.replaceState(null, '', productPath(brand, productId))
}

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  catalog: null,
  config: null,
  showScale: false,
  mode: 'day',
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
      ? repairConfig(catalog, { ...defaultConfig(catalog), ...fromUrl })
      : defaultConfig(catalog)
    // Sync URL to match the resolved view
    if (initialView.kind === 'product') {
      syncProductUrl(initialBrand, initialView.productId)
    } else {
      syncUrl(initialBrand, config)
    }
    set({ catalog, config, view: initialView, brand: initialBrand })
  },

  select: (slot, id) => {
    const { catalog, config, view, brand } = get()
    if (!catalog || !config || config[slot] === id) return
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return
    const next = repairConfig(catalog, { ...config, [slot]: id, rev: config.rev + 1 })
    syncUrl(brand, next)
    set({ config: next })
  },

  applyDescription: (text) => {
    const { catalog, config, view, brand } = get()
    if (!catalog || !config) return []
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return []
    const { matched, matchedTerms } = parseDescription(catalog, text)
    if (matchedTerms.length === 0) return []
    const next = repairConfig(catalog, { ...config, ...matched, rev: config.rev + 1 })
    syncUrl(brand, next)
    set({ config: next })
    return matchedTerms
  },

  toggleScale: () => set((s) => ({ showScale: !s.showScale })),

  toggleMode: () => set((s) => ({ mode: s.mode === 'day' ? 'night' : 'day' })),

  openProduct: (id) => {
    const { brand } = get()
    syncProductUrl(brand, id)
    set({ view: { kind: 'product', productId: id } })
  },

  openBuilder: () => {
    const { config, brand } = get()
    if (config) syncUrl(brand, config)
    set({ view: { kind: 'builder' } })
  },

  snapshot: null,
  registerSnapshot: (fn) => set({ snapshot: fn }),
}))
