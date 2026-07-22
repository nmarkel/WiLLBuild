import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Catalog, PoleConfig } from '../types'
import type { SceneMode } from '../store'
import { useConfigurator } from '../store'
import { resolveAssemblyLayout, pointInLayout } from '../lib/composite'
import { useRenderManifest, renderUrl } from '../lib/renders'
import { compositeToBlob } from '../lib/snapshot'
import { RenderFallback } from './RenderFallback'

interface Props {
  catalog: Catalog
  config: PoleConfig
  showScale: boolean
  mode: SceneMode
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
/** Exponential step per wheel tick / button click, so zoom feels linear-ish at any level. */
const WHEEL_SENSITIVITY = 0.0015
const BUTTON_ZOOM_STEP = 1.25

/** Fit the assembly into this fraction of the wrapper's box (leaves breathing room). */
const FIT_WIDTH_FRAC = 0.8
const FIT_HEIGHT_FRAC = 0.86

const HUMAN_HEIGHT_M = 1.83
const HUMAN_OFFSET: [number, number, number] = [1.4, 0, 0.6]

/** Ground shadow ellipse size in meters (width, height), converted via pxPerMeterY. */
const GROUND_SHADOW_M: [number, number] = [2.6, 0.6]

/** Night fixture glow + ground pool sizing in meters. */
const LIGHT_GLOW_DIAMETER_M = 1.8 // ~0.9 m radius, per brief
const LIGHT_DOT_DIAMETER_M = 0.14
const LIGHT_POOL_M: [number, number] = [3.2, 0.7]

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
export function CompositeViewer({ catalog, config, showScale, mode }: Props) {
  const registerSnapshot = useConfigurator((s) => s.registerSnapshot)
  const manifest = useRenderManifest()
  const night = mode === 'night'

  const layout = useMemo(
    () => (manifest ? resolveAssemblyLayout(catalog, manifest, config) : null),
    [catalog, manifest, config],
  )

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  )

  // Kept in a ref so the ResizeObserver callback below (subscribed once per
  // width/height pair) always reads the latest layout without re-subscribing
  // on every finish swap, which produces a new layout object at the same
  // dimensions.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Physical-assembly key (excludes finish) — matches Scene.tsx's CameraRig
  // convention: a finish swap shouldn't reset the view, only a part change.
  const assemblyKey = `${config.pole}-${config.arm}-${config.fixture}-${config.baseCover}`

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [assemblyKey])

  // Fit scale from the wrapper's live size. useLayoutEffect so the first
  // paint already has the right scale instead of flashing at scale 1.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const compute = () => {
      const layoutBox = layoutRef.current
      if (!layoutBox || layoutBox.width === 0 || layoutBox.height === 0) return
      const scale = Math.min(
        (el.clientWidth * FIT_WIDTH_FRAC) / layoutBox.width,
        (el.clientHeight * FIT_HEIGHT_FRAC) / layoutBox.height,
      )
      setFitScale(scale > 0 && Number.isFinite(scale) ? scale : 1)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout?.width, layout?.height])

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
    if (zoom <= 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
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
  const shadowWidthPx = GROUND_SHADOW_M[0] * pxPerMeterY
  const shadowHeightPx = GROUND_SHADOW_M[1] * pxPerMeterY

  // Human silhouette sizing/position — ground point comes straight from the
  // rig projection (no hand-tuned offsets), matching compositeToBlob.ts.
  const humanHeightPx = HUMAN_HEIGHT_M * pxPerMeterY
  const humanHeadR = humanHeightPx * 0.09
  const humanBodyW = humanHeightPx * 0.16
  const humanWidthPx = humanHeadR * 2
  const [humanFootX, humanFootY] = pointInLayout(layout, manifest, HUMAN_OFFSET)

  // Night light glow + ground pool. layout.lightPx already carries the
  // fixture light's pixel position (x baked in from world x *and* z, per the
  // rig's linear projection). The rig's worldToImage map has no height→x
  // cross-term (raising/lowering the fixture never shifts it sideways on
  // screen for this azimuth/elevation-locked rig — see composite.test.ts's
  // fixture rig and scripts/render-rig), so the ground directly under the
  // light shares lightPx's x with the assembly's own ground line (origin's
  // y). Reusing those two values is exactly what the tested compositeToBlob
  // snapshot path does, so recomputing the light's world offset from catalog
  // socket data here would just duplicate that logic for the same answer.
  const lightPx = night ? layout.lightPx : undefined
  const lightGroundPx: [number, number] | undefined = lightPx
    ? [lightPx[0], layout.origin[1]]
    : undefined
  const glowDiameterPx = LIGHT_GLOW_DIAMETER_M * pxPerMeterY
  const dotDiameterPx = LIGHT_DOT_DIAMETER_M * pxPerMeterY
  const poolWidthPx = LIGHT_POOL_M[0] * pxPerMeterY
  const poolHeightPx = LIGHT_POOL_M[1] * pxPerMeterY

  const stageTransform = `translate(${pan.x}px, ${pan.y}px) scale(${fitScale * zoom})`

  return (
    <div
      ref={wrapperRef}
      className={`composite-viewer${night ? ' night' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
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

        {night && lightGroundPx && (
          <div
            className="composite-light-pool"
            style={{ left: lightGroundPx[0], top: lightGroundPx[1], width: poolWidthPx, height: poolHeightPx }}
          />
        )}

        {night && lightPx && (
          <div
            className="composite-light-glow"
            style={{ left: lightPx[0], top: lightPx[1], width: glowDiameterPx, height: glowDiameterPx }}
          />
        )}

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

        {night && lightPx && (
          <div
            className="composite-light-dot"
            style={{ left: lightPx[0], top: lightPx[1], width: dotDiameterPx, height: dotDiameterPx }}
          />
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
