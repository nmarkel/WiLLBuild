import { Suspense, useRef, useState, useMemo, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CatalogPart, Catalog } from '../types'
import { PhotoCard } from './PhotoCard'
import { PlaceholderPart } from './PlaceholderPart'
import { OutputTray } from './OutputTray'
import type { PoleConfig } from '../types'

interface Props {
  part: CatalogPart
  catalog: Catalog
}

/** Day HDRI used in the slim single-part canvas (same environment as the main scene). */
const DAY_HDRI = import.meta.env.BASE_URL + 'hdri/sunny_vondelpark_2k.hdr'

/** Approximate overall height of a placeholder spec in meters — drives camera framing. */
function specHeight(spec: NonNullable<CatalogPart['placeholder']>): number {
  switch (spec.kind) {
    case 'pole':
    case 'baseCover':
    case 'prism':
      return spec.heightM
    case 'cone':
      return spec.heightM
    case 'box':
      return spec.sizeM[1]
    case 'tube':
      return Math.max(...spec.points.map((p) => Math.abs(p[1])), spec.radiusM * 2)
    case 'lathe':
      return Math.max(...spec.profile.map(([, y]) => Math.abs(y)))
    case 'group':
      return Math.max(
        ...spec.children.map((c) => c.position[1] + specHeight(c.spec)),
      )
  }
}

/**
 * Finish chip row — shown only when the part has at least one finish option.
 */
function FinishChips({
  catalog,
  selectedFinish,
  onSelect,
}: {
  catalog: Catalog
  selectedFinish: string
  onSelect: (id: string) => void
}) {
  const finishes = catalog.finishes
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
 * Slim 3D canvas for a single part (tier 1 or 2 with a placeholder or GLB).
 * Uses MeshPhysicalMaterial from the selected finish. Day environment only.
 * No post-processing stack (keep it lightweight vs the full builder scene).
 */
function SinglePartCanvas({
  part,
  catalog,
  selectedFinish,
}: {
  part: CatalogPart
  catalog: Catalog
  selectedFinish: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const finishDef = catalog.finishes.find((f) => f.id === selectedFinish) ?? catalog.finishes[0]

  // Frame the camera to the part's height — a 25 ft pole and a pole cap need very
  // different distances. Orbit around the part's vertical midpoint.
  const h = part.placeholder ? Math.max(specHeight(part.placeholder), 0.3) : 1
  const camPos: [number, number, number] = [h * 0.9 + 0.9, h * 0.62 + 0.35, h * 1.5 + 1.5]
  const target: [number, number, number] = [0, h * 0.45, 0]

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(finishDef?.hex ?? '#888888'),
        roughness: finishDef?.roughness ?? 0.6,
        metalness: finishDef?.metalness ?? 0.2,
        clearcoat: finishDef?.clearcoat ?? 0,
        clearcoatRoughness: finishDef?.clearcoatRoughness ?? 0.5,
        envMapIntensity: finishDef?.envMapIntensity ?? 1,
      }),
    [finishDef],
  )
  useEffect(() => () => material.dispose(), [material])

  return (
    <Canvas
      ref={canvasRef}
      dpr={[1, 1.5]}
      camera={{ position: camPos, fov: 42 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
        preserveDrawingBuffer: true,
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#e6e7e8']} />

      <directionalLight
        castShadow
        position={[8, 12, 6]}
        color="#fff5e6"
        intensity={1.5}
        shadow-mapSize={[1024, 1024]}
      />

      <Suspense fallback={null}>
        <Environment
          files={DAY_HDRI}
          background
          ground={{ height: 3, radius: 20, scale: 40 }}
          environmentIntensity={1}
          backgroundIntensity={1}
        />
      </Suspense>

      {part.placeholder && (
        <group>
          <PlaceholderPart spec={part.placeholder} material={material} />
        </group>
      )}

      <ContactShadows opacity={0.5} scale={Math.max(6, h * 2)} blur={2} far={3} frames={30} />

      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.5}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={Math.max(0.5, h * 0.4)}
        maxDistance={Math.max(8, h * 3)}
      />
    </Canvas>
  )
}

/**
 * Standalone product viewer: branches on whether the part has 3D capability.
 *
 * - Part has `placeholder` (tier 2) → slim 3D canvas + finish chips + OutputTray ['pdf']
 * - No `placeholder` (tier 3)       → PhotoCard + OutputTray ['pdf'] (no PNG card)
 */
export function ProductViewer({ part, catalog }: Props) {
  const defaultFinish = part.finishes.length > 0 ? part.finishes[0] : ''
  const [selectedFinish, setSelectedFinish] = useState(defaultFinish)
  const [configId] = useState(() => crypto.randomUUID())
  const has3D = Boolean(part.placeholder)

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

  return (
    <div className="product-viewer">
      <div className="product-viewer-main">
        {has3D ? (
          <>
            <div className="product-viewer-canvas">
              <SinglePartCanvas
                part={part}
                catalog={catalog}
                selectedFinish={selectedFinish}
              />
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
            {part.finishes.length > 0 && (
              <FinishChips
                catalog={catalog}
                selectedFinish={selectedFinish}
                onSelect={setSelectedFinish}
              />
            )}
          </>
        ) : (
          <PhotoCard part={part} />
        )}
      </div>

      <div className="product-viewer-tray">
        <OutputTray
          catalog={catalog}
          config={standaloneConfig}
          formats={['pdf']}
          showPngCard={has3D}
        />
      </div>
    </div>
  )
}
