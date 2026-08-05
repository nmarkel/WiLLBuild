import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { armAzimuths, attachSocket, finishFor, partById, placeableAccessoryCodes, poleAccessoryLabel } from './compat'

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

/**
 * Phase 0.8 (A): the non-hero azimuths (degrees) a radial arm/fixture must be
 * rendered at, beyond 0° (= hero). These are exactly the angles that appear
 * across twin(180)/triple(120,240)/quad(90,180,270), so the position render set
 * is bounded — the render rig bakes one silhouette per azimuth per finish.
 */
export const MULTI_ARM_AZIMUTHS = [90, 120, 180, 240, 270] as const

/** Manifest angle key for a radial azimuth: 0° reuses the existing hero render. */
export function angleKeyForAzimuth(deg: number): string {
  const d = ((deg % 360) + 360) % 360
  return d === 0 ? HERO_ANGLE : `az${d}`
}

/** Feet → meters, for banner shaft heights (viewer world is meters, +Y up). */
export const FT_TO_M = 0.3048

/** Rotate a world offset (meters) about the vertical (+Y) axis — matches the rig's `object.rotation.y`. */
export function rotateY(
  offset: readonly [number, number, number],
  deg: number,
): [number, number, number] {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const [x, y, z] = offset
  return [x * c + z * s, y, -x * s + z * c]
}

/**
 * Camera-space depth proxy for an arm reaching at azimuth `deg`, under the rig's
 * fixed view. Positive → the reach points toward the camera (draw the arm in
 * FRONT of the pole); negative → away (draw BEHIND). Only the sign and relative
 * ordering matter, so the constant cos(elevation) factor is dropped.
 */
export function armDepthProxy(rig: RenderManifest['rig'], deg: number): number {
  return Math.sin(((rig.azimuthDeg - deg) * Math.PI) / 180)
}

/** Draw order for assembly layers (base cover covers the pole root, fixture tops the arm). */
export const SLOT_Z = { pole: 1, baseCover: 2, arm: 3, fixture: 4 } as const

export interface PlacedLayer {
  /** Unique layer id (real part id for single instances; `${id}#${i}` per radial arm). */
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
  /** Pixel position of the primary fixture's light source (night glow), when known. */
  lightPx?: [number, number]
  /**
   * Every fixture's light-source pixel position (one per radial arm). Night mode
   * draws a glow/pool at each so a twin/triple/quad pole lights from all arms,
   * not just the first. `lightPx` is `lightPxs[0]` (kept for back-compat).
   */
  lightPxs?: [number, number][]
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

/** Degrees encoded by an angle key ('hero' = 0, 'azN' = N). */
function angleKeyDeg(key: string): number {
  return key === HERO_ANGLE ? 0 : Number(key.slice(2)) || 0
}

/**
 * The part's available angle key nearest (circularly) to the requested one —
 * exact when it exists. Covers parts whose render set predates a new angle
 * (real-design renders lack the 45° compass until re-rendered): a close angle
 * beats a missing layer.
 */
export function nearestAngleKey(
  manifest: RenderManifest,
  partId: string,
  angle: string,
): string {
  const angles = manifest.parts[partId]?.angles
  if (!angles || angles[angle]) return angle
  const wanted = angleKeyDeg(angle)
  let best = angle
  let bestDist = Infinity
  for (const key of Object.keys(angles)) {
    const dist = Math.abs((((angleKeyDeg(key) - wanted) % 360) + 540) % 360 - 180)
    if (dist < bestDist) {
      bestDist = dist
      best = key
    }
  }
  return best
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
  /**
   * Phase 1.0: assembly view rotation in degrees (45° steps). Rotating the
   * view by θ shows each radial part at azimuth (a − θ); poles/base covers
   * are rotationally symmetric so their hero renders serve every view.
   */
  viewYaw: number = 0,
): CompositeLayout {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  // A placement carries a unique layer id, the real part (for missing-render
  // reporting), the render angle key, and the world offset. armCount=1 produces
  // exactly the pre-0.8 single-arm placements (hero angle, real part ids).
  interface Placement {
    layerId: string
    part: CatalogPart
    angle: string
    world: [number, number, number]
    z: number
  }
  const placements: Placement[] = []
  const lightWorlds: [number, number, number][] = []

  if (pole) {
    placements.push({ layerId: pole.id, part: pole, angle: HERO_ANGLE, world: [0, 0, 0], z: SLOT_Z.pole })
    if (baseCover) {
      const s = attachSocket(baseCover, pole)
      if (s)
        placements.push({ layerId: baseCover.id, part: baseCover, angle: HERO_ANGLE, world: s.position, z: SLOT_Z.baseCover })
    }
    if (arm) {
      const armSocket = attachSocket(arm, pole)
      if (armSocket) {
        const count = Math.max(1, Math.floor(config.armCount ?? 1))
        // Phase 1.0: orientation rotates the whole arrangement about the pole
        // (0/90/180/270) and the view rotation subtracts on top — each arm
        // just shifts to the matching azimuth render.
        const orientation = config.armOrientation ?? 0
        const azimuths = armAzimuths(count).map((a) => (((a + orientation - viewYaw) % 360) + 360) % 360)
        const fixSocket = fixture ? attachSocket(fixture, arm) : undefined
        azimuths.forEach((rawDeg, i) => {
          const single = count === 1
          // Snap the arm's GEOMETRY to the angle it can actually render:
          // position math and artwork must rotate together, or a real-render
          // arm (no 45° compass yet) draws at one angle while its fixture
          // hangs at another and the assembly visibly disconnects.
          const angle = nearestAngleKey(manifest, arm.id, angleKeyForAzimuth(rawDeg))
          const deg = angleKeyDeg(angle)
          // The arm mounts on the pole's vertical axis, so its origin is
          // rotation-invariant; the reach is baked into the per-azimuth render.
          const armWorld: [number, number, number] = [...armSocket.position]
          // The unrotated single arm keeps the historic fixed z-order; rotated
          // or radial arms z-sort by camera depth so ones reaching behind the
          // pole draw first.
          const armZ =
            single && deg === 0 ? SLOT_Z.arm : SLOT_Z.pole + armDepthProxy(manifest.rig, deg)
          placements.push({
            layerId: single ? arm.id : `${arm.id}#${i}`,
            part: arm,
            angle,
            world: armWorld,
            z: armZ,
          })
          if (fixture && fixSocket) {
            const rot = rotateY(fixSocket.position, deg)
            const world: [number, number, number] = [
              armWorld[0] + rot[0],
              armWorld[1] + rot[1],
              armWorld[2] + rot[2],
            ]
            placements.push({
              layerId: single ? fixture.id : `${fixture.id}#${i}`,
              part: fixture,
              angle,
              world,
              z: single && deg === 0 ? SLOT_Z.fixture : armZ + 0.001,
            })
            // Each radial fixture emits its own night glow (twin/triple/quad
            // all light up, not just the first arm).
            if (fixture.lightOffset) {
              lightWorlds.push([
                world[0] + fixture.lightOffset[0],
                world[1] + fixture.lightOffset[1],
                world[2] + fixture.lightOffset[2],
              ])
            }
          }
        })
      }
    }
    // Phase 0.8 (C): banner-arm accessory — a mid-shaft bracket set repeated on
    // `count` radial sides. Same positional machinery as arms (per-azimuth
    // renders + camera-depth z-order), only at a parametric shaft height rather
    // than the pole-top socket. The banner arm mounts on the pole axis and its
    // reach + placeholder panel are baked into the per-azimuth render.
    if (config.banner) {
      const bannerPart = partById(catalog, config.banner.armId)
      if (bannerPart) {
        const heightM = config.banner.heightFt * FT_TO_M
        const sides = armAzimuths(Math.max(1, Math.floor(config.banner.count))).map(
          (a) => (((a - viewYaw) % 360) + 360) % 360,
        )
        sides.forEach((deg, i) => {
          placements.push({
            layerId: `${bannerPart.id}#${i}`,
            part: bannerPart,
            angle: angleKeyForAzimuth(deg),
            world: [0, heightM, 0],
            z: SLOT_Z.pole + armDepthProxy(manifest.rig, deg),
          })
        })
      }
    }
    // Phase 1.0: banner-arm KIT accessories (BA24/BA30) render the brand's
    // banner part at their configured placement — the ordering code and the
    // visual are one selection now (the legacy config.banner path above stays
    // for brands still using the Banner Arm box).
    const kitCodes = placeableAccessoryCodes(catalog, config).filter((code) =>
      poleAccessoryLabel(catalog, config, code).includes('Banner Arm Kit'),
    )
    if (kitCodes.length > 0) {
      const bannerPart = catalog.parts.find((p) => p.slot === 'banner' && p.line === config.brand)
      if (bannerPart) {
        for (const code of kitCodes) {
          const placement = config.accessoryPlacements?.[code]
          const heightM = (placement?.heightFt ?? 8) * FT_TO_M
          const orientation = placement?.orientation ?? 0
          const azimuths = armAzimuths(Math.max(1, placement?.sides ?? 1)).map(
            (a) => (((a + orientation - viewYaw) % 360) + 360) % 360,
          )
          azimuths.forEach((deg, i) => {
            placements.push({
              layerId: `${bannerPart.id}@${code}#${i}`,
              part: bannerPart,
              angle: angleKeyForAzimuth(deg),
              world: [0, heightM, 0],
              z: SLOT_Z.pole + armDepthProxy(manifest.rig, deg),
            })
          })
        }
      }
    }
  }

  const missingSet = new Set<string>()
  const raw: PlacedLayer[] = []
  for (const { layerId, part, angle, world, z } of placements) {
    // Phase 1.0: each part renders in its own step's finish (base finish when
    // the slot has no override — see finishFor), at the nearest available
    // angle (exact for rig-rendered parts; real-render parts may lack the
    // 45° compass until re-rendered from their design files).
    const asset = resolveRenderAsset(
      manifest,
      part.id,
      finishFor(config, part.slot),
      nearestAngleKey(manifest, part.id, angle),
    )
    if (!asset) {
      missingSet.add(part.id)
      continue
    }
    const p = projectOffset(manifest, world)
    raw.push({
      partId: layerId,
      asset,
      left: p[0] - asset.anchor[0],
      top: p[1] - asset.anchor[1],
      z,
    })
  }
  const missing = [...missingSet]

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
  if (lightWorlds.length && !missing.length) {
    const lightPxs = lightWorlds.map((w) => pointInLayout(layout, manifest, w))
    layout.lightPxs = lightPxs
    layout.lightPx = lightPxs[0]
  }
  return layout
}
