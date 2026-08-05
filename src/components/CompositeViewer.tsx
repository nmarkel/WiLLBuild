import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Catalog, PoleConfig } from '../types'
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
}

/** Ground compass ring radius (meters) and label inset, world units. */
const COMPASS_R_M = 1.5
const COMPASS_LABEL_R_M = 1.85

// Phase 1.0: zoom doubles as the product's SCALE within the backdrop photo
// (the backdrop never scales) — 0.2× places a pole far down a lot, 10× is
// close detail. clampPan keeps the product on screen; Reset restores the
// grounded, centred, true-scale view.
const MIN_ZOOM = 0.2
const MAX_ZOOM = 10

/** Bundled scene photos share this crop (see public/scenes/SOURCES.md). */
const SCENE_IMG = { w: 1600, h: 1000 }
/** Exponential step per wheel tick / button click, so zoom feels linear-ish at any level. */
const WHEEL_SENSITIVITY = 0.0015
const BUTTON_ZOOM_STEP = 1.25

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
export function CompositeViewer({ catalog, config, showScale, showCompass, mode, scene }: Props) {
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

  // Phase 1.0: backdrops keep their aspect (object-fit: cover, bottom-anchored),
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

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [assemblyKey])

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

  const zoomIn = () => setZoom((z) => clampZoom(z * BUTTON_ZOOM_STEP))
  const zoomOut = () => setZoom((z) => clampZoom(z / BUTTON_ZOOM_STEP))
  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setViewYaw(0)
  }
  // Phase 1.0: spin the assembly in 45° steps (the per-azimuth render compass).
  const rotateLeft = () => setViewYaw(viewYaw - 45)
  const rotateRight = () => setViewYaw(viewYaw + 45)

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
  // Bound the pan so the product always stays substantially in view and snaps
  // back to grounded/centred at fit (zoom <= 1) — the view can never get stuck
  // off-screen no matter how zoom/pan/reset are combined. Derived every render
  // (raw `pan` state stays untouched) and cached for the next drag's base.
  const effPan = clampPan(pan, { zoom, scale: s, box: layout, viewport, horizonFrac })
  effPanRef.current = effPan
  const targetX = viewport.w / 2
  const targetY = viewport.h * horizonFrac
  const translateX = targetX - s * layout.origin[0] + effPan.x
  const translateY = targetY - s * layout.origin[1] + effPan.y
  const stageTransform = `translate(${translateX}px, ${translateY}px) scale(${s})`

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

        {/* Phase 1.0: ground compass — a projected ring at the pole base with
            the four orientation azimuths. 0° tracks the hand-hole homing
            reference, so it rotates with the assembly spin. Projected through
            the same rig map as everything else, so it lies on the ground
            plane in correct perspective. */}
        {showCompass && (
          <svg className="composite-compass" style={{ overflow: 'visible' }} aria-hidden="true">
            <polygon
              points={Array.from({ length: 48 }, (_, i) => {
                const p = pointInLayout(layout, manifest, rotateY([COMPASS_R_M, 0, 0], i * 7.5 - viewYaw))
                return `${p[0]},${p[1]}`
              }).join(' ')}
              className="composite-compass-ring"
            />
            {[0, 90, 180, 270].map((a) => {
              const tickIn = pointInLayout(layout, manifest, rotateY([COMPASS_R_M * 0.88, 0, 0], a - viewYaw))
              const tickOut = pointInLayout(layout, manifest, rotateY([COMPASS_R_M, 0, 0], a - viewYaw))
              const label = pointInLayout(layout, manifest, rotateY([COMPASS_LABEL_R_M, 0, 0], a - viewYaw))
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

      <div className="composite-zoom">
        <button type="button" onClick={rotateLeft} title="Rotate view 45° left" aria-label="Rotate view left">
          ⟲
        </button>
        <button type="button" onClick={rotateRight} title="Rotate view 45° right" aria-label="Rotate view right">
          ⟳
        </button>
        <button type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={resetView} title="Reset view" aria-label="Reset view">
          ⤢
        </button>
        <button type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  )
}
