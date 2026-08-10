import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Catalog, PoleConfig, Slot } from '../types'
import type { SceneMode } from '../store'
import { useConfigurator } from '../store'
import { resolveAssemblyLayout, pointInLayout, rotateY } from '../lib/composite'
import { clampPan } from '../lib/viewerTransform'
import { useRenderManifest, renderUrl } from '../lib/renders'
import { compositeToBlob, nightLight } from '../lib/snapshot'
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

/** Callout anchors: which side the label sits on and where along the layer's
    height the leader attaches (fraction of the layer's own box). Sides
    alternate so labels never stack; vertical spread comes from the parts
    themselves (fixture top, arm upper, pole mid, base cover bottom). */
const CALLOUT_DEFS: { slot: Slot; label: string; side: 'left' | 'right'; anchorFrac: number }[] = [
  { slot: 'fixture', label: 'Fixture', side: 'right', anchorFrac: 0.45 },
  { slot: 'arm', label: 'Arm', side: 'left', anchorFrac: 0.5 },
  { slot: 'pole', label: 'Pole', side: 'right', anchorFrac: 0.55 },
  { slot: 'baseCover', label: 'Base Cover', side: 'left', anchorFrac: 0.5 },
]

/** Callouts show only near fit zoom — zoomed in is inspection mode. */
const CALLOUT_MAX_ZOOM = 1.05

/**
 * Phase 0.10.5_TO: named view presets, clicked through with ‹ › and shown as
 * the viewer headline — replaces the 45°-step rotate buttons and the zoom
 * button cluster. Pole Top / Pole Bottom are zoomed inspection framings
 * (wheel + drag still available for fine control on any view).
 */
const VIEW_PRESETS: { label: string; yaw: number; zoom: number; focus?: 'top' | 'bottom' }[] = [
  { label: 'Assembly (0°)', yaw: 0, zoom: 1 },
  { label: 'Assembly (90°)', yaw: 90, zoom: 1 },
  { label: 'Assembly (180°)', yaw: 180, zoom: 1 },
  { label: 'Pole Top', yaw: 0, zoom: 2.6, focus: 'top' },
  { label: 'Pole Bottom', yaw: 0, zoom: 2.6, focus: 'bottom' },
]

/** Pole Bottom centers this far above the foot (base cover + lower shaft). */
const BOTTOM_FOCUS_M = 0.8

/** Ground compass ring radius (meters) and label inset, world units. */
const COMPASS_R_M = 1.5
const COMPASS_LABEL_R_M = 1.85

// Phase 0.10.5: zoom doubles as the product's SCALE within the backdrop photo
// (the backdrop never scales) — 0.2× places a pole far down a lot, 10× is
// close detail. clampPan keeps the product on screen; Reset restores the
// grounded, centred, true-scale view.
const MIN_ZOOM = 0.2
const MAX_ZOOM = 10

/** Bundled scene photos share this crop (see public/scenes/SOURCES.md). */
const SCENE_IMG = { w: 1600, h: 1000 }
/** Exponential step per wheel tick, so zoom feels linear-ish at any level. */
const WHEEL_SENSITIVITY = 0.0015

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

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
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
  const viewYaw = useConfigurator((s) => s.viewYaw)
  const setViewYaw = useConfigurator((s) => s.setViewYaw)
  const customSceneUrl = useConfigurator((s) => s.customSceneUrl)
  const manifest = useRenderManifest()
  const night = mode === 'night'

  const layout = useMemo(
    () => (manifest ? resolveAssemblyLayout(catalog, manifest, config, viewYaw) : null),
    [catalog, manifest, config, viewYaw],
  )

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  // Phase 0.10.5: backdrops keep their aspect (object-fit: cover, bottom-anchored),
  // so the photo's ground line lands at a viewport-shape-dependent height —
  // compute where, and pin the product's foot there. Blank/custom scenes keep
  // the classic fraction.
  const horizonFrac = useMemo(() => {
    if (scene === 'blank' || scene === 'custom' || viewport.w <= 0 || viewport.h <= 0) {
      return HORIZON_FRAC
    }
    const cover = Math.max(viewport.w / SCENE_IMG.w, viewport.h / SCENE_IMG.h)
    return (viewport.h - SCENE_IMG.h * (1 - HORIZON_FRAC) * cover) / viewport.h
  }, [scene, viewport])
  const horizonFracRef = useRef(horizonFrac)
  horizonFracRef.current = horizonFrac
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  )
  // Latest clamped (on-screen) pan, so a drag continues from where the product
  // actually is, not from an out-of-bounds raw pan value.
  const effPanRef = useRef({ x: 0, y: 0 })

  // Kept in a ref so the ResizeObserver callback below (subscribed once per
  // width/height pair) always reads the latest layout without re-subscribing
  // on every finish swap, which produces a new layout object at the same
  // dimensions.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Physical-assembly key (excludes finish) — matches Scene.tsx's CameraRig
  // convention: a finish swap shouldn't reset the view, only a part change.
  const assemblyKey = `${config.pole}-${config.arm}-${config.fixture}-${config.baseCover}-${config.armCount ?? 1}-${config.banner?.armId ?? ''}:${config.banner?.count ?? ''}:${config.banner?.heightFt ?? ''}`

  // Current view preset. prevViewRef gates the apply effect below so one-time
  // actions (zoom/pan reset) only fire when the view actually changes, while
  // focus views keep re-centering as fitScale settles/resizes.
  const [viewIdx, setViewIdx] = useState(0)
  const prevViewRef = useRef(-1)

  // New assembly or scene swap → back to the grounded hero view.
  useEffect(() => {
    setViewIdx(0)
    setViewYaw(VIEW_PRESETS[0].yaw)
    prevViewRef.current = -1
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [assemblyKey, scene, setViewYaw])

  const cycleView = (dir: number) => {
    const next = (viewIdx + dir + VIEW_PRESETS.length) % VIEW_PRESETS.length
    setViewIdx(next)
    setViewYaw(VIEW_PRESETS[next].yaw)
  }

  // Ground-aware fit scale from the wrapper's live size. useLayoutEffect so the
  // first paint already has the right scale instead of flashing at scale 1.
  // Unlike a plain box-fit, this fits the product around its PINNED foot: the
  // foot sits at the shared horizon, so the sky space above it and the ground
  // space below it are different budgets and are constrained separately.
  useLayoutEffect(() => {
    const el = wrapperRef.current
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
  }, [layout?.width, layout?.height, horizonFrac])

  // Apply the active view preset. Zoom and the assembly views' pan reset fire
  // once per view change; focus views (Pole Top/Bottom) also re-derive their
  // centering pan whenever fitScale settles (yaw layout swap, window resize)
  // so the framing stays put. Manual wheel/drag afterwards is untouched.
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  useEffect(() => {
    const v = VIEW_PRESETS[viewIdx]
    const viewChanged = prevViewRef.current !== viewIdx
    prevViewRef.current = viewIdx
    if (viewChanged) setZoom(v.zoom)
    const box = layoutRef.current
    const vp = viewportRef.current
    if (!v.focus) {
      if (viewChanged) setPan({ x: 0, y: 0 })
      return
    }
    if (!box || !manifest || vp.w === 0) return
    const s2 = fitScale * v.zoom
    const [ox, oy] = box.origin
    const focusPt: [number, number] =
      v.focus === 'top'
        ? (box.lightPx ?? [ox, box.height * 0.1])
        : [ox, oy - BOTTOM_FOCUS_M * manifest.rig.pxPerMeterY]
    setPan({
      x: s2 * (ox - focusPt[0]),
      y: s2 * (oy - focusPt[1]) + (vp.h / 2 - vp.h * horizonFracRef.current),
    })
  }, [viewIdx, fitScale, manifest])

  // Native (non-passive) wheel listener so preventDefault reliably stops page
  // scroll — React's synthetic onWheel can be attached passive by the browser.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * WHEEL_SENSITIVITY)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!layout || !manifest) return
    registerSnapshot(() =>
      compositeToBlob(layout, { night, pxPerMeterY: manifest.rig.pxPerMeterY, showScale }),
    )
    return () => registerSnapshot(null)
  }, [layout, manifest, night, showScale, registerSnapshot])

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Presses on the viewer's own controls (rotate/zoom/reset) must stay
    // clicks — capturing the pointer here would retarget their events to the
    // wrapper and swallow them.
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: effPanRef.current.x,
      panY: effPanRef.current.y,
    }
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setPan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  if (manifest === undefined) {
    return <div className="composite-loading">Loading render…</div>
  }

  const configPartIds = [config.pole, config.baseCover, config.arm, config.fixture].filter(
    Boolean,
  )

  if (!manifest || !layout || layout.layers.length === 0 || layout.missing.length > 0) {
    const missingIds = layout && layout.missing.length > 0 ? layout.missing : configPartIds
    return <RenderFallback catalog={catalog} partIds={missingIds} label="Preview render coming" />
  }

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
  const lights = night ? lightPoints.map((p) => nightLight(p, layout.origin[1], pxPerMeterY)) : []

  // Pin the product's ground line (layout.origin) to the shared horizon so its
  // base + contact shadow land on every backdrop's ground plane. transform-
  // origin is top-left (see index.css .composite-stage), so screen = translate
  // + scale·local; solving for local origin → (W/2, H·HORIZON_FRAC) gives the
  // translate below. Zoom is folded into the scale AND the pin, so zooming
  // grows the product about its grounded foot instead of drifting off the
  // horizon. (Panning is only enabled once zoomed in — a deliberate inspection
  // mode — and is the one case the foot can leave the ground line.)
  const s = fitScale * zoom
  // Blank/studio scene: bound the pan so the product always stays
  // substantially in view and snaps back to grounded/centred at fit — the
  // view can never get stuck off-screen. Photo scenes: FREE placement — the
  // product can be dragged and scaled anywhere so it sits naturally in the
  // photo (the view presets re-ground it). Derived every render (raw `pan`
  // state stays untouched) and cached for the next drag's base.
  const freePlace = scene !== 'blank'
  const effPan = freePlace
    ? pan
    : clampPan(pan, { zoom, scale: s, box: layout, viewport, horizonFrac })
  effPanRef.current = effPan
  const targetX = viewport.w / 2
  const targetY = viewport.h * horizonFrac
  const translateX = targetX - s * layout.origin[0] + effPan.x
  const translateY = targetY - s * layout.origin[1] + effPan.y
  const stageTransform = `translate(${translateX}px, ${translateY}px) scale(${s})`

  // Tesla-style callouts, in viewport space (outside the scaled stage so the
  // text never zooms). Anchors project each slot's layer box through the same
  // translate+scale as the stage, so they track pan/rotate exactly.
  const callouts =
    onSlotClick && zoom <= CALLOUT_MAX_ZOOM
      ? CALLOUT_DEFS.flatMap((d) => {
          const partId = config[d.slot]
          if (!partId) return []
          const layer = layout.layers.find((l) => l.partId === partId)
          if (!layer) return []
          const ax = layer.left + layer.asset.width / 2
          const ay = layer.top + layer.asset.height * d.anchorFrac
          return [{ ...d, x: translateX + s * ax, y: translateY + s * ay }]
        })
      : []

  return (
    <div
      ref={wrapperRef}
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
        <div
          className="composite-ground-shadow"
          style={{ left: layout.origin[0], top: layout.origin[1], width: shadowWidthPx, height: shadowHeightPx }}
        />

        {lights.map((light, i) => (
          <div key={`pool-${i}`}>
            <div
              className="composite-light-pool"
              style={{ left: light.pool.x, top: light.pool.y, width: light.pool.rx * 2, height: light.pool.ry * 2 }}
            />
            {light.beam.height > 0 && (
              <div
                className="composite-light-beam"
                style={{
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

        {layout.layers.map((layer, i) => (
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
              zIndex: layer.z,
            }}
          />
        ))}

        {/* Phase 0.10.5: ground compass — a projected ring at the pole base with
            the four orientation azimuths. 0° tracks the hand-hole homing
            reference, so it rotates with the assembly spin. Projected through
            the same rig map as everything else, so it lies on the ground
            plane in correct perspective. */}
        {showCompass && (
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

        {showScale && (
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

      {callouts.map((c) => (
        <div key={c.slot} className={`viewer-callout ${c.side}`} style={{ left: c.x, top: c.y }}>
          <span className="viewer-callout-dot" aria-hidden="true" />
          <span className="viewer-callout-line" aria-hidden="true" />
          <button
            type="button"
            className="viewer-callout-label"
            onClick={() => onSlotClick?.(c.slot)}
            title={`Jump to the ${c.label} options`}
          >
            {c.label} <span className="viewer-callout-plus">+</span>
          </button>
        </div>
      ))}

      {/* Phase 0.10.5_TO: the view carousel — bold headline names the current
          framing; ‹ › click through the presets. Replaces rotate/zoom buttons. */}
      <div className="viewer-view-switcher">
        <button type="button" onClick={() => cycleView(-1)} aria-label="Previous view">
          ‹
        </button>
        <h2 className="viewer-view-headline" aria-live="polite">
          {VIEW_PRESETS[viewIdx].label}
        </h2>
        <button type="button" onClick={() => cycleView(1)} aria-label="Next view">
          ›
        </button>
      </div>
    </div>
  )
}
