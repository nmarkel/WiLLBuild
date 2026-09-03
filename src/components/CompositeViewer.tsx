import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Catalog, PoleConfig, Slot } from '../types'
import type { SceneMode } from '../store'
import { useConfigurator } from '../store'
import {
  availableViews,
  currentViewIndex,
  focusBox,
  isGrounded,
  resolveAssemblyLayout,
  pointInLayout,
  projectOffset,
  rotateY,
  wallPlane,
  type FocusTarget,
} from '../lib/composite'
import { assemblyModeFor, compatibleParts, finishFor, partById, specCodes } from '../lib/compat'
import { armArrangementLabel, buildPartNumber } from '../lib/summary'
import { displayArmName, displayPartName } from '../lib/display'
import { clampPan, focusFrame, zoomStep, type PanClampOpts } from '../lib/viewerTransform'
import { useWheelZoom } from '../lib/wheelZoom'
import { useRenderManifest, renderUrl } from '../lib/renders'
import {
  compositeToBlob,
  groundAspect,
  groundToStage,
  nightLight,
  snapshotAnchors,
  SNAPSHOT_HEIGHT,
  SNAPSHOT_WIDTH,
} from '../lib/snapshot'
import { colorTempCode, distributionCode, lightRgba } from '../lib/distribution'
import { RenderFallback } from './RenderFallback'
import { sceneBackdrop } from './ScenePicker'
import type { Scene } from '../lib/url'

interface Props {
  catalog: Catalog
  config: PoleConfig
  showScale: boolean
  showCompass: boolean
  mode: SceneMode
  scene: Scene
  /** Tesla-style part callouts: when provided, each slot's layer gets a
      labeled leader-line hotspot; clicking reports the slot (the builder
      scrolls its rail section into view). Rendered only at fit zoom. */
  onSlotClick?: (slot: Slot) => void
}

/** Callout anchors: which side the label sits on and where the leader
    attaches. Sides alternate so labels never stack; vertical spread comes from
    the parts themselves (fixture top, arm upper, pole mid, base cover bottom).

    `at: 'mount'` pins the leader on the part's own PLACEMENT point — the pixel
    the manifest records as its origin — instead of its bounding-box centre.
    Phase 0.17 (Tyler 8/20): "the arm pointer should pin on the hub of the
    bracket, which will always be near the pole top". A shepherd's hook's box
    centre sits out in the curve; its placement point IS the pole-top collar,
    so this is exact for every arm shape (and stays right for a crossarm,
    whose `mountOffset` already lands its collar on the socket). */
const CALLOUT_DEFS: {
  slot: Slot
  label: string
  side: 'left' | 'right'
  anchorFrac: number
  at?: 'mount'
}[] = [
  { slot: 'fixture', label: 'Fixture', side: 'right', anchorFrac: 0.45 },
  { slot: 'arm', label: 'Arm', side: 'left', anchorFrac: 0.5, at: 'mount' },
  { slot: 'pole', label: 'Pole', side: 'right', anchorFrac: 0.55 },
  { slot: 'baseCover', label: 'Base Cover', side: 'left', anchorFrac: 0.5 },
]

/** Callouts show only near fit zoom — zoomed in is inspection mode. */
const CALLOUT_MAX_ZOOM = 1.05

/** Ground compass ring radius (meters) and label inset, world units. */
const COMPASS_R_M = 1.5
const COMPASS_LABEL_R_M = 1.85

/** Bundled scene photos share this crop (see public/scenes/SOURCES.md). */
const SCENE_IMG = { w: 1600, h: 1000 }
/**
 * Zoom has no on-screen +/- cluster any more: Tyler's 0.10.5_TO viewer pass
 * replaced it (and the rotate pair) with the view carousel, leaving wheel and
 * drag as the fine controls. The per-tick factor lives in lib/wheelZoom.ts
 * (`wheelZoomFactor`), so there is no local sensitivity constant here.
 *
 * TRADEOFF, flagged not hidden: dropping the buttons leaves no pointer-free
 * zoom affordance, so a keyboard-only user can reach the carousel presets (real
 * buttons) but not intermediate zoom levels. The presets cover the intended
 * inspection cases, which is why this ships, but it is a real accessibility
 * regression against 0.10.5 and the buttons are a one-component revert.
 */

/**
 * Shared horizon line for all three backdrop scenes, as a fraction of the
 * viewport height (base sits 80% down). Each scene photo is cropped so its
 * near, flat foreground ground plane falls across this fraction, and the
 * product's ground line (`layout.origin`, the assembly's foot) is pinned here
 * — so the pole base + contact shadow sit on the near foreground ground of
 * every backdrop (not floating back on the mid-ground) and ONE placement works
 * across all three. Standing-height photos put the near ground low in frame, so
 * this sits well below the vanishing horizon; keep it in the foreground band of
 * public/scenes/*.jpg.
 */
const HORIZON_FRAC = 0.8

/**
 * Ground-aware fit: leave breathing room around the pinned foot. Width is
 * measured from the foot to the widest side; vertical is split above/below the
 * horizon so a tall pole never clips off the top of the sky.
 */
const FIT_WIDTH_FRAC = 0.86
const FIT_UP_FRAC = 0.94 // of the sky space above the horizon
const FIT_DOWN_FRAC = 0.8 // of the ground space below the horizon

const HUMAN_HEIGHT_M = 1.83
const HUMAN_OFFSET: [number, number, number] = [1.4, 0, 0.6]

/** Ground shadow ellipse size in meters (width, height), converted via pxPerMeterY. */
const GROUND_SHADOW_M: [number, number] = [2.6, 0.6]

/**
 * Phase 0.17 (Tyler 8/19): a Custom-RAL layer, tinted live. The custom-ral
 * finish renders every part in a bright NEUTRAL, so multiplying it by the
 * customer's hex yields that color under the render's own baked lighting —
 * any color, zero extra render assets. Op sequence: draw → multiply fill →
 * destination-in redraw (restores the alpha the fill covered). Same math as
 * the snapshot's tint (snapshot.ts), so PNG and screen agree.
 */
function TintedLayer({
  file,
  tint,
  style,
}: {
  file: string
  tint: string
  style: CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled || !ref.current) return
      const c = ref.current
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(img, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
    img.src = renderUrl(file)
    return () => {
      cancelled = true
    }
  }, [file, tint])
  return <canvas ref={ref} className="composite-layer" style={style} aria-hidden="true" />
}

/**
 * Phase 0.17 (Tyler 8/19): the concise config facts a callout card shows for
 * its part of the assembly — part number, finish, and the slot's own axes.
 * Everything resolves from catalog data + config; nothing is hardcoded copy.
 */
function calloutFacts(
  catalog: Catalog,
  config: PoleConfig,
  slot: Slot,
): { label: string; value: string }[] {
  const part = partById(catalog, config[slot])
  if (!part) return []
  const facts: { label: string; value: string }[] = []
  const pn = buildPartNumber(catalog, config, slot)
  if (pn) facts.push({ label: 'Part No.', value: pn })
  const finishId = finishFor(config, slot)
  const finish = catalog.finishes.find((f) => f.id === finishId)
  if (finish) {
    const ral = config.finishRal?.[slot]
    facts.push({ label: 'Finish', value: ral ? `${finish.name} ${ral.toUpperCase()}` : finish.name })
  }
  if (slot === 'arm') {
    const count = config.armCount ?? 1
    if (count > 1) facts.push({ label: 'Arrangement', value: armArrangementLabel(count) })
    if (config.armOrientation) facts.push({ label: 'Orientation', value: `${config.armOrientation}°` })
  }
  if (slot === 'pole') {
    if (part.heightFt) facts.push({ label: 'Height', value: `${part.heightFt} ft` })
    const chosen = config.specOptions?.pole ?? {}
    const wall = specCodes(chosen['wall-thickness'])[0]
    if (wall) {
      const label = part.options
        ?.find((o) => o.key === 'wall-thickness')
        ?.values.find((v) => v.code === wall)?.label
      if (label) facts.push({ label: 'Wall', value: label })
    }
    const accessories = (part.options ?? [])
      .filter((o) => o.group === 'options-accessories')
      .flatMap((o) => specCodes(chosen[o.key]))
    if (accessories.length > 0) {
      facts.push({ label: 'Accessories', value: String(accessories.length) })
    }
  }
  if (slot === 'baseCover') {
    const poleDiameter = partById(catalog, config.pole)?.diameterIn
    if (poleDiameter) facts.push({ label: 'Pole fit', value: `${poleDiameter}R` })
    const chosen = config.specOptions?.baseCover ?? {}
    const codes = (part.options ?? [])
      .filter((o) => o.group === 'options-accessories')
      .flatMap((o) => specCodes(chosen[o.key]))
    if (codes.includes('CLE')) facts.push({ label: 'Extender', value: 'CLE' })
  }
  if (slot === 'fixture') {
    const chosen = config.specOptions?.fixture ?? {}
    for (const opt of (part.options ?? []).filter((o) => o.group === 'ordering')) {
      const code = specCodes(chosen[opt.key])[0]
      if (!code) continue
      const label = opt.values.find((v) => v.code === code)?.label
      if (label && facts.length < 6) facts.push({ label: opt.label, value: label })
    }
  }
  return facts.slice(0, 6)
}

// Plain-English slot names for the partial-build hint pill.
const SLOT_HINT_LABELS: Record<Slot, string> = {
  fixture: 'a fixture',
  arm: 'an arm',
  pole: 'a pole',
  baseCover: 'a base cover',
}

/**
 * Layered image-compositing assembly viewer — drop-in replacement for the R3F
 * <Scene>. Stacks the pre-rendered part images from the render manifest at
 * their catalog-socket-derived pixel positions, with pan/zoom, a night preset,
 * and an optional human-scale silhouette. Falls back to <RenderFallback>
 * (never a broken viewer, never the old 3D placeholder primitives) whenever
 * the manifest is unavailable or any part in the current config has no
 * render asset.
 */
export function CompositeViewer({ catalog, config, showScale, showCompass, mode, scene, onSlotClick }: Props) {
  const registerSnapshot = useConfigurator((s) => s.registerSnapshot)
  const setSnapshotAnchors = useConfigurator((s) => s.setSnapshotAnchors)
  // Phase 0.17 (Tyler 8/20): labels are toggleable from the viewer toolbar.
  const showLabels = useConfigurator((s) => s.showLabels)
  const viewYaw = useConfigurator((s) => s.viewYaw)
  const setViewYaw = useConfigurator((s) => s.setViewYaw)
  const focus = useConfigurator((s) => s.focus)
  const setFocus = useConfigurator((s) => s.setFocus)
  const customSceneUrl = useConfigurator((s) => s.customSceneUrl)
  // Phase 0.17 (Tyler 8/19): a callout OPENS into a config card for that part
  // of the assembly — not just a scroll shortcut. One open at a time.
  const [openCallout, setOpenCallout] = useState<Slot | null>(null)
  useEffect(() => {
    setOpenCallout(null)
  }, [config, viewYaw, showLabels])
  const manifest = useRenderManifest()
  const night = mode === 'night'
  // Phase 0.21: which assembly mode this build is in. Declared HERE, above
  // `horizonFrac`, because that memo reads it — a `const` used before its
  // declaration is a temporal-dead-zone throw at render, not a lint nit.
  // (`mode` is already this component's day/night prop, hence the longer name.)
  const assemblyMode = assemblyModeFor(catalog, config)

  const layout = useMemo(
    () => (manifest ? resolveAssemblyLayout(catalog, manifest, config, viewYaw) : null),
    [catalog, manifest, config, viewYaw],
  )

  // The interactive wrapper does NOT exist on the first commit: `manifest`
  // starts `undefined`, so the first render always returns the "Loading render…"
  // branch below and the wrapper only mounts once the manifest promise
  // resolves. Holding the node in STATE (rather than a `useRef` that effects
  // read once) makes that late arrival a real dependency: every effect that
  // needs the element lists `wrapperEl` and therefore re-runs when it appears.
  // A `useRef` + `useEffect(..., [])` here silently never attached — that is
  // how scroll-wheel zoom was dead from Phase 0.7 through 0.10.5.
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null)
  const [fitScale, setFitScale] = useState(1)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  // Phase 0.10.5: backdrops keep their aspect (object-fit: cover, bottom-anchored),
  // so the photo's ground line lands at a viewport-shape-dependent height —
  // compute where, and pin the product's foot there. Blank/custom scenes keep
  // the classic fraction.
  const horizonFrac = useMemo(() => {
    // Phase 0.21: a wall build has NO ground line. The fit below pins the
    // layout origin at the horizon and budgets the sky above it separately
    // from the ground below it — correct for a pole, whose origin IS where it
    // meets grade and which has nothing underneath. A wall unit hangs almost
    // entirely BELOW its origin (the mounting plate), so that split crushed it
    // into the bottom fifth of the frame at 0.6x while a pole filled it.
    //
    // Pinning the origin at the fraction of the box it actually sits at turns
    // the split budget into a plain box fit — sUp and sDown come out equal —
    // so the unit fills the frame and sits where its own geometry says. No
    // special case in the fit itself, and pole/ground builds are untouched.
    if (assemblyMode === 'wall' && layout && layout.height > 0) {
      return layout.origin[1] / layout.height
    }
    if (scene === 'blank' || scene === 'custom' || viewport.w <= 0 || viewport.h <= 0) {
      return HORIZON_FRAC
    }
    const cover = Math.max(viewport.w / SCENE_IMG.w, viewport.h / SCENE_IMG.h)
    return (viewport.h - SCENE_IMG.h * (1 - HORIZON_FRAC) * cover) / viewport.h
  }, [scene, viewport, assemblyMode, layout])
  const horizonFracRef = useRef(horizonFrac)
  horizonFracRef.current = horizonFrac
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  )
  /** Last pointer position seen during a drag — lets a mid-drag zoom rebase. */
  const lastPointerRef = useRef({ x: 0, y: 0 })
  // Mirrors `zoom` so several wheel ticks landing in one React batch each build
  // on the previous one instead of all reading the same rendered value.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // Raw pan + the clamp inputs, both mirrored into refs. Event handlers must be
  // able to ask "where is the product ACTUALLY on screen right now?" without
  // waiting for a render — several pointermoves (or a pointermove and the
  // pointerup that ends the gesture) can land in one React batch, and reading a
  // render-time cache there would silently throw away the last of the drag.
  const panRef = useRef(pan)
  panRef.current = pan
  // Zoom-INDEPENDENT clamp inputs only. The scale is recomputed per call from
  // the zoom being asked about, so a burst of +/- clicks (or wheel ticks) that
  // lands in one React batch clamps each step against that step's own bounds
  // instead of the last rendered zoom's — caching the whole PanClampOpts here
  // silently over-clamped every step after the first.
  // `clamp: false` on photo scenes, where the product is placed freely.
  const clampBaseRef = useRef<
    (Omit<PanClampOpts, 'zoom' | 'scale'> & { fitScale: number; clamp: boolean }) | null
  >(null)
  /**
   * Where the product actually is on screen right now — the clamped pan a drag
   * or a zoom step continues from, computed live rather than read from a cache.
   */
  const currentEffPan = useCallback((): { x: number; y: number } => {
    const b = clampBaseRef.current
    if (!b || !b.clamp) return panRef.current
    const z = zoomRef.current
    return clampPan(panRef.current, {
      zoom: z,
      scale: b.fitScale * z,
      box: b.box,
      viewport: b.viewport,
      horizonFrac: b.horizonFrac,
    })
  }, [])

  // Kept in a ref so the ResizeObserver callback below (subscribed once per
  // width/height pair) always reads the latest layout without re-subscribing
  // on every finish swap, which produces a new layout object at the same
  // dimensions.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Physical-assembly key (excludes finish) — matches Scene.tsx's CameraRig
  // convention: a finish swap shouldn't reset the view, only a part change.
  const assemblyKey = `${config.pole}-${config.arm}-${config.fixture}-${config.baseCover}-${config.armCount ?? 1}-${config.banner?.armId ?? ''}:${config.banner?.count ?? ''}:${config.banner?.heightFt ?? ''}`

  /**
   * The view carousel's presets for THIS config, and where the camera currently
   * sits in them. Both derived — see `ASSEMBLY_VIEWS` in lib/composite.ts for
   * why the index is not stored: (viewYaw, focus) already is the view, and a
   * separate `viewIdx` desyncs the moment a callout or the option rail moves the
   * camera. `viewIdx` is -1 when the customer has zoomed/panned off-preset.
   */
  // Phase 0.21: the mode can drop or rename a carousel stop — a wall unit's
  // 180° view is a view of a wall. Derived here rather than inside
  // availableViews so the pure function stays catalog-free.
  const layoutMode = assemblyModeFor(catalog, config)
  const views = useMemo(
    () => (layout ? availableViews(layout, layoutMode) : []),
    [layout, layoutMode],
  )
  const viewIdx = currentViewIndex(views, viewYaw, focus)

  /**
   * New assembly or scene swap → drop any accumulated zoom/pan so the next
   * framing is derived fresh rather than layered on a stale one.
   *
   * Deliberately resets the CAMERA ONLY — not `focus`, not `viewYaw`. Both of
   * those were reset here at first and it broke the option rail: picking a
   * fixture calls setFocus('poleTop') and also changes assemblyKey, so this
   * effect fired straight afterwards and yanked the view back to the full
   * assembly. The customer saw the headline flick to "Assembly (0°)" instead of
   * framing the part they just chose.
   *
   * Nothing is lost by leaving them alone: the focus effect below re-derives the
   * framing on the same assemblyKey change, and falls back to 'assembly' by
   * itself when the new config has no such component.
   */
  useEffect(() => {
    zoomRef.current = 1
    panRef.current = { x: 0, y: 0 }
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [assemblyKey, scene])

  /**
   * Step through the carousel. Falls in at the first preset when the camera is
   * currently off-preset, so ‹ › always does something predictable rather than
   * appearing dead after a manual zoom.
   */
  const cycleView = (dir: number) => {
    if (views.length === 0) return
    const from = viewIdx < 0 ? 0 : viewIdx
    const next = views[(from + dir + views.length) % views.length]
    setViewYaw(next.yaw)
    setFocus(next.focus)
  }

  // Ground-aware fit scale from the wrapper's live size. useLayoutEffect so the
  // first paint already has the right scale instead of flashing at scale 1.
  // Unlike a plain box-fit, this fits the product around its PINNED foot: the
  // foot sits at the shared horizon, so the sky space above it and the ground
  // space below it are different budgets and are constrained separately.
  useLayoutEffect(() => {
    const el = wrapperEl
    if (!el) return
    const compute = () => {
      const box = layoutRef.current
      const W = el.clientWidth
      const H = el.clientHeight
      setViewport({ w: W, h: H })
      if (!box || box.width === 0 || box.height === 0) return
      const [ox, oy] = box.origin
      const halfExtent = Math.max(ox, box.width - ox) // widest side from the foot
      const upExtent = oy // pixels above the ground line
      const downExtent = box.height - oy // pixels below the ground line
      const hf = horizonFracRef.current
      const sW = halfExtent > 0 ? ((W / 2) * FIT_WIDTH_FRAC) / halfExtent : Infinity
      const sUp = upExtent > 0 ? (H * hf * FIT_UP_FRAC) / upExtent : Infinity
      const sDown = downExtent > 1 ? (H * (1 - hf) * FIT_DOWN_FRAC) / downExtent : Infinity
      const scale = Math.min(sW, sUp, sDown)
      setFitScale(scale > 0 && Number.isFinite(scale) ? scale : 1)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [wrapperEl, layout?.width, layout?.height, horizonFrac])

  /**
   * Phase 0.11 (Workstream E): drive the camera to the focused component.
   *
   * Declared AFTER the assemblyKey reset above so it runs second on a commit
   * where both fire — changing the pole must not leave a stale fixture framing
   * for a frame, and must not have the reset undo the focus.
   *
   * The framing itself is pure (`focusFrame`), so it is unit-tested rather
   * than only observed in a browser. A focus whose component isn't in this
   * config (no arm on a post-top) falls back to the whole assembly instead of
   * leaving the viewer pointed at nothing.
   *
   * Returning to a full-assembly view re-grounds the product. That is load
   * bearing now that Tyler's carousel is the only view control: with the +/-
   * and Reset buttons gone, cycling Pole Bottom → Assembly (0°) would otherwise
   * leave the camera zoomed 3× into the foot with no way back. It is gated on
   * the focus actually CHANGING so a manual wheel/drag inside an assembly view
   * still survives the next unrelated re-render.
   */
  const prevFocusRef = useRef<FocusTarget | null>(null)
  useEffect(() => {
    if (!layout || viewport.w <= 0 || viewport.h <= 0) return
    const focusChanged = prevFocusRef.current !== focus
    prevFocusRef.current = focus
    if (focus === 'assembly') {
      if (focusChanged) {
        zoomRef.current = 1
        panRef.current = { x: 0, y: 0 }
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
      return
    }
    const target = focusBox(layout, focus)
    if (!target) {
      setFocus('assembly')
      return
    }
    const next = focusFrame(target, { fitScale, box: layout, viewport, horizonFrac })
    zoomRef.current = next.zoom
    panRef.current = next.pan
    setZoom(next.zoom)
    setPan(next.pan)
    // `layout` is intentionally read but not a dependency: it is a new object on
    // every finish swap, which would re-frame (and cancel a manual zoom) for a
    // change that cannot move a component. assemblyKey covers the changes that can.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, assemblyKey, viewYaw, fitScale, viewport.w, viewport.h, horizonFrac])

  /**
   * The one zoom transition, shared by the wheel and the +/- buttons.
   *
   * It reads the CLAMPED pan and writes the renormalised result back into
   * `pan`, so a pan applied at one zoom level can never survive as a stale
   * out-of-bounds value that pins the product to the edge of its allowed range
   * at every lower zoom (only Reset used to recover from that).
   */
  const applyZoomFactor = useCallback((factor: number) => {
    const from = zoomRef.current
    const next = zoomStep({ zoom: from, pan: currentEffPan() }, factor)
    if (next.zoom === from) return
    zoomRef.current = next.zoom
    panRef.current = next.pan
    setZoom(next.zoom)
    setPan(next.pan)
    // Zooming mid-drag: rebase the in-flight drag onto the renormalised pan and
    // the current pointer position, so the next pointermove continues smoothly
    // instead of snapping the product back to the pre-zoom offset.
    const drag = dragRef.current
    if (drag) {
      drag.panX = next.pan.x
      drag.panY = next.pan.y
      drag.startX = lastPointerRef.current.x
      drag.startY = lastPointerRef.current.y
    }
  }, [currentEffPan])

  // Native (non-passive) wheel listener so preventDefault reliably stops page
  // scroll — React's synthetic onWheel can be attached passive by the browser.
  // Wired as a callback ref (see lib/wheelZoom.ts): the wrapper mounts several
  // commits after this component does, and a mount-once effect misses it.
  const wheelRef = useWheelZoom<HTMLDivElement>(applyZoomFactor)
  const attachWrapper = useCallback(
    (node: HTMLDivElement | null) => {
      setWrapperEl(node)
      wheelRef(node)
    },
    [wheelRef],
  )

  useEffect(() => {
    if (!layout || !manifest) return
    setSnapshotAnchors(snapshotAnchors(layout, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT))
    registerSnapshot(() =>
      compositeToBlob(layout, {
        night,
        pxPerMeterY: manifest.rig.pxPerMeterY,
        // The exported PNG shows the same beam shape and colour as the viewer,
        // not the defaults.
        distribution: distributionCode(config),
        colorTemp: colorTempCode(config),
        // Phase 0.20 hygiene — WAIVED, not overlooked. `projectGround` is a
        // plain arrow defined further down this component, so it has a new
        // identity every render: adding it to the dep array would re-register
        // the snapshot on every commit. It is also declared BELOW this effect,
        // so a dep-array reference would evaluate in its temporal dead zone
        // and throw during render. The closure is already correct — the
        // function derives from `manifest` alone, and `manifest` IS a dep, so
        // the effect re-runs with a fresh one whenever it could go stale.
        // The real fix is hoisting it into a useCallback([manifest]); that is
        // a refactor of a load-bearing component, not a lint tidy.
        // (The rule is waived on this effect's dependency array below.)
        projectGround,
        // A pole-less partial preview floats — the silhouette has no ground
        // line to stand on, so the snapshot drops it too (matches the viewer).
        // A ground-mounted product (bollard) stands on the ground by itself.
        // Same `isGrounded` rule the viewer uses, so the PNG and the screen can
        // never disagree about whether the build touches the ground.
        showScale: showScale && isGrounded(catalog, config),
      }),
    )
    return () => registerSnapshot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `projectGround` above
  }, [layout, manifest, night, showScale, config, catalog, registerSnapshot, setSnapshotAnchors])

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Presses on the viewer's own controls (rotate/zoom/reset) must stay
    // clicks — capturing the pointer here would retarget their events to the
    // wrapper and swallow them.
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    const eff = currentEffPan()
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: eff.x, panY: eff.y }
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    const next = {
      x: drag.panX + (e.clientX - drag.startX),
      y: drag.panY + (e.clientY - drag.startY),
    }
    panRef.current = next
    setPan(next)
  }

  const handlePointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    // Commit the clamped pan the user can actually see. Without this the raw
    // pan keeps whatever overshoot the drag accumulated past the bounds, and
    // that stale value re-asserts itself on every later zoom change.
    const eff = currentEffPan()
    panRef.current = eff
    setPan((p) => (p.x === eff.x && p.y === eff.y ? p : eff))
  }

  // 0.11's zoomIn/zoomOut/resetView/flipView are all gone: the carousel is the
  // single view control now (cycleView above), and returning to an assembly
  // preset performs the re-grounding that Reset used to. `applyZoomFactor` — the
  // one shared zoom transition — stays, driven by the wheel.

  if (manifest === undefined) {
    return <div className="composite-loading">Loading render…</div>
  }

  const configPartIds = [config.pole, config.baseCover, config.arm, config.fixture].filter(
    Boolean,
  )

  // Phase 0.12_TO (Tyler 8/12, blank slate): an EMPTY build is an invited
  // state. Phase 0.14 (Tyler 8/14): a PARTIAL build is not — the first pick
  // renders immediately (resolveAssemblyLayout composes whatever subset is
  // selected), and the remaining slots are suggested by a hint pill overlaid
  // on the art instead of a full-screen "Keep building" placeholder.
  const neededSlots = (['fixture', 'arm', 'pole', 'baseCover'] as Slot[]).filter(
    (slot) => !config[slot] && compatibleParts(catalog, config, slot).length > 0,
  )

  if (configPartIds.length === 0) {
    return (
      <div className="composite-start">
        <h2>Start your build</h2>
        <p>Pick a fixture in the panel — your pole takes shape here as you choose.</p>
      </div>
    )
  }

  if (!manifest || !layout || layout.layers.length === 0 || layout.missing.length > 0) {
    const missingIds = layout && layout.missing.length > 0 ? layout.missing : configPartIds
    return <RenderFallback catalog={catalog} partIds={missingIds} label="Preview render coming" />
  }

  // No pole yet → the layout is a floating component preview: nothing is
  // grounded, so the ground furniture (contact shadow, compass ring, human
  // silhouette; night pool is already absent from the layout) stays hidden.
  const grounded = isGrounded(catalog, config)
  const wall = assemblyMode === 'wall' ? wallPlane(layout, config.arm) : null

  const pxPerMeterY = manifest.rig.pxPerMeterY
  // The yaw the layout actually drew (snapped to the assembly's shared step).
  const appliedYaw = layout.appliedViewYaw ?? viewYaw
  const shadowWidthPx = GROUND_SHADOW_M[0] * pxPerMeterY
  const shadowHeightPx = GROUND_SHADOW_M[1] * pxPerMeterY

  // Human silhouette sizing/position — ground point comes straight from the
  // rig projection (no hand-tuned offsets), matching compositeToBlob.ts.
  const humanHeightPx = HUMAN_HEIGHT_M * pxPerMeterY
  const humanHeadR = humanHeightPx * 0.09
  const humanBodyW = humanHeightPx * 0.16
  const humanWidthPx = humanHeadR * 2
  const [humanFootX, humanFootY] = pointInLayout(layout, manifest, HUMAN_OFFSET)

  // Night light. layout.lightPx already carries the fixture light's pixel
  // position (x baked in from world x *and* z, per the rig's linear
  // projection). The rig's worldToImage map has no height→x cross-term
  // (raising/lowering the fixture never shifts it sideways on screen for this
  // azimuth/elevation-locked rig), so the ground directly under the light
  // shares lightPx's x with the assembly's own ground line (origin's y). The
  // pure nightLight() helper yields those points; we render only the wide warm
  // ground POOL and the tapering downward spotlight cone (beam) as the
  // illumination cues — deliberately NO self-lit lens "ball" at the head. Same
  // geometry the PNG snapshot draws. Conceptual look only, not a photometric
  // simulation (see the disclaimer in App.tsx).
  // One glow per fixture — twin/triple/quad light from every arm, not just one.
  const lightPoints = layout.lightPxs ?? (layout.lightPx ? [layout.lightPx] : [])
  // The beam takes the shape of the distribution the customer picked (Tyler
  // 8/20) — 5M when nothing is chosen — and the footprint's pole-side edge sits
  // on the ground line, so the pattern reads as thrown AWAY from the pole.
  const distribution = distributionCode(config)
  // Colour follows the Color Temp column (Tyler 8/20), 5000K by default.
  const temp = colorTempCode(config)
  // A plain function, NOT a useCallback: this sits after the early return for a
  // missing render, and a hook below a conditional return breaks React's hook
  // order — it crashed the viewer outright the moment the fallback path ran.
  const projectGround = (offset: [number, number, number]) => projectOffset(manifest, offset)
  const groundPlaneAspect = groundAspect(projectGround)
  const lights = night
    ? lightPoints.map((p) =>
        nightLight(
          p,
          layout.origin[1],
          pxPerMeterY,
          distribution,
          layout.origin[0],
          groundPlaneAspect,
        ),
      )
    : []

  // Pin the product's ground line (layout.origin) to the shared horizon so its
  // base + contact shadow land on every backdrop's ground plane. transform-
  // origin is top-left (see index.css .composite-stage), so screen = translate
  // + scale·local; solving for local origin → (W/2, H·HORIZON_FRAC) gives the
  // translate below. Zoom is folded into the scale AND the pin, so zooming
  // grows the product about its grounded foot instead of drifting off the
  // horizon. (Panning is only enabled once zoomed in — a deliberate inspection
  // mode — and is the one case the foot can leave the ground line.)
  const s = fitScale * zoom
  // Blank/studio scene: bound the pan so the product always stays substantially
  // in view and snaps back to grounded/centred at fit — the view can never get
  // stuck off-screen no matter how zoom/pan/view are combined. Photo scenes
  // (Tyler, 0.10.5_TO): FREE placement — the product can be dragged and scaled
  // anywhere so it sits naturally in the photo, and cycling to a view preset
  // re-grounds it. Derived every render; raw `pan` state stays untouched.
  //
  // `clamp` has to travel with the rest of the clamp base, not just gate this
  // one expression: the pointer handlers ask `currentEffPan()` where the product
  // is mid-gesture, and if that kept clamping while the render did not, every
  // free drag would be silently pulled back inside the studio bounds on the next
  // pointer event — the free placement would look like it fought the cursor.
  const freePlace = scene !== 'blank'
  clampBaseRef.current = { fitScale, box: layout, viewport, horizonFrac, clamp: !freePlace }
  const effPan = freePlace
    ? pan
    : clampPan(pan, { zoom, scale: s, box: layout, viewport, horizonFrac })
  const targetX = viewport.w / 2
  const targetY = viewport.h * horizonFrac
  const translateX = targetX - s * layout.origin[0] + effPan.x
  const translateY = targetY - s * layout.origin[1] + effPan.y
  const stageTransform = `translate(${translateX}px, ${translateY}px) scale(${s})`

  // Tesla-style callouts, in viewport space (outside the scaled stage so the
  // text never zooms). Anchors project each slot's layer box through the same
  // translate+scale as the stage, so they track pan/rotate exactly.
  // Phase 0.17 (Tyler 8/19): labels PARK OUTSIDE the model's screen box in
  // two fixed columns — the leader line stretches from the anchored dot out
  // past the assembly's edge, so no label ever sits on the art.
  const modelLeftPx = translateX
  const modelRightPx = translateX + s * layout.width
  const CALLOUT_GUTTER = 22
  const CALLOUT_MIN_LINE = 40
  const CALLOUT_LABEL_ROOM = 130
  const callouts =
    onSlotClick && showLabels && zoom <= CALLOUT_MAX_ZOOM
      ? CALLOUT_DEFS.flatMap((d) => {
          const partId = config[d.slot]
          if (!partId) return []
          // Multi-instance arrangements (twin/triple/quad) suffix their layer
          // ids (`<part>#1`, `<part>#az180`) — a twin must not lose its arm
          // and fixture callouts, so match the instance prefix too and anchor
          // on the first (frontmost) instance.
          const layer = layout.layers.find(
            (l) => l.partId === partId || l.partId.startsWith(`${partId}#`),
          )
          if (!layer) return []
          // 'mount' pins the hub (the layer's recorded origin pixel); the
          // default is the box centre at the def's height fraction.
          const ax =
            d.at === 'mount'
              ? layer.left + layer.asset.anchor[0]
              : layer.left + layer.asset.width / 2
          const ay =
            d.at === 'mount'
              ? layer.top + layer.asset.anchor[1]
              : layer.top + layer.asset.height * d.anchorFrac
          const x = translateX + s * ax
          const y = translateY + s * ay
          const line =
            d.side === 'right'
              ? Math.min(
                  Math.max(modelRightPx + CALLOUT_GUTTER - x, CALLOUT_MIN_LINE),
                  Math.max(viewport.w - CALLOUT_LABEL_ROOM - x, CALLOUT_MIN_LINE),
                )
              : Math.min(
                  Math.max(x - (modelLeftPx - CALLOUT_GUTTER), CALLOUT_MIN_LINE),
                  Math.max(x - CALLOUT_LABEL_ROOM, CALLOUT_MIN_LINE),
                )
          return [{ ...d, x, y, line }]
        })
      : []

  return (
    <div
      ref={attachWrapper}
      className={`composite-viewer${night ? ' night' : ''}${scene === 'blank' ? ' blank' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Backdrop scene. We swap only the BACKDROP behind the product — the
          product keeps its own baked render-rig lighting and is NOT relit per
          scene (matches the Sternberg/Genesis3D benchmark: flat backdrop
          images). Stretched with object-fit:fill so each photo's ground plane
          stays at HORIZON_FRAC for any viewport aspect ratio. The 'blank' scene
          renders no photo — the clean studio background of .composite-viewer
          (a soft gradient, dark at night) shows through instead. */}
      {scene === 'custom'
        ? customSceneUrl && (
            <img className="composite-backdrop" src={customSceneUrl} alt="" draggable={false} />
          )
        : scene !== 'blank' && (
            <img className="composite-backdrop" src={sceneBackdrop(scene)} alt="" draggable={false} />
          )}

      <div
        className="composite-stage"
        role="img"
        aria-label="Assembled pole preview"
        style={{ width: layout.width, height: layout.height, transform: stageTransform }}
      >
        {/* Phase 0.21: the wall a wall-mounted build hangs on. Context, not
            product — a shaded plane plus a hairline at the FACE the mounting
            plate bolts to, and a soft contact shadow where the plate meets it.
            Drawn at z-index -1 so it sits behind every product layer without
            competing with their integer stacking (see the note below). */}
        {wall && (
          <>
            <div
              className={`composite-wall composite-wall-${wall.face}`}
              style={{ left: wall.left, top: wall.top, width: wall.width, height: wall.height }}
            />
            <div
              className="composite-wall-contact"
              style={{
                left: wall.face === 'right' ? wall.left + wall.width : wall.left,
                top: layout.origin[1],
                width: wall.contact,
                height: wall.contact,
              }}
            />
          </>
        )}

        {grounded && (
          <div
            className="composite-ground-shadow"
            style={{ left: layout.origin[0], top: layout.origin[1], width: shadowWidthPx, height: shadowHeightPx }}
          />
        )}

        {lights.map((light, i) => (
          <div key={`pool-${i}`}>
            {/* The spec sheet's own isolux contours, outermost first, each a
                little stronger than the last — the stack is the falloff. They
                are projected through the rig's ground map, the same one the
                compass ring uses, so the light lies on the compass's plane. */}
            {light.bands.length > 0 && (
              <svg
                className="composite-light-footprint"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                aria-hidden
              >
                {light.bands.map((band) => (
                  <polygon
                    key={band.fc}
                    points={groundToStage(band, [light.pool.x, light.pool.y], projectGround)
                      .map(([x, y]) => `${x},${y}`)
                      .join(' ')}
                    fill={lightRgba(temp, 'wash', band.weight)}
                  />
                ))}
              </svg>
            )}
            <div
              className="composite-light-pool"
              style={{
                left: light.pool.x,
                top: light.pool.y,
                width: light.pool.rx * 2,
                height: light.pool.ry * 2,
                background: `radial-gradient(closest-side, ${lightRgba(temp, 'wash', 0.5)}, ${lightRgba(temp, 'wash', 0)})`,
              }}
            />
            {light.beam.height > 0 && (
              <div
                className="composite-light-beam"
                style={{
                  background: `linear-gradient(to bottom, ${lightRgba(temp, 'core', 0.22)}, ${lightRgba(temp, 'wash', 0.02)})`,
                  left: light.beam.left,
                  top: light.beam.top,
                  width: light.beam.width,
                  height: light.beam.height,
                  clipPath: `polygon(${50 - light.beam.apexHalfPct}% 0, ${50 + light.beam.apexHalfPct}% 0, 100% 100%, 0 100%)`,
                }}
              />
            )}
          </div>
        ))}

        {/* zIndex is the SORTED array index, not layer.z: depth-proxied
            layers carry fractional z (arms, crossarm fixtures, the CLE
            extender), and CSS silently IGNORES a fractional z-index — the
            layer fell back to auto and painted UNDER every integer-z sibling
            (Tyler's "transparent extender", 8/19). layers[] is already
            z-sorted, so the index is the correct integer stacking. */}
        {layout.layers.map((layer, i) =>
          layer.tint ? (
            <TintedLayer
              key={layer.partId}
              file={layer.asset.file}
              tint={layer.tint}
              style={{
                left: layer.left,
                top: layer.top,
                width: layer.asset.width,
                height: layer.asset.height,
                zIndex: i,
              }}
            />
          ) : (
            <img
              key={layer.partId}
              className="composite-layer"
              src={renderUrl(layer.asset.file)}
              alt=""
              draggable={false}
              loading={i === 0 ? 'eager' : 'lazy'}
              style={{
                left: layer.left,
                top: layer.top,
                width: layer.asset.width,
                height: layer.asset.height,
                zIndex: i,
              }}
            />
          ),
        )}

        {/* Phase 0.10.5: ground compass — a projected ring at the pole base with
            the four orientation azimuths. 0° tracks the hand-hole homing
            reference, so it rotates with the assembly spin. Projected through
            the same rig map as everything else, so it lies on the ground
            plane in correct perspective. */}
        {/* The compass tracks the ARM arrangement's orientation about the
            pole — a ground-mounted product has neither, so it needs a pole
            specifically, not just a grounded layout. */}
        {showCompass && Boolean(config.pole) && (
          <svg className="composite-compass" style={{ overflow: 'visible' }} aria-hidden="true">
            <polygon
              points={Array.from({ length: 48 }, (_, i) => {
                const p = pointInLayout(layout, manifest, rotateY([COMPASS_R_M, 0, 0], i * 7.5 - appliedYaw))
                return `${p[0]},${p[1]}`
              }).join(' ')}
              className="composite-compass-ring"
            />
            {[0, 90, 180, 270].map((a) => {
              const tickIn = pointInLayout(layout, manifest, rotateY([COMPASS_R_M * 0.88, 0, 0], a - appliedYaw))
              const tickOut = pointInLayout(layout, manifest, rotateY([COMPASS_R_M, 0, 0], a - appliedYaw))
              const label = pointInLayout(layout, manifest, rotateY([COMPASS_LABEL_R_M, 0, 0], a - appliedYaw))
              return (
                <g key={a} className={a === 0 ? 'composite-compass-zero' : undefined}>
                  <line x1={tickIn[0]} y1={tickIn[1]} x2={tickOut[0]} y2={tickOut[1]} />
                  <text x={label[0]} y={label[1]}>{a}°</text>
                </g>
              )
            })}
          </svg>
        )}

        {showScale && grounded && (
          <svg
            className="composite-scale-figure"
            style={{ left: humanFootX, top: humanFootY, width: humanWidthPx, height: humanHeightPx }}
            viewBox={`0 0 ${humanWidthPx} ${humanHeightPx}`}
            aria-hidden="true"
          >
            <rect
              x={(humanWidthPx - humanBodyW) / 2}
              y={humanHeadR * 2}
              width={humanBodyW}
              height={humanHeightPx - humanHeadR * 2}
              rx={humanBodyW / 2}
              fill="#8a8d92"
              opacity={0.85}
            />
            <circle cx={humanWidthPx / 2} cy={humanHeadR} r={humanHeadR} fill="#8a8d92" opacity={0.85} />
          </svg>
        )}
      </div>

      {callouts.map((c) => {
        const part = partById(catalog, config[c.slot])
        const open = openCallout === c.slot
        return (
          <div
            key={c.slot}
            className={`viewer-callout ${c.side}${open ? ' open' : ''}`}
            style={{ left: c.x, top: c.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="viewer-callout-dot" aria-hidden="true" />
            <span className="viewer-callout-line" style={{ width: c.line }} aria-hidden="true" />
            <button
              type="button"
              className="viewer-callout-label"
              onClick={() => setOpenCallout(open ? null : c.slot)}
              aria-expanded={open}
              title={open ? `Close ${c.label} details` : `${c.label} configuration`}
            >
              {c.label} <span className="viewer-callout-plus">{open ? '–' : '+'}</span>
            </button>
            {open && part && (
              <div className="viewer-callout-card" role="dialog" aria-label={`${c.label} configuration`}>
                <p className="viewer-callout-card-name">
                  {c.slot === 'arm' ? displayArmName(part) : displayPartName(part.name)}
                </p>
                {calloutFacts(catalog, config, c.slot).map((f) => (
                  <p key={f.label} className="viewer-callout-card-row">
                    <span>{f.label}</span>
                    <strong>{f.value}</strong>
                  </p>
                ))}
                <button
                  type="button"
                  className="viewer-callout-card-btn"
                  onClick={() => {
                    setOpenCallout(null)
                    onSlotClick?.(c.slot)
                  }}
                >
                  Adjust in panel →
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Phase 0.10.5_TO: the view carousel — bold headline names the current
          framing; ‹ › click through the presets. Replaces the rotate/zoom
          buttons AND 0.11's separate row of focus chips: both were ways to pick
          a (yaw, focus) pair, and two controls for one axis is how they got out
          of step with each other.

          A manual wheel/drag does NOT change the headline: it adjusts the camera
          within the chosen view, and the view is still the one the customer
          picked. "Custom view" is the safety net for a focus that no preset
          covers (the per-slot fixture/arm/baseCover targets, which `focusBox`
          still supports) — not a zoom indicator. */}
      <div className="viewer-view-switcher">
        <button type="button" onClick={() => cycleView(-1)} aria-label="Previous view">
          ‹
        </button>
        <h2 className="viewer-view-headline" aria-live="polite">
          {viewIdx >= 0 ? views[viewIdx].label : 'Custom view'}
        </h2>
        <button type="button" onClick={() => cycleView(1)} aria-label="Next view">
          ›
        </button>
      </div>

      {/* Phase 0.14: partial-build hint — an unobtrusive pill over the art,
          never a full-screen state. Lists only slots this brand offers. */}
      {neededSlots.length > 0 && (
        <div className="composite-hint" aria-live="polite">
          Add {neededSlots.map((s) => SLOT_HINT_LABELS[s]).join(', ')} to complete your build
        </div>
      )}
    </div>
  )
}
