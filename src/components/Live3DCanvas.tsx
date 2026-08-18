import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { FinishDef } from '../types'
import {
  LIVE_AZIMUTH_DEG,
  LIVE_ELEVATION_DEG,
  liveFrustum,
  turntableExtents,
  viewBasis,
  type TurntableExtents,
} from '../lib/live3dFrame'

/**
 * Phase 0.15 (Workstreams A + C) — the live 3D focus canvas.
 *
 * This file is the ONLY place in the app bundle that imports three, and it is
 * only ever loaded through React.lazy when a live focus actually opens — the
 * 0.5 "no runtime 3D" rule relaxes exactly here and nowhere else, as a lazy
 * chunk the assembly views never pay for.
 *
 * The scene is a deliberate copy of the offline render rig's
 * (scripts/render-rig/page/main.ts): same RoomEnvironment PMREM environment,
 * same warm key light, same ACES tone mapping at 1.1 exposure, same
 * orthographic azimuth/elevation, and the same finish-material rule (meshes
 * whose material is named `will-body` — or unnamed — take the catalog finish;
 * `will-fixed-*` keep their authored colors). That copy IS the feature: the
 * tinted live model must sit next to the tinted WebP renders without a visible
 * seam, so the two pipelines must not drift apart. If the rig's look changes,
 * change it here the same day.
 *
 * Workstream C: the canvas renders a LIST of positioned models — the focused
 * part plus its mated partner (fixture at the arm's catalog socket, exactly
 * the offset the image compositor projects) — so junction occlusion is real:
 * the GVX stem disappears INTO the bracket bore because a depth buffer says
 * so, which the layered-image assembly view can never do. The pair spins
 * about its combined center; the frustum frames only the PRIMARY part's swept
 * box, which is what keeps the Arm stop and the Fixture stop distinct views.
 */

export interface LiveModelSpec {
  /** Absolute URL of the web GLB (already BASE_URL-resolved). */
  url: string
  /** Yaw aligning the GLB's native reach with the catalog +X convention. */
  rotateYDeg: number
  /** Placement in the primary part's catalog frame (its socket offset). */
  position: [number, number, number]
  /** The catalog finish tinting this model's paintable body. */
  finish: FinishDef
  /**
   * Effective paint color. Usually finish.hex; for `custom-ral` it is the
   * customer's picked RAL hex — which the pre-rendered WebPs CANNOT show (they
   * are baked at the placeholder gray), so the live view is deliberately more
   * truthful than the image here.
   */
  tintHex: string
  /** The framing target. Exactly one spec should set this. */
  primary?: boolean
}

interface Props {
  models: LiveModelSpec[]
  /** Fired once the first frame has rendered — the parent fades the image out. */
  onReady: () => void
  /** Any failure (WebGL, fetch, parse) — the parent falls back to the image. */
  onError: () => void
}

/** Turntable speed. One revolution every 18 s — inspection, not a showreel. */
const ROTATE_DEG_PER_SEC = 20

// One GLB fetch/parse per URL per session, shared across remounts (finish
// swaps re-tint in place and never reload; focus close/reopen hits this cache).
const modelCache = new Map<string, Promise<THREE.Group>>()

function loadModel(url: string): Promise<THREE.Group> {
  let p = modelCache.get(url)
  if (!p) {
    // Workstream B web GLBs are meshopt-compressed (gltfpack -cc). The decoder
    // is bundled with three — no external wasm fetch — and is a no-op for
    // uncompressed files.
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    p = loader.loadAsync(url).then((gltf) => gltf.scene)
    modelCache.set(url, p)
  }
  return p
}

/** The rig's finish material, verbatim (makeMaterial in page/main.ts). */
function makeFinishMaterial(f: FinishDef, hex: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: f.roughness,
    metalness: f.metalness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
    envMapIntensity: f.envMapIntensity,
    side: THREE.DoubleSide,
  })
}

/** Identity of the geometry on stage — a change re-builds the scene; finish
 *  changes deliberately do NOT appear here (they re-tint in place). */
function sceneKey(models: LiveModelSpec[]): string {
  return models.map((m) => `${m.url}|${m.rotateYDeg}|${m.position.join(',')}`).join('+')
}

export default function Live3DCanvas({ models, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Per-model finish material instances — the tint effect mutates them in place.
  const finishMatsRef = useRef<(THREE.MeshPhysicalMaterial | null)[]>([])
  // Latest callbacks/models without retriggering the scene effect.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const modelsRef = useRef(models)
  modelsRef.current = models

  const key = sceneKey(models)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let raf = 0
    let renderer: THREE.WebGLRenderer
    let pmrem: THREE.PMREMGenerator
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      onErrorRef.current()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    const sun = new THREE.DirectionalLight('#fff5e6', 1.2)
    sun.position.set(8, 12, 6)
    scene.add(sun)

    const basis = viewBasis(LIVE_AZIMUTH_DEG, LIVE_ELEVATION_DEG)
    const viewDir = new THREE.Vector3(...basis.dir)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500)
    camera.up.set(0, 1, 0)

    let extents: TurntableExtents | null = null
    let spin: THREE.Group | null = null
    const t0 = performance.now()

    const applyFrustum = () => {
      if (!extents) return
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h)
      const f = liveFrustum(extents, w, h)
      camera.left = f.left
      camera.right = f.right
      camera.top = f.top
      camera.bottom = f.bottom
      const center = new THREE.Vector3(...extents.center)
      camera.position.copy(center).addScaledVector(viewDir, 50)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
    }

    let readySent = false
    const tick = () => {
      if (disposed) return
      if (spin) {
        spin.rotation.y = (((performance.now() - t0) / 1000) * ROTATE_DEG_PER_SEC * Math.PI) / 180
        renderer.render(scene, camera)
        if (!readySent) {
          readySent = true
          onReadyRef.current()
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const specs = modelsRef.current
    Promise.all(specs.map((m) => loadModel(m.url)))
      .then((sources) => {
        if (disposed) return
        const content = new THREE.Group()
        const holders: THREE.Group[] = []
        finishMatsRef.current = specs.map(() => null)
        specs.forEach((spec, i) => {
          const root = sources[i].clone(true)
          // The rig's finish rule: `will-body` (or unnamed) takes the catalog
          // finish; `will-fixed-*` keep their GLTF-authored materials.
          const finishMat = makeFinishMaterial(spec.finish, spec.tintHex)
          finishMatsRef.current[i] = finishMat
          root.traverse((o) => {
            const m = o as THREE.Mesh
            if (!m.isMesh) return
            const matName = (m.material as THREE.Material)?.name ?? ''
            if (matName === 'will-body' || matName === '') m.material = finishMat
          })
          root.rotation.y = (spec.rotateYDeg * Math.PI) / 180
          const holder = new THREE.Group()
          holder.position.set(...spec.position)
          holder.add(root)
          content.add(holder)
          holders.push(holder)
        })

        // Turntable about the PAIR's combined bbox center; frustum framed on
        // the primary part's swept box about that same pivot.
        content.updateMatrixWorld(true)
        const unionBox = new THREE.Box3().setFromObject(content)
        const pivot = unionBox.getCenter(new THREE.Vector3())
        const primaryIdx = Math.max(0, specs.findIndex((s) => s.primary))
        const primaryBox = new THREE.Box3().setFromObject(holders[primaryIdx])
        extents = turntableExtents(
          [primaryBox.min.x, primaryBox.min.y, primaryBox.min.z],
          [primaryBox.max.x, primaryBox.max.y, primaryBox.max.z],
          basis,
          5,
          [pivot.x, pivot.y, pivot.z],
        )
        spin = new THREE.Group()
        spin.position.copy(pivot)
        const inner = new THREE.Group()
        inner.position.copy(pivot.clone().negate())
        inner.add(content)
        spin.add(inner)
        scene.add(spin)
        applyFrustum()
      })
      .catch(() => {
        if (!disposed) onErrorRef.current()
      })

    const ro = new ResizeObserver(applyFrustum)
    ro.observe(host)
    raf = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      // Geometry belongs to the shared cache clones — dispose materials only;
      // the cached models keep their geometry for the next open.
      for (const m of finishMatsRef.current) m?.dispose()
      finishMatsRef.current = []
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // key covers url/rotate/position for every model in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Finish swap: re-tint each model's material in place — instant, like the
  // WebP swap, never a reload.
  useEffect(() => {
    models.forEach((spec, i) => {
      const mat = finishMatsRef.current[i]
      if (!mat) return
      mat.color.set(spec.tintHex)
      mat.roughness = spec.finish.roughness
      mat.metalness = spec.finish.metalness
      mat.clearcoat = spec.finish.clearcoat
      mat.clearcoatRoughness = spec.finish.clearcoatRoughness
      mat.envMapIntensity = spec.finish.envMapIntensity
      mat.needsUpdate = true
    })
  }, [models])

  return <div ref={hostRef} className="live3d-canvas-host" />
}
