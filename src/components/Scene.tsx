import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Catalog, PoleConfig } from '../types'
import { partById } from '../lib/compat'
import { Assembly } from './Assembly'

interface Props {
  catalog: Catalog
  config: PoleConfig
  showScale: boolean
}

/** Keeps the camera framed on the assembly as pole height changes. */
function CameraRig({ heightM }: { heightM: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    // Frame the whole assembly: target mid-height, back off far enough that
    // the fixture above the pole top stays in view.
    c.target.set(0, heightM * 0.55, 0)
    const dir = camera.position.clone().sub(c.target)
    if (dir.lengthSq() < 0.01) dir.set(1, 0.2, 1)
    dir.setLength(heightM * 1.85)
    camera.position.copy(c.target).add(dir)
    c.update()
  }, [heightM, camera])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      minDistance={heightM * 0.5}
      maxDistance={heightM * 3.5}
      maxPolarAngle={Math.PI / 2 - 0.03}
    />
  )
}

/** ~6 ft human silhouette for scale. */
function HumanSilhouette() {
  return (
    <group position={[1.4, 0, 0.6]}>
      <mesh position={[0, 0.78, 0]}>
        <capsuleGeometry args={[0.2, 1.16, 8, 16]} />
        <meshStandardMaterial color="#3a3d44" roughness={0.9} transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, 1.71, 0]}>
        <sphereGeometry args={[0.115, 16, 16]} />
        <meshStandardMaterial color="#3a3d44" roughness={0.9} transparent opacity={0.75} />
      </mesh>
    </group>
  )
}

export function Scene({ catalog, config, showScale }: Props) {
  const pole = partById(catalog, config.pole)
  const heightM = pole?.sockets.top?.position[1] ?? 4.3

  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 2, 5.5], fov: 42 }}
      // preserveDrawingBuffer lets the output tray snapshot the canvas as a PNG.
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}
    >
      {/* Lighter than the UI chrome so dark finishes silhouette against it. */}
      <color attach="background" args={['#22252c']} />
      <fog attach="fog" args={['#22252c', 20, 45]} />

      <ambientLight intensity={0.25} />
      <directionalLight
        castShadow
        position={[6, 10, 4]}
        intensity={1.4}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={8}
        shadow-camera-bottom={-2}
      />
      {/* Own boundary: the HDRI streams from a CDN and must not suspend the scene. */}
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>

      <Assembly catalog={catalog} config={config} />
      {showScale && <HumanSilhouette />}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#292c33" roughness={0.95} metalness={0} />
      </mesh>
      <ContactShadows opacity={0.55} scale={12} blur={2.2} far={4} resolution={512} />

      <CameraRig heightM={heightM} />
    </Canvas>
  )
}
