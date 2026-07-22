import { useEffect, useState } from 'react'
import type { RenderManifest } from './composite'

let manifestPromise: Promise<RenderManifest | null> | null = null

/** Fetch (once) the render manifest; null when unavailable → fallback UI. */
export function fetchRenderManifest(): Promise<RenderManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}renders/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RenderManifest>) : null))
      .catch(() => null)
  }
  return manifestPromise
}

/** undefined while loading, null when the manifest is unavailable. */
export function useRenderManifest(): RenderManifest | null | undefined {
  const [manifest, setManifest] = useState<RenderManifest | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void fetchRenderManifest().then((m) => {
      if (active) setManifest(m)
    })
    return () => {
      active = false
    }
  }, [])
  return manifest
}

export function renderUrl(file: string): string {
  return import.meta.env.BASE_URL + file
}
