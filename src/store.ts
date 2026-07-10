import { create } from 'zustand'
import type { Catalog, PoleConfig, Slot } from './types'
import { defaultConfig, repairConfig } from './lib/compat'
import { parseDescription } from './lib/parse'
import { configToParams, paramsToPartialConfig, productToParams, paramsToViewMode } from './lib/url'

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

function syncUrl(config: PoleConfig) {
  window.history.replaceState(null, '', `?${configToParams(config)}`)
}

function syncProductUrl(productId: string) {
  window.history.replaceState(null, '', `?${productToParams(productId)}`)
}

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  catalog: null,
  config: null,
  showScale: false,
  mode: 'day',
  view: { kind: 'builder' },

  loadCatalog: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`)
    const catalog: Catalog = await res.json()
    const searchParams = new URLSearchParams(window.location.search)
    const initialView = paramsToViewMode(searchParams)
    const fromUrl = paramsToPartialConfig(searchParams)
    const config = fromUrl
      ? repairConfig(catalog, { ...defaultConfig(catalog), ...fromUrl })
      : defaultConfig(catalog)
    // Sync URL to match the resolved view
    if (initialView.kind === 'product') {
      syncProductUrl(initialView.productId)
    } else {
      syncUrl(config)
    }
    set({ catalog, config, view: initialView })
  },

  select: (slot, id) => {
    const { catalog, config, view } = get()
    if (!catalog || !config || config[slot] === id) return
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return
    const next = repairConfig(catalog, { ...config, [slot]: id, rev: config.rev + 1 })
    syncUrl(next)
    set({ config: next })
  },

  applyDescription: (text) => {
    const { catalog, config, view } = get()
    if (!catalog || !config) return []
    // Don't clobber the product URL when in product view
    if (view.kind === 'product') return []
    const { matched, matchedTerms } = parseDescription(catalog, text)
    if (matchedTerms.length === 0) return []
    const next = repairConfig(catalog, { ...config, ...matched, rev: config.rev + 1 })
    syncUrl(next)
    set({ config: next })
    return matchedTerms
  },

  toggleScale: () => set((s) => ({ showScale: !s.showScale })),

  toggleMode: () => set((s) => ({ mode: s.mode === 'day' ? 'night' : 'day' })),

  openProduct: (id) => {
    syncProductUrl(id)
    set({ view: { kind: 'product', productId: id } })
  },

  openBuilder: () => {
    const { config } = get()
    if (config) syncUrl(config)
    set({ view: { kind: 'builder' } })
  },

  snapshot: null,
  registerSnapshot: (fn) => set({ snapshot: fn }),
}))
