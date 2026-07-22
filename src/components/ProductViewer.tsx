import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CatalogPart, Catalog, PoleConfig } from '../types'
import { PhotoCard } from './PhotoCard'
import { OutputTray } from './OutputTray'
import { useConfigurator } from '../store'
import { HERO_ANGLE, resolveRenderAsset, type CompositeLayout, type RenderAsset } from '../lib/composite'
import { useRenderManifest, renderUrl } from '../lib/renders'
import { compositeToBlob } from '../lib/snapshot'

interface Props {
  part: CatalogPart
  catalog: Catalog
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
/** Exponential step per wheel tick / button click — matches CompositeViewer's feel. */
const WHEEL_SENSITIVITY = 0.0015
const BUTTON_ZOOM_STEP = 1.25

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * Finish chip row — shown only when more than one finish has a render asset
 * for this part (gated by the caller on the manifest, not the raw catalog
 * finish list). Chips are restricted to the finishes that actually have a
 * render variant.
 */
function FinishChips({
  catalog,
  availableFinishIds,
  selectedFinish,
  onSelect,
}: {
  catalog: Catalog
  availableFinishIds: string[]
  selectedFinish: string
  onSelect: (id: string) => void
}) {
  const finishes = catalog.finishes.filter((f) => availableFinishIds.includes(f.id))
  if (finishes.length === 0) return null

  return (
    <div className="product-viewer-finishes">
      {finishes.map((f) => (
        <button
          key={f.id}
          className={`product-viewer-finish-chip${selectedFinish === f.id ? ' active' : ''}`}
          style={{ '--chip-color': f.hex } as React.CSSProperties}
          title={f.name}
          aria-pressed={selectedFinish === f.id}
          onClick={() => onSelect(f.id)}
        >
          <span className="product-viewer-finish-swatch" />
          <span className="product-viewer-finish-label">{f.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Single pre-rendered image for a standalone product, with wheel + button
 * zoom (same feel/clamp range as CompositeViewer). No pan — one image never
 * needs it.
 */
function StandaloneRender({ asset }: { asset: RenderAsset }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    setZoom(1)
  }, [asset.file])

  // Native (non-passive) wheel listener so preventDefault reliably stops page
  // scroll — same reasoning as CompositeViewer.
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

  const zoomIn = () => setZoom((z) => clampZoom(z * BUTTON_ZOOM_STEP))
  const zoomOut = () => setZoom((z) => clampZoom(z / BUTTON_ZOOM_STEP))
  const resetView = () => setZoom(1)

  return (
    <div ref={wrapperRef} className="standalone-render">
      <img
        className="standalone-render-image"
        src={renderUrl(asset.file)}
        alt=""
        draggable={false}
        style={{ transform: `scale(${zoom})` }}
      />
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

/**
 * Standalone product viewer — a single pre-rendered image from the render
 * manifest instead of a live 3D canvas.
 *
 * - Manifest loading            → placeholder
 * - Manifest unavailable, or no render asset for this part/finish → PhotoCard
 *   fallback (labeled "Preview render coming"), OutputTray without the PNG card
 * - Render available            → StandaloneRender + id-card/photo overlays +
 *   finish chips (gated on available render variants) + OutputTray ['pdf']
 */
export function ProductViewer({ part, catalog }: Props) {
  const manifest = useRenderManifest()
  const registerSnapshot = useConfigurator((s) => s.registerSnapshot)

  const manifestFinishes = manifest?.parts[part.id]?.angles[HERO_ANGLE]?.finishes
  const renderFinishIds = useMemo(
    () => (manifestFinishes ? Object.keys(manifestFinishes) : []),
    [manifestFinishes],
  )
  const showFinishChips = renderFinishIds.length > 1

  const defaultFinish = part.finishes[0] ?? catalog.finishes[0]?.id ?? ''
  const [selectedFinish, setSelectedFinish] = useState(defaultFinish)
  const [configId] = useState(() => crypto.randomUUID())

  const asset = manifest ? resolveRenderAsset(manifest, part.id, selectedFinish) : undefined

  // Synthetic standalone config for the OutputTray / geometry service
  const standaloneConfig = useMemo<PoleConfig>(
    () => ({
      configId,
      brand: 'WiLLstudio',
      pole: '',
      baseCover: '',
      arm: '',
      fixture: part.id,
      finish: selectedFinish,
      rev: 1,
    }),
    [configId, part.id, selectedFinish],
  )

  // Register a minimal single-layer snapshot so the Product Render (PNG)
  // card and herocard/spec renderPng reuse the same tested compositeToBlob
  // path as the assembly viewer, instead of new untested canvas code.
  useEffect(() => {
    if (!asset || !manifest) return
    const layout: CompositeLayout = {
      layers: [{ partId: part.id, asset, left: 0, top: 0, z: 1 }],
      width: asset.width,
      height: asset.height,
      origin: asset.anchor,
      missing: [],
    }
    registerSnapshot(() =>
      compositeToBlob(layout, { night: false, pxPerMeterY: manifest.rig.pxPerMeterY, showScale: false }),
    )
    return () => registerSnapshot(null)
  }, [asset, manifest, part.id, registerSnapshot])

  let mainContent: ReactNode
  if (manifest === undefined) {
    mainContent = <div className="product-viewer-loading">Loading render…</div>
  } else if (!asset) {
    mainContent = <PhotoCard part={part} renderComing />
  } else {
    mainContent = (
      <>
        <div className="product-viewer-canvas">
          <StandaloneRender asset={asset} />
          <div className="product-viewer-id-card">
            <span className="product-viewer-id-name">{part.name}</span>
            <span className="product-viewer-id-family">{part.category}</span>
            <a href={part.productUrl} target="_blank" rel="noreferrer">
              Product page ↗
            </a>
          </div>
          {part.photo && (
            <a
              className="product-viewer-photo"
              href={part.productUrl}
              target="_blank"
              rel="noreferrer"
              title="Official product image"
            >
              <img src={part.photo} alt={part.name} loading="lazy" />
              <span>Product photo</span>
            </a>
          )}
        </div>
        {showFinishChips && (
          <FinishChips
            catalog={catalog}
            availableFinishIds={renderFinishIds}
            selectedFinish={selectedFinish}
            onSelect={setSelectedFinish}
          />
        )}
      </>
    )
  }

  return (
    <div className="product-viewer">
      <div className="product-viewer-main">{mainContent}</div>

      <div className="product-viewer-tray">
        <OutputTray
          catalog={catalog}
          config={standaloneConfig}
          formats={['pdf']}
          showPngCard={Boolean(asset)}
        />
      </div>
    </div>
  )
}
