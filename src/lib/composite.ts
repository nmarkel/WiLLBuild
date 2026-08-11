import type { Catalog, CatalogPart, PartSlot, PoleConfig } from '../types'
import { armAzimuths, attachSocket, bannerMinFt, finishFor, partById, placeableAccessoryCodes, poleAccessoryLabel } from './compat'
import { bannerLayerOriginM } from './banner'

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
 * The canonical full-assembly VIEW yaws.
 *
 * Phase 0.11 (Workstream E) cut 0.10.5's 8-position 45° orbit down to 2 views
 * 180° apart. Merging Tyler's 0.10.5_TO viewer pass restores the 90° view as a
 * third, per Nick's call on 8/11: his carousel offers Assembly 0°/90°/180°, and
 * a 90° profile is the one that shows arm reach, which neither 0° nor 180° does
 * on a single-arm build.
 *
 * This costs NO new render assets, which is why it was cheap to accept — see
 * RENDER_AZIMUTHS below: adding 90 to this set leaves the required azimuth set
 * unchanged at {0,90,180,270}, because every member is still a multiple of 90.
 *
 * Do not confuse this with the RENDER azimuth set below. This is what the
 * customer can rotate the whole assembly to; that is what each part must be
 * drawn at so a radial cluster composites correctly inside one of these views.
 */
export const ASSEMBLY_VIEW_YAWS = [0, 90, 180] as const

/**
 * The azimuths every radial part (arm, fixture, banner) must be rendered at.
 *
 * Four, not two, and that is not a contradiction of the 2-view decision: a quad
 * arm cluster shows arms pointing four different ways *within a single view*.
 * The requirement is the set of `(armAzimuth + armOrientation − viewYaw) mod
 * 360` over armAzimuths ⊆ {0,90,180,270}, armOrientation ∈ {0,90,180,270} and
 * viewYaw ∈ ASSEMBLY_VIEW_YAWS — which is exactly {0,90,180,270}. That holds
 * for ANY ASSEMBLY_VIEW_YAWS whose members are multiples of 90, which is why
 * adding the 90° view in 0.11 needed no re-render (asserted in composite.test).
 *
 * 0.10.5's 45° members (az45/az135/az225/az315) are retired: no view and no
 * arrangement can now request them. Keep this in step with `COMPASS` in
 * scripts/render-rig/generate.mjs and in src/lib/composite.coverage.test.ts.
 */
export const RENDER_AZIMUTHS = [0, 90, 180, 270] as const

/** Every manifest angle key the render set must provide, in canonical order. */
export const RENDER_ANGLE_KEYS = ['hero', 'az90', 'az180', 'az270'] as const

/**
 * Snap an arbitrary yaw to the nearest canonical full-assembly view.
 *
 * Nearest by CIRCULAR distance over ASSEMBLY_VIEW_YAWS, so this stays correct
 * if the view set changes again rather than hard-coding hemisphere boundaries
 * (which is what it did while the set was exactly {0,180}). Ties resolve to the
 * earlier view in canonical order — only reachable for 270°, which no carousel
 * preset produces; it exists so a hand-edited or stale value can't wedge the
 * viewer on an azimuth with no view.
 */
export function snapAssemblyYaw(deg: number): number {
  const d = ((deg % 360) + 360) % 360
  let best: number = ASSEMBLY_VIEW_YAWS[0]
  let bestDist = Infinity
  for (const yaw of ASSEMBLY_VIEW_YAWS) {
    const raw = Math.abs(d - yaw)
    const dist = Math.min(raw, 360 - raw)
    if (dist < bestDist) {
      bestDist = dist
      best = yaw
    }
  }
  return best
}

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
  /**
   * Phase 0.11 (Workstream E): which assembly slot this layer belongs to, so a
   * focus view can frame one component without re-deriving it from the layer
   * id (which is decorated with `#i` / `@code` suffixes).
   */
  slot: PartSlot
}

/** A pixel rectangle inside a `CompositeLayout`. */
export interface LayoutBox {
  left: number
  top: number
  width: number
  height: number
}

export interface CompositeLayout {
  layers: PlacedLayer[]
  width: number
  height: number
  /** Pixel position of the world origin (pole base, ground line) inside the box. */
  origin: [number, number]
  /** Part ids in the config that have no render asset (→ fallback UI). */
  missing: string[]
  /**
   * The view yaw actually applied — the request snapped to the coarsest step
   * every rotating part renders (overlays like the compass must use this).
   */
  appliedViewYaw?: number
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
   * Phase 0.11 (Workstream E): which of the two canonical full-assembly views
   * to compose — 0 (front) or 180 (back). Rotating the view by θ shows each
   * radial part at azimuth (a − θ); poles/base covers are rotationally
   * symmetric so their hero renders serve every view. Any other value snaps to
   * the nearer of the two (see `snapAssemblyYaw`).
   */
  viewYaw: number = 0,
): CompositeLayout {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  // The assembly rotates as ONE object, so the yaw is snapped globally rather
  // than per part — per-part snapping would rotate parts by different amounts
  // and shear the assembly apart.
  //
  // 0.10.5 chose the step from what the parts could render (`supports45`), which
  // silently degraded the whole rotation to 90° whenever any one part lacked
  // `az45`. That failure mode is gone by construction: the view set is now a
  // fixed pair, and the coverage gate (composite.coverage.test.ts) proves every
  // part carries every angle either view can ask for. A part that somehow lacks
  // one is a coverage bug to fix, not something to silently degrade around.
  viewYaw = snapAssemblyYaw(viewYaw)

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
    // The pole rotates with the view too — its hand-hole cover marks the 0°
    // homing reference (real-render poles without a compass snap to nearest).
    const poleAngle = angleKeyForAzimuth((((0 - viewYaw) % 360) + 360) % 360)
    placements.push({ layerId: pole.id, part: pole, angle: poleAngle, world: [0, 0, 0], z: SLOT_Z.pole })
    if (baseCover) {
      const s = attachSocket(baseCover, pole)
      if (s)
        placements.push({ layerId: baseCover.id, part: baseCover, angle: HERO_ANGLE, world: s.position, z: SLOT_Z.baseCover })
    }
    if (arm) {
      const armSocket = attachSocket(arm, pole)
      if (armSocket) {
        const count = Math.max(1, Math.floor(config.armCount ?? 1))
        // Phase 0.10.5: orientation rotates the whole arrangement about the pole
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
        // Phase 0.11 (Workstream D): heightFt now measures to the BOTTOM of the
        // banner, so the layer origin is offset by the placeholder's own
        // origin→panel-bottom distance (read from the catalog, never hardcoded).
        const heightM = bannerLayerOriginM(bannerPart, config.banner.heightFt)
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
    // Phase 0.10.5: banner-arm KIT accessories (BA24/BA30) render the brand's
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
          // Same bottom reference as the legacy path above. The fallback tracks
          // the pole-height-dependent floor (10 ft on a 25 ft pole) rather than
          // the old hardcoded 8.
          const heightM = bannerLayerOriginM(
            bannerPart,
            placement?.heightFt ?? bannerMinFt(partById(catalog, config.pole)?.heightFt ?? 20),
          )
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
    // Phase 0.10.5: each part renders in its own step's finish (base finish when
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
      slot: part.slot,
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
    appliedViewYaw: viewYaw,
  }
  if (lightWorlds.length && !missing.length) {
    const lightPxs = lightWorlds.map((w) => pointInLayout(layout, manifest, w))
    layout.lightPxs = lightPxs
    layout.lightPx = lightPxs[0]
  }
  return layout
}

/**
 * Phase 0.11 (Workstream E) — the component focus views.
 *
 * Tyler's "2 180° views, then focuses": the second half. `'assembly'` is the
 * whole composited product; the other three frame one component tightly.
 * A config without that component (a post-top with no arm) simply has no
 * focus for it — `focusBox` returns undefined and the caller omits the view.
 */
export const FOCUS_TARGETS = [
  'assembly',
  'fixture',
  'arm',
  'baseCover',
  'poleTop',
  'poleBottom',
] as const
export type FocusTarget = (typeof FOCUS_TARGETS)[number]

export const FOCUS_LABELS: Record<FocusTarget, string> = {
  assembly: 'Full assembly',
  fixture: 'Fixture',
  arm: 'Arm',
  baseCover: 'Base',
  poleTop: 'Pole Top',
  poleBottom: 'Pole Bottom',
}

/**
 * The composite focus regions Tyler's 0.10.5_TO carousel names, expressed as
 * unions of the single-slot boxes above.
 *
 * Tyler framed these with two constants — `zoom: 2.6` and "centre 0.8 m above
 * the foot". Both are guesses that hold only for the pole heights he had open:
 * on a 25 ft pole 0.8 m is a fifth of the way up nothing in particular, and a
 * fixed 2.6× frames a CL1 clamshell and an SC2 spun collar at very different
 * sizes. Deriving each region from the layer boxes that are actually composited
 * makes the framing correct at every height, and reuses the padding and
 * fill-fraction logic the single-slot focuses already had.
 *
 * "Pole Top" is the fixture + arm cluster rather than the pole's own upper end:
 * what a customer inspects up there is the light and how it reaches, and on a
 * post-top with no arm it correctly degrades to just the fixture.
 */
const FOCUS_UNIONS: Record<'poleTop' | 'poleBottom', PartSlot[]> = {
  poleTop: ['fixture', 'arm'],
  poleBottom: ['baseCover'],
}

/**
 * Breathing room around a focused component, as a fraction of its own larger
 * dimension. Enough that the component is not cropped to its silhouette and
 * you can see what it attaches to, without zooming so far out that it stops
 * being a focus shot.
 */
const FOCUS_PAD_FRAC = 0.28
/** Floor for the above, in layout pixels — small parts still need real margin. */
const FOCUS_PAD_MIN_PX = 40

/**
 * The pixel rectangle a focus view should frame, inside `layout`'s own box.
 *
 * Deliberately a *framing* over the existing composited layers rather than a
 * new set of rendered assets. The rig alpha-crops every part individually at a
 * fixed `pxPerMeter`, so a "tighter framing" of one part would re-render the
 * identical image — a focus is a camera concern, not an asset concern. The
 * trade-off is resolution: framing a 0.75 m fixture from a 6 m assembly
 * upscales its ~270 px of render, so a focus view is softer than the full
 * assembly view. Fixing that would need a second, higher-`pxPerMeter` matrix
 * for the focusable parts — noted in the 0.11 execution response as an open
 * call, not silently assumed.
 *
 * Returns undefined when the layout has no layer for that component — the
 * caller then omits that view rather than offering a dead one.
 */
export function focusBox(layout: CompositeLayout, target: FocusTarget): LayoutBox | undefined {
  if (layout.layers.length === 0) return undefined
  if (target === 'assembly') {
    return { left: 0, top: 0, width: layout.width, height: layout.height }
  }
  // Composite regions (Pole Top / Pole Bottom) union several slots; the rest
  // are a single slot. Either way the box comes from real composited layers.
  const slots: PartSlot[] =
    target in FOCUS_UNIONS
      ? FOCUS_UNIONS[target as 'poleTop' | 'poleBottom']
      : [target as PartSlot]
  const layers = layout.layers.filter((l) => slots.includes(l.slot))
  if (layers.length === 0) return undefined

  const left = Math.min(...layers.map((l) => l.left))
  const top = Math.min(...layers.map((l) => l.top))
  const right = Math.max(...layers.map((l) => l.left + l.asset.width))
  const bottom = Math.max(...layers.map((l) => l.top + l.asset.height))

  const pad = Math.max(FOCUS_PAD_MIN_PX, FOCUS_PAD_FRAC * Math.max(right - left, bottom - top))
  // Clamp to the assembly box: a focus never frames empty space outside the
  // product, which would make the component look off-centre.
  const l = Math.max(0, left - pad)
  const t = Math.max(0, top - pad)
  const r = Math.min(layout.width, right + pad)
  const b = Math.min(layout.height, bottom + pad)
  return { left: l, top: t, width: r - l, height: b - t }
}

/** The focus views available for a layout, in canonical order (absent parts omitted). */
export function availableFocusTargets(layout: CompositeLayout): FocusTarget[] {
  return FOCUS_TARGETS.filter((t) => focusBox(layout, t) !== undefined)
}

/**
 * The viewer's named view presets — Tyler's 0.10.5_TO carousel, as data.
 *
 * A view is exactly a (yaw, focus) pair, so the carousel needs no state of its
 * own: the current preset is derived by matching the store's `viewYaw`/`focus`
 * against this list. That is deliberate. Tyler's version held a `viewIdx`
 * alongside them, which is a third copy of the same fact and desynced as soon
 * as anything else moved the camera — his own `onSlotClick` callouts and 0.11's
 * "configuring this part frames it" coupling both do exactly that, leaving the
 * headline naming a view the viewer was no longer showing.
 *
 * Kept in this module rather than the component so the coverage and unit tests
 * assert against the same list the UI renders.
 */
export interface AssemblyView {
  id: string
  label: string
  yaw: number
  focus: FocusTarget
}

export const ASSEMBLY_VIEWS: readonly AssemblyView[] = [
  { id: 'front', label: 'Assembly (0°)', yaw: 0, focus: 'assembly' },
  { id: 'profile', label: 'Assembly (90°)', yaw: 90, focus: 'assembly' },
  { id: 'back', label: 'Assembly (180°)', yaw: 180, focus: 'assembly' },
  { id: 'top', label: 'Pole Top', yaw: 0, focus: 'poleTop' },
  { id: 'bottom', label: 'Pole Bottom', yaw: 0, focus: 'poleBottom' },
] as const

/**
 * The presets offered for a layout: a focus view whose component this config
 * doesn't have is dropped rather than shown as a dead carousel stop (NAFCO has
 * no base covers, so those builds have no Pole Bottom).
 */
export function availableViews(layout: CompositeLayout): AssemblyView[] {
  return ASSEMBLY_VIEWS.filter((v) => focusBox(layout, v.focus) !== undefined)
}

/**
 * Which preset the current camera state corresponds to, or -1 when the customer
 * has zoomed/panned away from all of them. Matching on (yaw, focus) is what
 * lets the carousel headline stay truthful without storing an index.
 */
export function currentViewIndex(views: readonly AssemblyView[], viewYaw: number, focus: FocusTarget): number {
  const yaw = snapAssemblyYaw(viewYaw)
  return views.findIndex((v) => v.focus === focus && (focus !== 'assembly' || v.yaw === yaw))
}
