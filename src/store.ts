import { create } from 'zustand'
import type { Catalog, PoleConfig, Slot } from './types'
import { defaultConfig, repairConfig } from './lib/compat'
import { parseDescription } from './lib/parse'
import { configToParams, paramsToPartialConfig } from './lib/url'

export type SceneMode = 'day' | 'night'

interface ConfiguratorState {
  catalog: Catalog | null
  config: PoleConfig | null
  showScale: boolean
  /** Day/night preset. Night is a conceptual preview, not a photometric simulation. */
  mode: SceneMode
  loadCatalog: () => Promise<void>
  select: (slot: Slot | 'finish', id: string) => void
  /** Describe-your-product box: parse keywords, pre-select matching steps. */
  applyDescription: (text: string) => string[]
  toggleScale: () => void
  toggleMode: () => void
  /** High-res capture registered by SnapshotRig (mounted inside the R3F Canvas); null until mounted. */
  snapshot: (() => Promise<Blob | null>) | null
  registerSnapshot: (fn: (() => Promise<Blob | null>) | null) => void
}

function syncUrl(config: PoleConfig) {
  window.history.replaceState(null, '', `?${configToParams(config)}`)
}

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  catalog: null,
  config: null,
  showScale: false,
  mode: 'day',

  loadCatalog: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`)
    const catalog: Catalog = await res.json()
    const fromUrl = paramsToPartialConfig(new URLSearchParams(window.location.search))
    const config = fromUrl
      ? repairConfig(catalog, { ...defaultConfig(catalog), ...fromUrl })
      : defaultConfig(catalog)
    syncUrl(config)
    set({ catalog, config })
  },

  select: (slot, id) => {
    const { catalog, config } = get()
    if (!catalog || !config || config[slot] === id) return
    const next = repairConfig(catalog, { ...config, [slot]: id, rev: config.rev + 1 })
    syncUrl(next)
    set({ config: next })
  },

  applyDescription: (text) => {
    const { catalog, config } = get()
    if (!catalog || !config) return []
    const { matched, matchedTerms } = parseDescription(catalog, text)
    if (matchedTerms.length === 0) return []
    const next = repairConfig(catalog, { ...config, ...matched, rev: config.rev + 1 })
    syncUrl(next)
    set({ config: next })
    return matchedTerms
  },

  toggleScale: () => set((s) => ({ showScale: !s.showScale })),

  toggleMode: () => set((s) => ({ mode: s.mode === 'day' ? 'night' : 'day' })),

  snapshot: null,
  registerSnapshot: (fn) => set({ snapshot: fn }),
}))
