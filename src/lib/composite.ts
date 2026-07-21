import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { attachSocket, partById } from './compat'

/** One rendered layer/product image produced by the render rig. */
export interface RenderAsset {
  file: string
  width: number
  height: number
  /** Pixel inside the image where the part's origin projects (x right, y down). */
  anchor: [number, number]
}

export interface RenderManifest {
  rig: {
    version: number
    pxPerMeter: number
    azimuthDeg: number
    elevationDeg: number
    /** 2×3 linear map: world offset (m) → pixel offset (x right, y down). */
    worldToImage: [[number, number, number], [number, number, number]]
    /** Vertical pixels per world meter — sizes overlays (human silhouette, glows). */
    pxPerMeterY: number
  }
  parts: Record<string, { angles: Record<string, { finishes: Record<string, RenderAsset> }> }>
}

export const HERO_ANGLE = 'hero'

/** Draw order for assembly layers (base cover covers the pole root, fixture tops the arm). */
export const SLOT_Z = { pole: 1, baseCover: 2, arm: 3, fixture: 4 } as const

export interface PlacedLayer {
  partId: string
  asset: RenderAsset
  left: number
  top: number
  z: number
}

export interface CompositeLayout {
  layers: PlacedLayer[]
  width: number
  height: number
  /** Pixel position of the world origin (pole base, ground line) inside the box. */
  origin: [number, number]
  /** Part ids in the config that have no render asset (→ fallback UI). */
  missing: string[]
  /** Pixel position of the fixture's light source (night glow), when known. */
  lightPx?: [number, number]
}

/** Project a world-space offset (meters, +Y up) to a pixel offset via the rig map. */
export function projectOffset(
  manifest: RenderManifest,
  offset: [number, number, number],
): [number, number] {
  const [r0, r1] = manifest.rig.worldToImage
  return [
    r0[0] * offset[0] + r0[1] * offset[1] + r0[2] * offset[2],
    r1[0] * offset[0] + r1[1] * offset[1] + r1[2] * offset[2],
  ]
}

/** Pixel position of a world offset inside a normalized layout box. */
export function pointInLayout(
  layout: CompositeLayout,
  manifest: RenderManifest,
  offset: [number, number, number],
): [number, number] {
  const p = projectOffset(manifest, offset)
  return [layout.origin[0] + p[0], layout.origin[1] + p[1]]
}

/**
 * The render for a part in a finish: exact finish first, then any available
 * finish (covers future partial finish sets from the real render rig).
 */
export function resolveRenderAsset(
  manifest: RenderManifest,
  partId: string,
  finishId: string,
  angle: string = HERO_ANGLE,
): RenderAsset | undefined {
  const finishes = manifest.parts[partId]?.angles[angle]?.finishes
  if (!finishes) return undefined
  return finishes[finishId] ?? Object.values(finishes)[0]
}

/**
 * Compose the current config into positioned image layers. World offsets come
 * from catalog socket data (attachSocket) — the same walk Assembly.tsx did in
 * 3D — projected through the rig's linear map, so layers align by construction.
 */
export function resolveAssemblyLayout(
  catalog: Catalog,
  manifest: RenderManifest,
  config: PoleConfig,
): CompositeLayout {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  const placements: { part: CatalogPart; world: [number, number, number]; z: number }[] = []
  let lightWorld: [number, number, number] | undefined

  if (pole) {
    placements.push({ part: pole, world: [0, 0, 0], z: SLOT_Z.pole })
    if (baseCover) {
      const s = attachSocket(baseCover, pole)
      if (s) placements.push({ part: baseCover, world: s.position, z: SLOT_Z.baseCover })
    }
    if (arm) {
      const armSocket = attachSocket(arm, pole)
      if (armSocket) {
        placements.push({ part: arm, world: armSocket.position, z: SLOT_Z.arm })
        if (fixture) {
          const fixSocket = attachSocket(fixture, arm)
          if (fixSocket) {
            const world: [number, number, number] = [
              armSocket.position[0] + fixSocket.position[0],
              armSocket.position[1] + fixSocket.position[1],
              armSocket.position[2] + fixSocket.position[2],
            ]
            placements.push({ part: fixture, world, z: SLOT_Z.fixture })
            if (fixture.lightOffset) {
              lightWorld = [
                world[0] + fixture.lightOffset[0],
                world[1] + fixture.lightOffset[1],
                world[2] + fixture.lightOffset[2],
              ]
            }
          }
        }
      }
    }
  }

  const missing: string[] = []
  const raw: PlacedLayer[] = []
  for (const { part, world, z } of placements) {
    const asset = resolveRenderAsset(manifest, part.id, config.finish)
    if (!asset) {
      missing.push(part.id)
      continue
    }
    const p = projectOffset(manifest, world)
    raw.push({
      partId: part.id,
      asset,
      left: p[0] - asset.anchor[0],
      top: p[1] - asset.anchor[1],
      z,
    })
  }

  if (raw.length === 0) {
    return { layers: [], width: 0, height: 0, origin: [0, 0], missing }
  }

  const minX = Math.min(...raw.map((l) => l.left))
  const minY = Math.min(...raw.map((l) => l.top))
  const maxX = Math.max(...raw.map((l) => l.left + l.asset.width))
  const maxY = Math.max(...raw.map((l) => l.top + l.asset.height))

  const layers = raw
    .map((l) => ({ ...l, left: l.left - minX, top: l.top - minY }))
    .sort((a, b) => a.z - b.z)
  // projectOffset(0,0,0) = (0,0), so the origin lands at (-minX, -minY).
  const origin: [number, number] = [-minX, -minY]
  const layout: CompositeLayout = {
    layers,
    width: maxX - minX,
    height: maxY - minY,
    origin,
    missing,
  }
  if (lightWorld && !missing.length) layout.lightPx = pointInLayout(layout, manifest, lightWorld)
  return layout
}
