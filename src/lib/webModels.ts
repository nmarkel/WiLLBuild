/**
 * Phase 0.15 (Workstream A) — the web-GLB registry for live 3D focus views.
 *
 * A web GLB is a SHIPPED 3D asset, so which parts have one is an explicit,
 * gated registry (`public/renders/web-glb-manifest.json`), never "whatever GLB
 * exists". For the SH1 spike the registry is hand-authored and pinned by
 * `webModels.test.ts` (real-CAD fixtures/arms only, file present, ≤3 MB,
 * rotateYDeg agreeing with the render rig); Workstream B replaces it with a
 * generated artifact whose gate additionally proves exterior-shell-only
 * content — the IP guardrail.
 *
 * Fallback is structural: `webModelFor` returning null IS today's behavior
 * (the image focus crop). A placeholder part can never return an entry, no
 * matter what the manifest claims.
 */
import { useEffect, useState } from 'react'
import type { CatalogPart, Slot } from '../types'

/** Hard payload budget per part (the 0.12/0.15 ≤2–3 MB rule, upper bound). */
export const WEB_GLB_BUDGET_BYTES = 3 * 1024 * 1024

/** The slots whose focus view may go live — 0.15 scope: fixtures + arms only. */
export const LIVE_FOCUS_SLOTS = ['fixture', 'arm'] as const satisfies readonly Slot[]

export interface WebModelEntry {
  /** Path under BASE_URL, e.g. "renders/web-glb/sh1-shepherds-hook.glb". */
  file: string
  /** Size on disk — pinned by test so the recorded payload can't drift. */
  bytes: number
  /**
   * Yaw (degrees about +Y) aligning the GLB's native reach with the catalog's
   * +X convention — the same value the render rig applies (real-parts.json),
   * so the live model and the WebP face the same way.
   */
  rotateYDeg?: number
}

export interface WebModelManifest {
  version: number
  models: Record<string, WebModelEntry>
}

let webModelPromise: Promise<WebModelManifest | null> | null = null

/** Fetch (once) the web-GLB manifest; null when unavailable → image fallback. */
export function fetchWebModelManifest(): Promise<WebModelManifest | null> {
  if (!webModelPromise) {
    webModelPromise = fetch(`${import.meta.env.BASE_URL}renders/web-glb-manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<WebModelManifest>) : null))
      .catch(() => null)
  }
  return webModelPromise
}

/** undefined while loading, null when unavailable (both mean: image crop). */
export function useWebModelManifest(): WebModelManifest | null | undefined {
  const [manifest, setManifest] = useState<WebModelManifest | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void fetchWebModelManifest().then((m) => {
      if (active) setManifest(m)
    })
    return () => {
      active = false
    }
  }, [])
  return manifest
}

/**
 * The web GLB for a part, or null — and null means "image crop, exactly as
 * today". A part not flagged `realCad` never gets a canvas: its renders are
 * placeholder art, and live geometry would contradict them (or worse, present
 * placeholder geometry as the product).
 */
export function webModelFor(
  manifest: WebModelManifest | null | undefined,
  part: CatalogPart | undefined,
): WebModelEntry | null {
  if (!manifest || !part) return null
  if (!part.realCad) return null
  return manifest.models[part.id] ?? null
}
