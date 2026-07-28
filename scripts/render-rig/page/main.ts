import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Offline render-rig page (plain three.js, no React/R3F). Renders each catalog
 * placeholder solid against a SHARED orthographic camera + lighting so every
 * per-part / per-finish layer shares one world→image projection. Puppeteer
 * (generate.mjs) drives window.renderPart / window.getRig and reads back WebP.
 */

const realModels = new Map<string, THREE.Group>()
/** Yaw (radians about +Y) applied to a real GLB so its reach matches the
 *  catalog's +X convention — real CAD parts arrive on arbitrary native axes. */
const realRotations = new Map<string, number>()
const gltfLoader = new GLTFLoader()

/** Decode a base64 GLB to an ArrayBuffer (browser). */
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function loadRealModel(
  partId: string,
  base64: string,
  rotateYDeg = 0,
): Promise<void> {
  const buf = b64ToArrayBuffer(base64)
  const gltf = await gltfLoader.parseAsync(buf, '')
  realModels.set(partId, gltf.scene)
  realRotations.set(partId, (rotateYDeg * Math.PI) / 180)
}

// ---- Rig constants (shared across every part → layer coherence) -------------
const PX_PER_M = 180
const MAX_CANVAS = 4096
const AZIMUTH_DEG = 35
const ELEVATION_DEG = 6
const MARGIN_M = 0.3 // world-space breathing room before the alpha crop
const CROP_PAD_PX = 6
const RIG_VERSION = 1

// ---- Catalog types (subset — mirrors src/types.ts) --------------------------
type Vec3 = [number, number, number]
type PlaceholderSpec =
  | { kind: 'pole'; heightM: number; radiusTopM: number; radiusBottomM: number }
  | { kind: 'baseCover'; heightM: number; radiusTopM: number; radiusBottomM: number }
  | { kind: 'tube'; points: Vec3[]; radiusM: number }
  | { kind: 'box'; sizeM: Vec3; direction: 'up' | 'down' }
  | { kind: 'cone'; radiusM: number; heightM: number; direction: 'up' | 'down' }
  | { kind: 'lathe'; profile: [number, number][] }
  | { kind: 'prism'; radiusTopM: number; radiusBottomM: number; heightM: number; sides: number }
  | { kind: 'group'; children: { spec: PlaceholderSpec; position: Vec3 }[] }

interface FinishDef {
  id: string
  hex: string
  roughness: number
  metalness: number
  clearcoat: number
  clearcoatRoughness: number
  envMapIntensity: number
}
interface CatalogPart {
  id: string
  line: string
  placeholder?: PlaceholderSpec
}
interface Catalog {
  parts: CatalogPart[]
  finishes: FinishDef[]
}

// ---- Scene / renderer -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
})
renderer.setPixelRatio(1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.setClearColor(0x000000, 0)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()

const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

// Same warm key direction the old configurator scene used — consistent shading
// across every part so layers read as one lit assembly.
const sun = new THREE.DirectionalLight('#fff5e6', 1.2)
sun.position.set(8, 12, 6)
scene.add(sun)

// Fixed view direction (camera sits along +dir from the framed content).
const az = (AZIMUTH_DEG * Math.PI) / 180
const el = (ELEVATION_DEG * Math.PI) / 180
const VIEW_DIR = new THREE.Vector3(
  Math.cos(el) * Math.sin(az),
  Math.sin(el),
  Math.cos(el) * Math.cos(az),
).normalize()

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500)
camera.up.set(0, 1, 0)

/** Camera world-space right (+X) and up (+Y) basis after looking along VIEW_DIR. */
function cameraBasis(): { right: THREE.Vector3; up: THREE.Vector3 } {
  // three.js: z = (eye - target).normalize() = VIEW_DIR; x = up × z; y = z × x.
  const z = VIEW_DIR.clone()
  const x = new THREE.Vector3().crossVectors(camera.up, z).normalize()
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  return { right: x, up: y }
}

// ---- Geometry: faithful port of PlaceholderPart.tsx -------------------------
function specToObject(spec: PlaceholderSpec, material: THREE.Material): THREE.Object3D {
  switch (spec.kind) {
    case 'pole':
    case 'baseCover': {
      const geo = new THREE.CylinderGeometry(spec.radiusTopM, spec.radiusBottomM, spec.heightM, 32)
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.y = spec.heightM / 2
      return mesh
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(spec.points.map((p) => new THREE.Vector3(...p)))
      const geo = new THREE.TubeGeometry(curve, 32, spec.radiusM, 12, false)
      return new THREE.Mesh(geo, material)
    }
    case 'lathe': {
      const pts = spec.profile.map(([r, y]) => new THREE.Vector2(r, y))
      const geo = new THREE.LatheGeometry(pts, 48)
      return new THREE.Mesh(geo, material)
    }
    case 'prism': {
      const geo = new THREE.CylinderGeometry(
        spec.radiusTopM,
        spec.radiusBottomM,
        spec.heightM,
        spec.sides,
      )
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.y = spec.heightM / 2
      mesh.rotation.y = Math.PI / 4 // flat face forward, like a real lantern
      return mesh
    }
    case 'box': {
      const geo = new THREE.BoxGeometry(...spec.sizeM)
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.y = spec.direction === 'up' ? spec.sizeM[1] / 2 : -spec.sizeM[1] / 2
      return mesh
    }
    case 'cone': {
      const up = spec.direction === 'up'
      const geo = new THREE.ConeGeometry(spec.radiusM, spec.heightM, 32)
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.y = up ? spec.heightM / 2 : -spec.heightM / 2
      mesh.rotation.x = up ? 0 : Math.PI
      return mesh
    }
    case 'group': {
      const g = new THREE.Group()
      for (const child of spec.children) {
        const sub = new THREE.Group()
        sub.position.set(...child.position)
        sub.add(specToObject(child.spec, material))
        g.add(sub)
      }
      return g
    }
  }
}

function makeMaterial(f: FinishDef): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(f.hex),
    roughness: f.roughness,
    metalness: f.metalness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
    envMapIntensity: f.envMapIntensity,
    side: THREE.DoubleSide,
  })
}

/** Clone a cached real model and apply the finish: whole-part for monolithic;
 *  only `will-body` primitives for the color-aware fixture (keep authored colors). */
function instantiateRealModel(partId: string, finish: FinishDef): THREE.Object3D {
  const src = realModels.get(partId)!
  const root = src.clone(true)
  const finishMat = makeMaterial(finish)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const matName = (m.material as THREE.Material)?.name ?? ''
    if (matName === 'will-body' || matName === '') {
      m.material = finishMat
    }
    // 'will-fixed-*' keep their GLTF-imported material (authored color)
  })
  // Yaw about the origin (Y axis) to align the reach with the +X convention.
  // Rotating through the origin keeps the part's origin — and its pole-gripping
  // collar at X≈0,Z≈0 — fixed, so only the reach swings around.
  root.rotation.y = realRotations.get(partId) ?? 0
  return root
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
  })
}

// ---- Catalog ----------------------------------------------------------------
let catalog: Catalog

async function loadCatalog() {
  const res = await fetch('/catalog.json')
  catalog = (await res.json()) as Catalog
}

// ---- Rendering --------------------------------------------------------------
interface RenderResult {
  empty: boolean
  dataUrl: string
  width: number
  height: number
  anchorX: number
  anchorY: number
}

function renderPart(partId: string, finishId: string): RenderResult {
  const part = catalog.parts.find((p) => p.id === partId)
  const finish = catalog.finishes.find((f) => f.id === finishId)
  if (!finish) throw new Error(`no finish ${finishId}`)

  const useReal = realModels.has(partId)
  if (!useReal && (!part || !part.placeholder)) throw new Error(`no placeholder for part ${partId}`)

  const material = makeMaterial(finish)
  const object = useReal ? instantiateRealModel(partId, finish) : specToObject(part!.placeholder!, material)
  scene.add(object)

  // Frame: view-space extents of the content bounding box.
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const { right, up } = cameraBasis()

  const corners: THREE.Vector3[] = []
  for (const sx of [box.min.x, box.max.x])
    for (const sy of [box.min.y, box.max.y])
      for (const sz of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(sx, sy, sz))

  // View-space coords measured RELATIVE to the framed center (= the camera's
  // local frame, since the camera sits at center + VIEW_DIR·d and right/up are
  // both perpendicular to VIEW_DIR). These feed the local-space ortho frustum.
  let vMinX = Infinity
  let vMaxX = -Infinity
  let vMinY = Infinity
  let vMaxY = -Infinity
  for (const c of corners) {
    const rel = c.clone().sub(center)
    const vx = rel.dot(right)
    const vy = rel.dot(up)
    vMinX = Math.min(vMinX, vx)
    vMaxX = Math.max(vMaxX, vx)
    vMinY = Math.min(vMinY, vy)
    vMaxY = Math.max(vMaxY, vy)
  }
  const cx = (vMinX + vMaxX) / 2
  const cy = (vMinY + vMaxY) / 2

  const halfW = (vMaxX - vMinX) / 2 + MARGIN_M
  const halfH = (vMaxY - vMinY) / 2 + MARGIN_M

  let canvasW = Math.min(Math.ceil(2 * halfW * PX_PER_M), MAX_CANVAS)
  let canvasH = Math.min(Math.ceil(2 * halfH * PX_PER_M), MAX_CANVAS)
  canvasW = Math.max(canvasW, 2)
  canvasH = Math.max(canvasH, 2)

  // Frustum derived from the (whole-pixel) canvas so 1 m maps to exactly
  // PX_PER_M pixels in both axes, then offset to center the content.
  const fHalfW = canvasW / (2 * PX_PER_M)
  const fHalfH = canvasH / (2 * PX_PER_M)
  camera.left = cx - fHalfW
  camera.right = cx + fHalfW
  camera.top = cy + fHalfH
  camera.bottom = cy - fHalfH
  camera.near = 0.01
  camera.far = 500
  camera.position.copy(center).addScaledVector(VIEW_DIR, 50)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  renderer.setSize(canvasW, canvasH, false)
  renderer.clear()
  renderer.render(scene, camera)

  // Read back through a 2D canvas to find the alpha bounding box.
  const readCanvas = document.createElement('canvas')
  readCanvas.width = canvasW
  readCanvas.height = canvasH
  const ctx = readCanvas.getContext('2d')!
  ctx.drawImage(renderer.domElement, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvasW, canvasH)

  let minX = canvasW
  let minY = canvasH
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      if (data[(y * canvasW + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  scene.remove(object)
  disposeObject(object)
  if (!useReal) material.dispose()

  if (maxX < 0) {
    return { empty: true, dataUrl: '', width: 0, height: 0, anchorX: 0, anchorY: 0 }
  }

  const cropLeft = Math.max(0, minX - CROP_PAD_PX)
  const cropTop = Math.max(0, minY - CROP_PAD_PX)
  const cropRight = Math.min(canvasW - 1, maxX + CROP_PAD_PX)
  const cropBottom = Math.min(canvasH - 1, maxY + CROP_PAD_PX)
  const cropW = cropRight - cropLeft + 1
  const cropH = cropBottom - cropTop + 1

  // Where the part's world origin (0,0,0) projects, in full-canvas pixels.
  const ndc = new THREE.Vector3(0, 0, 0).project(camera)
  const originX = (ndc.x * 0.5 + 0.5) * canvasW
  const originY = (0.5 - ndc.y * 0.5) * canvasH

  const out = document.createElement('canvas')
  out.width = cropW
  out.height = cropH
  const outCtx = out.getContext('2d')!
  outCtx.drawImage(readCanvas, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH)

  return {
    empty: false,
    dataUrl: out.toDataURL('image/webp', 0.92),
    width: cropW,
    height: cropH,
    anchorX: originX - cropLeft,
    anchorY: originY - cropTop,
  }
}

/**
 * Numerically derive the shared world→image linear map by projecting the
 * origin and each unit axis through the camera at the fixed PX_PER_M scale.
 * Orthographic + fixed scale → the map is identical for every part.
 */
function getRig() {
  // Canonical framing at the origin (frustum offset is irrelevant to the
  // offset→pixel-offset map, but we set a clean one for the projections).
  const fHalf = 512 / (2 * PX_PER_M)
  camera.left = -fHalf
  camera.right = fHalf
  camera.top = fHalf
  camera.bottom = -fHalf
  camera.near = 0.01
  camera.far = 500
  camera.position.copy(VIEW_DIR).multiplyScalar(50)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const W = 512
  const H = 512
  const toPx = (v: THREE.Vector3) => {
    const ndc = v.clone().project(camera)
    return [(ndc.x * 0.5 + 0.5) * W, (0.5 - ndc.y * 0.5) * H] as [number, number]
  }
  const o = toPx(new THREE.Vector3(0, 0, 0))
  const ax = toPx(new THREE.Vector3(1, 0, 0))
  const ay = toPx(new THREE.Vector3(0, 1, 0))
  const azp = toPx(new THREE.Vector3(0, 0, 1))
  const colX: [number, number] = [ax[0] - o[0], ax[1] - o[1]]
  const colY: [number, number] = [ay[0] - o[0], ay[1] - o[1]]
  const colZ: [number, number] = [azp[0] - o[0], azp[1] - o[1]]

  const worldToImage: [[number, number, number], [number, number, number]] = [
    [colX[0], colY[0], colZ[0]],
    [colX[1], colY[1], colZ[1]],
  ]
  const pxPerMeterY = Math.hypot(colY[0], colY[1])

  return {
    version: RIG_VERSION,
    pxPerMeter: PX_PER_M,
    azimuthDeg: AZIMUTH_DEG,
    elevationDeg: ELEVATION_DEG,
    worldToImage,
    pxPerMeterY,
  }
}

// ---- Boot -------------------------------------------------------------------
declare global {
  interface Window {
    rigReady: boolean
    renderPart: typeof renderPart
    getRig: typeof getRig
    loadRealModel: typeof loadRealModel
  }
}

loadCatalog()
  .then(() => {
    window.renderPart = renderPart
    window.getRig = getRig
    window.loadRealModel = loadRealModel
    window.rigReady = true
    document.getElementById('status')!.textContent = 'rig ready'
  })
  .catch((err) => {
    document.getElementById('status')!.textContent = `rig error: ${err}`
    console.error(err)
  })
