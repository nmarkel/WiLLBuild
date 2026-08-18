import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import type { Catalog, CatalogPart } from '../types'
import {
  LIVE_FOCUS_SLOTS,
  WEB_GLB_BUDGET_BYTES,
  webModelFor,
  type WebModelManifest,
} from './webModels'

const manifest: WebModelManifest = {
  version: 1,
  models: {
    'sh1-shepherds-hook': { file: 'renders/web-glb/sh1-shepherds-hook.glb', bytes: 100, rotateYDeg: -90 },
    'drx-post-top': { file: 'renders/web-glb/drx-post-top.glb', bytes: 100 },
  },
}

const realArm = { id: 'sh1-shepherds-hook', slot: 'arm', realCad: true } as CatalogPart
const placeholderArm = { id: 'sh1-shepherds-hook', slot: 'arm' } as CatalogPart

describe('webModelFor', () => {
  it('returns the entry for a real-CAD part with a web GLB', () => {
    const entry = webModelFor(manifest, realArm)
    expect(entry?.file).toBe('renders/web-glb/sh1-shepherds-hook.glb')
  })

  it('never returns a canvas for a placeholder part, even if the manifest lists it', () => {
    // The structural half of the fallback rule: a part whose renders are
    // placeholder art must not present live geometry that contradicts them.
    expect(webModelFor(manifest, placeholderArm)).toBeNull()
  })

  it('returns null when the part has no web GLB entry', () => {
    const other = { id: 'gvx-pendant', slot: 'fixture', realCad: true } as CatalogPart
    expect(webModelFor(manifest, other)).toBeNull()
  })

  it('returns null for a missing manifest or missing part', () => {
    expect(webModelFor(null, realArm)).toBeNull()
    expect(webModelFor(undefined, realArm)).toBeNull()
    expect(webModelFor(manifest, undefined)).toBeNull()
  })
})

// The shipped registry itself — a mini-gate until Workstream B builds the real
// shell-extraction pipeline + gate. Every listed model must point at a real
// file, within the web budget, for a real-CAD fixture/arm that exists.
describe('shipped web-GLB manifest', () => {
  const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
  const shipped: WebModelManifest = JSON.parse(
    readFileSync('public/renders/web-glb-manifest.json', 'utf-8'),
  )
  const rigRegistry: Record<string, string | { glb: string; rotateY?: number }> = JSON.parse(
    readFileSync('scripts/render-rig/real-parts.json', 'utf-8'),
  )

  it('lists only real-CAD, non-pseudo fixture/arm parts that exist in the catalog', () => {
    for (const [partId, entry] of Object.entries(shipped.models)) {
      const part = catalog.parts.find((p) => p.id === partId)
      expect(part, `${partId}: not in catalog`).toBeDefined()
      expect(part!.realCad, `${partId}: not real-CAD — web GLB would lie about the geometry`).toBe(true)
      expect(part!.pseudoPart ?? false, `${partId}: pseudo-part`).toBe(false)
      expect(
        (LIVE_FOCUS_SLOTS as readonly string[]).includes(part!.slot),
        `${partId}: slot ${part!.slot} has no live focus (0.15 scope: fixtures + arms only)`,
      ).toBe(true)
      expect(entry.file.startsWith('renders/web-glb/'), `${partId}: file outside web-glb dir`).toBe(true)
    }
  })

  it('every file exists, matches its recorded byte size, and is within the web budget', () => {
    for (const [partId, entry] of Object.entries(shipped.models)) {
      const stat = statSync(`public/${entry.file}`)
      expect(stat.size, `${partId}: recorded bytes drifted from the file on disk`).toBe(entry.bytes)
      expect(stat.size, `${partId}: over the ≤3 MB web budget`).toBeLessThanOrEqual(WEB_GLB_BUDGET_BYTES)
    }
  })

  it('rotateYDeg agrees with the render rig registry — the live model and the WebP must face the same way', () => {
    for (const [partId, entry] of Object.entries(shipped.models)) {
      const rig = rigRegistry[partId]
      const rigRotate = typeof rig === 'object' ? (rig.rotateY ?? 0) : 0
      expect(entry.rotateYDeg ?? 0, `${partId}: rotateYDeg disagrees with real-parts.json`).toBe(rigRotate)
    }
  })
})
