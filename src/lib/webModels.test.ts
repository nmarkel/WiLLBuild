import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

// ---------------------------------------------------------------------------
// The Workstream B IP gate. A web GLB is a shipped, extractable 3D asset, so
// every entry must be provably the exterior-shell, decimated artifact the
// pipeline measured — and every real-CAD fixture/arm must be accounted for:
// registered, or held with a written reason. Nothing is silently tolerated.
// ---------------------------------------------------------------------------
interface ShellReportEntry {
  sourceGlb: string
  sourceSha256: string
  masterTris: number
  culledTris: number
  shippedTris: number
  visibleFrac: number
  visibleAreaFrac: number
  bytes: number
  sha256: string
  materials: string[]
}

/** Mirrors VIS_MIN / MAX_SHIP_RATIO in scripts/web-glb/build.mjs. */
const SHELL_AREA_MIN = 0.95
const MAX_SHIP_RATIO = 0.5

describe('web-GLB IP gate (0.15 B)', () => {
  const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
  const shipped: WebModelManifest = JSON.parse(
    readFileSync('public/renders/web-glb-manifest.json', 'utf-8'),
  )
  const report: { parts: Record<string, ShellReportEntry> } = JSON.parse(
    readFileSync('scripts/web-glb/shell-report.json', 'utf-8'),
  )
  const holds: Record<string, string> = JSON.parse(
    readFileSync('scripts/web-glb/holds.json', 'utf-8'),
  )
  const rigRegistry: Record<string, string | { glb: string; rotateY?: number }> = JSON.parse(
    readFileSync('scripts/render-rig/real-parts.json', 'utf-8'),
  )

  const population = catalog.parts.filter(
    (p) =>
      p.realCad && !p.pseudoPart && (LIVE_FOCUS_SLOTS as readonly string[]).includes(p.slot),
  )

  it('every real-CAD fixture/arm is registered or explicitly held — never silently missing', () => {
    for (const part of population) {
      const registered = part.id in shipped.models
      const held = part.id in holds
      expect(
        registered || held,
        `${part.id}: real-CAD ${part.slot} with neither a web GLB nor a hold — a silent gap the 0.15 gate forbids`,
      ).toBe(true)
      expect(registered && held, `${part.id}: both registered AND held — pick one`).toBe(false)
    }
  })

  it('holds carry written reasons and refer only to real parts', () => {
    for (const [partId, reason] of Object.entries(holds)) {
      expect(typeof reason === 'string' && reason.trim().length > 0, `${partId}: hold without a reason`).toBe(true)
      expect(
        population.some((p) => p.id === partId),
        `${partId}: stale hold — not a real-CAD fixture/arm any more`,
      ).toBe(true)
    }
  })

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

  it('every file exists, hash-matches the shell report, and is within the web budget', () => {
    for (const [partId, entry] of Object.entries(shipped.models)) {
      const buf = readFileSync(`public/${entry.file}`)
      expect(buf.length, `${partId}: recorded bytes drifted from the file on disk`).toBe(entry.bytes)
      expect(buf.length, `${partId}: over the ≤3 MB web budget`).toBeLessThanOrEqual(WEB_GLB_BUDGET_BYTES)
      const sha = createHash('sha256').update(buf).digest('hex')
      expect(sha, `${partId}: file on disk is not the file the registry recorded`).toBe(entry.sha256)
      const rep = report.parts[partId]
      expect(rep, `${partId}: registered with no shell report — the gate cannot vouch for it`).toBeDefined()
      expect(sha, `${partId}: file on disk is not the file the shell check measured (stale report)`).toBe(
        rep.sha256,
      )
    }
  })

  it('every shipped GLB passed the shell-only check: exterior area, lossy tessellation', () => {
    for (const partId of Object.keys(shipped.models)) {
      const rep = report.parts[partId]
      expect(
        rep.visibleAreaFrac,
        `${partId}: ${(rep.visibleAreaFrac * 100).toFixed(1)}% of shipped surface area is visible — interior geometry is reaching the browser`,
      ).toBeGreaterThanOrEqual(SHELL_AREA_MIN)
      expect(
        rep.shippedTris,
        `${partId}: ships ${rep.shippedTris} of ${rep.masterTris} master triangles — not lossy enough to be non-manufacturable`,
      ).toBeLessThanOrEqual(rep.masterTris * MAX_SHIP_RATIO)
      expect(
        rep.materials.some((m) => m === 'will-body' || m === ''),
        `${partId}: no paintable material survived extraction — live tinting would be dead`,
      ).toBe(true)
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
