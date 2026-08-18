import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
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
 * Phase 0.15 (Workstream A) — the live 3D focus canvas.
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
 */

interface Props {
  /** Absolute URL of the web GLB (already BASE_URL-resolved). */
  url: string
  /** Yaw aligning the GLB's native reach with the catalog +X convention. */
  rotateYDeg: number
  /** The catalog finish to tint the paintable body with. */
  finish: FinishDef
  /**
   * Effective paint color. Usually finish.hex; for `custom-ral` it is the
   * customer's picked RAL hex — which the pre-rendered WebPs CANNOT show (they
   * are baked at the placeholder gray), so the live view is deliberately more
   * truthful than the image here.
   */
  tintHex: string
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
    p = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene)
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

export default function Live3DCanvas({ url, rotateYDeg, finish, tintHex, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // The single finish material instance — the tint effect mutates it in place.
  const finishMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null)
  // Latest callbacks without retriggering the scene effect.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  // Initial finish for the scene effect; later changes go through the tint
  // effect below instead of tearing the scene down.
  const finishRef = useRef({ finish, tintHex })
  finishRef.current = { finish, tintHex }

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

    loadModel(url)
      .then((src) => {
        if (disposed) return
        const root = src.clone(true)
        // The rig's finish rule: `will-body` (or unnamed) takes the catalog
        // finish; `will-fixed-*` keep their GLTF-authored materials.
        const init = finishRef.current
        const finishMat = makeFinishMaterial(init.finish, init.tintHex)
        finishMatRef.current = finishMat
        root.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const matName = (m.material as THREE.Material)?.name ?? ''
          if (matName === 'will-body' || matName === '') m.material = finishMat
        })
        root.rotation.y = (rotateYDeg * Math.PI) / 180

        // Turntable about the model's own bbox center: pivot at the center,
        // model offset so the center sits on the pivot's axis.
        const box = new THREE.Box3().setFromObject(root)
        extents = turntableExtents(
          [box.min.x, box.min.y, box.min.z],
          [box.max.x, box.max.y, box.max.z],
          basis,
        )
        const center = new THREE.Vector3(...extents.center)
        spin = new THREE.Group()
        spin.position.copy(center)
        const inner = new THREE.Group()
        inner.position.copy(center.clone().negate())
        inner.add(root)
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
      if (spin) {
        scene.remove(spin)
        // Geometry belongs to the shared cache clone's source buffers — three
        // clones share geometry, so dispose materials only; the cached model
        // keeps its geometry for the next open.
      }
      finishMatRef.current?.dispose()
      finishMatRef.current = null
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // rotateYDeg travels with url (both come from the same manifest entry).
  }, [url, rotateYDeg])

  // Finish swap: re-tint the material in place — instant, like the WebP swap.
  useEffect(() => {
    const mat = finishMatRef.current
    if (!mat) return
    mat.color.set(tintHex)
    mat.roughness = finish.roughness
    mat.metalness = finish.metalness
    mat.clearcoat = finish.clearcoat
    mat.clearcoatRoughness = finish.clearcoatRoughness
    mat.envMapIntensity = finish.envMapIntensity
    mat.needsUpdate = true
  }, [finish, tintHex])

  return <div ref={hostRef} className="live3d-canvas-host" />
}
