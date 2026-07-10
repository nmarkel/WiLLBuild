import { Suspense, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Catalog, PoleConfig } from '../types'
import type { SceneMode } from '../store'
import { Assembly } from './Assembly'
import { SnapshotRig } from './SnapshotRig'

interface Props {
  catalog: Catalog
  config: PoleConfig
  showScale: boolean
  mode: SceneMode
}

/** Sun direction shared by the shadow-casting light and the baked soft shadows. */
const SUN_POSITION: [number, number, number] = [8, 12, 6]

/** How long after the user releases the controls before the idle orbit resumes. */
const AUTO_ORBIT_RESUME_MS = 6000

/**
 * Keeps the camera framed on the assembly as the config changes, and runs a
 * gentle auto-orbit while the user is idle.
 *
 * Uses Box3 to measure the real assembled geometry — no height heuristics —
 * so the fixture head is always in frame. Re-fits whenever configKey changes.
 * Finish changes and mode/scale toggles do NOT trigger a refit.
 */
function CameraRig({
  configKey,
  assemblyRef,
}: {
  configKey: string
  assemblyRef: RefObject<THREE.Group | null>
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const [autoRotate, setAutoRotate] = useState(true)
  const resumeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const c = controls.current
    const g = assemblyRef.current
    if (!c || !g) return
    // Defer one frame so newly-mounted part meshes are in the scene graph.
    const id = requestAnimationFrame(() => {
      const box = new THREE.Box3().setFromObject(g)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      // Target the vertical center of the assembly (not just pole mid-height).
      c.target.set(0, center.y, 0)
      // Back the camera off until the tallest/widest dimension fits in the fov.
      const fitDist =
        ((Math.max(size.y, size.x * 1.4) / 2) / Math.tan((42 * Math.PI) / 360)) * 1.25
      const dir = camera.position.clone().sub(c.target)
      if (dir.lengthSq() < 0.01) dir.set(1, 0.2, 1)
      dir.setLength(fitDist)
      camera.position.copy(c.target).add(dir)
      // Zoom limits derived from the measured assembly height.
      c.minDistance = size.y * 0.35
      c.maxDistance = size.y * 4
      c.update()
    })
    return () => cancelAnimationFrame(id)
  }, [configKey, camera, assemblyRef])

  // Pause the idle orbit the moment the user grabs the controls; resume a few
  // seconds after they let go. Clear the pending timer on unmount.
  useEffect(() => () => window.clearTimeout(resumeTimer.current), [])

  const handleStart = () => {
    window.clearTimeout(resumeTimer.current)
    setAutoRotate(false)
  }

  const handleEnd = () => {
    window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setAutoRotate(true), AUTO_ORBIT_RESUME_MS)
  }

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      autoRotate={autoRotate}
      autoRotateSpeed={0.4}
      onStart={handleStart}
      onEnd={handleEnd}
      maxPolarAngle={Math.PI / 2 - 0.03}
    />
  )
}

/** ~6 ft human silhouette for scale, styled for daylight. */
function HumanSilhouette() {
  return (
    <group position={[1.4, 0, 0.6]}>
      <mesh position={[0, 0.78, 0]} castShadow>
        <capsuleGeometry args={[0.2, 1.16, 8, 16]} />
        <meshStandardMaterial color="#8a8d92" roughness={0.9} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 1.71, 0]} castShadow>
        <sphereGeometry args={[0.115, 16, 16]} />
        <meshStandardMaterial color="#8a8d92" roughness={0.9} transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

export function Scene({ catalog, config, showScale, mode }: Props) {
  const night = mode === 'night'

  // ContactShadows stops refreshing after its frame budget; re-key it so the
  // ground shadow re-renders whenever the assembly (or scale figure) changes.
  const shadowKey = `${config.pole}-${config.arm}-${config.fixture}-${config.baseCover}-${config.finish}-${showScale}-${mode}`

  // Camera refit key: excludes finish, mode, and showScale so the camera only
  // refits when the physical assembly geometry changes (not on finish swaps).
  const configKey = `${config.pole}-${config.arm}-${config.fixture}-${config.baseCover}`

  // Ref to the group wrapping Assembly so CameraRig can measure real bounds.
  const assemblyRef = useRef<THREE.Group>(null)

  return (
    <Canvas
      shadows
      // 1.5 keeps orbit ≥30fps with the post stack; the snapshot rig raises
      // resolution on demand, so stills stay sharp.
      dpr={[1, 1.5]}
      camera={{ position: [4.5, 2, 5.5], fov: 42 }}
      // preserveDrawingBuffer lets the output tray snapshot the canvas as a PNG.
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
        preserveDrawingBuffer: true,
      }}
    >
      {/* Light fallback while the HDRI streams in; matches the light UI chrome. */}
      <color attach="background" args={[night ? '#111318' : '#e6e7e8']} />

      {/* Day: warm sun for crisp shadows. Night: faint cool moonlight — the
          luminaire itself becomes the dominant light (see FixtureLight). */}
      <directionalLight
        castShadow={!night}
        position={SUN_POSITION}
        color={night ? '#9db4d6' : '#fff5e6'}
        intensity={night ? 0.15 : 1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={10}
        shadow-camera-bottom={-4}
        shadow-camera-far={40}
        shadow-bias={-0.0001}
      />

      {/* Own boundary: the HDRI streams from /public and must not suspend the scene.
          Day: sunny park path (sunny_vondelpark). Night: suburban street
          (preller_drive), dimmed so the luminaire becomes the dominant light. */}
      <Suspense fallback={null}>
        <Environment
          files={import.meta.env.BASE_URL + (night ? 'hdri/preller_drive_2k.hdr' : 'hdri/sunny_vondelpark_2k.hdr')}
          background
          ground={{ height: 5, radius: 40, scale: 70 }}
          environmentIntensity={night ? 0.25 : 1}
          backgroundIntensity={night ? 0.5 : 1}
        />
      </Suspense>

      {/* The projected skybox is unlit — a real mesh disc catches the luminaire's
          warm light pool on the ground. Dark grass tone so the disc blends into
          the preller_drive lawn while keeping the pool readable. */}
      {night && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <circleGeometry args={[24, 64]} />
          <meshStandardMaterial color="#161a10" roughness={0.95} metalness={0} />
        </mesh>
      )}

      <group ref={assemblyRef}>
        <Assembly catalog={catalog} config={config} night={night} />
      </group>
      {showScale && <HumanSilhouette />}

      {/* Shadow catcher: invisible plane that receives the sun's cast shadow on
          the HDRI street (AccumulativeShadows didn't survive the ground-projected
          env + composer stack). ContactShadows adds the soft base grounding. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial transparent opacity={0.35} />
      </mesh>
      <ContactShadows
        key={shadowKey}
        opacity={0.6}
        scale={10}
        blur={2.4}
        far={4.5}
        resolution={512}
        frames={60}
      />

      <EffectComposer multisampling={0}>
        <SMAA />
        {/* Subtle contact-scale AO; radius in meters, half-res for perf. */}
        <N8AO aoRadius={0.35} distanceFalloff={0.8} intensity={1.2} quality="performance" halfRes />
        {/* Only clips speculars above white — keeps highlights lively, nothing more. */}
        <Bloom mipmapBlur intensity={0.15} luminanceThreshold={1.1} />
      </EffectComposer>

      <CameraRig configKey={configKey} assemblyRef={assemblyRef} />
      <SnapshotRig />
    </Canvas>
  )
}
