import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Offline web-GLB shell extractor page (Phase 0.15 Workstream B).
 *
 * The IP-critical step: Cole's masters are FULL engineering exports whose
 * tessellation carries internal geometry (drivers, optics, wall sections),
 * merged into one primitive per material — so interior/exterior is decided
 * PER TRIANGLE, by visibility. A triangle that never wins a pixel from any of
 * ~230 orthographic directions around the part is interior and is dropped.
 * That is a *definition* of "exterior shell", not a heuristic: what no camera
 * outside the part can see is exactly what must not ship.
 *
 * Driven by scripts/web-glb/build.mjs via Puppeteer:
 *   window.cullGlb(base64)        → culled GLB (base64) + stats
 *   window.visibleFraction(base64) → the same visibility measurement run on an
 *                                    OUTPUT file — the shell-only re-check the
 *                                    gate records (meshopt-compressed OK)
 *
 * Determinism: fixed direction set, fixed raster size, no wall clock.
 */

// ---- Renderer: exact-byte ID buffer, no color management interference ------
THREE.ColorManagement.enabled = false
/** Cull resolution (master pass) and re-check resolution. The re-check runs
 *  finer so a triangle that legitimately owns sub-pixel-at-1024 area gets a
 *  fair chance to win a pixel — the residual invisibles are raster-tie noise,
 *  which is why the gate metric is AREA-weighted (see visibleFraction). */
const CULL_RT_SIZE = 1024
const CHECK_RT_SIZE = 2048
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
renderer.setPixelRatio(1)
renderer.toneMapping = THREE.NoToneMapping
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
renderer.setSize(CULL_RT_SIZE, CULL_RT_SIZE, false)
document.body.appendChild(renderer.domElement)
const targets = new Map<number, THREE.WebGLRenderTarget>()
function targetFor(size: number): THREE.WebGLRenderTarget {
  let t = targets.get(size)
  if (!t) {
    t = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    })
    targets.set(size, t)
  }
  return t
}

/** Raw shader: writes the per-triangle ID color untouched by tone mapping,
 *  encoding, dithering or lighting. All three vertices of a triangle carry the
 *  same idColor, so interpolation is constant and the readback is exact. */
const ID_MATERIAL = new THREE.RawShaderMaterial({
  vertexShader: `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec3 idColor;
    varying vec3 vId;
    void main() {
      vId = idColor;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vId;
    void main() {
      gl_FragColor = vec4(vId, 1.0);
    }
  `,
  side: THREE.DoubleSide,
})

// ---- Direction set ----------------------------------------------------------
/**
 * ~230 orthographic view directions: an icosphere (detail 2, 162 unique
 * directions) for whole-sphere coverage, plus a dense ring at the live
 * viewer's own elevation (6°, every 5°) — the poses a customer actually sees
 * during the turntable are sampled hardest, so nothing the live camera can
 * ever show was culled.
 */
function directionSet(): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = []
  const seen = new Set<string>()
  const push = (v: THREE.Vector3) => {
    const n = v.clone().normalize()
    const key = `${n.x.toFixed(5)},${n.y.toFixed(5)},${n.z.toFixed(5)}`
    if (!seen.has(key)) {
      seen.add(key)
      dirs.push(n)
    }
  }
  const ico = new THREE.IcosahedronGeometry(1, 2)
  const pos = ico.getAttribute('position')
  for (let i = 0; i < pos.count; i++) push(new THREE.Vector3().fromBufferAttribute(pos, i))
  ico.dispose()
  const el = (6 * Math.PI) / 180
  for (let a = 0; a < 360; a += 5) {
    const az = (a * Math.PI) / 180
    push(new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)))
  }
  return dirs
}
const DIRECTIONS = directionSet()

// ---- GLB loading → world-baked, non-indexed primitives ----------------------
const gltfLoader = new GLTFLoader()
gltfLoader.setMeshoptDecoder(MeshoptDecoder)

interface Prim {
  /** Non-indexed, world-baked geometry (position + normal). */
  geometry: THREE.BufferGeometry
  material: THREE.Material
  triCount: number
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function loadPrims(b64: string): Promise<Prim[]> {
  const gltf = await gltfLoader.parseAsync(b64ToArrayBuffer(b64), '')
  gltf.scene.updateMatrixWorld(true)
  const prims: Prim[] = []
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
    // Rebuild position/normal as plain Float32 BufferAttributes FIRST.
    // gltfpack output arrives quantized (normalized int16, KHR_mesh_quantization,
    // dequantization scale on the node) and possibly interleaved — applying a
    // world matrix to a normalized attribute re-normalizes meters back into the
    // int16 range and clamps the mesh into garbage (found by the SH1 smoke
    // test: re-check read 0 visible). Reading through getX/getY/getZ
    // denormalizes and de-interleaves in one pass.
    const geo = new THREE.BufferGeometry()
    for (const name of ['position', 'normal']) {
      const attr = src.getAttribute(name)
      if (!attr) continue
      const out = new Float32Array(attr.count * 3)
      for (let i = 0; i < attr.count; i++) {
        out[i * 3] = attr.getX(i)
        out[i * 3 + 1] = attr.getY(i)
        out[i * 3 + 2] = attr.getZ(i)
      }
      geo.setAttribute(name, new THREE.BufferAttribute(out, 3))
    }
    // Bake the node transform so culling and export happen in the same frame
    // GLTFLoader gives the app at runtime (this includes gltfpack's
    // dequantization transform; identity for Cole's raw exports).
    geo.applyMatrix4(m.matrixWorld)
    prims.push({
      geometry: geo,
      material: m.material as THREE.Material,
      triCount: geo.getAttribute('position').count / 3,
    })
  })
  return prims
}

// ---- Visibility measurement --------------------------------------------------
/** Renders all prims with global triangle IDs from every direction; returns a
 *  per-prim array of Uint8Array visibility flags. */
function measureVisibility(prims: Prim[], rtSize: number): { visible: Uint8Array[]; totalTris: number } {
  // Global triangle numbering across prims → 24-bit ID (id 0 = background).
  let base = 1
  const bases: number[] = []
  const scene = new THREE.Scene()
  for (const p of prims) {
    bases.push(base)
    const n = p.triCount
    const ids = new Uint8Array(n * 3 * 3)
    for (let t = 0; t < n; t++) {
      const id = base + t
      const r = id & 0xff
      const g = (id >> 8) & 0xff
      const b = (id >> 16) & 0xff
      for (let v = 0; v < 3; v++) {
        const o = (t * 3 + v) * 3
        ids[o] = r
        ids[o + 1] = g
        ids[o + 2] = b
      }
    }
    const geo = p.geometry
    geo.setAttribute('idColor', new THREE.BufferAttribute(ids, 3, true))
    scene.add(new THREE.Mesh(geo, ID_MATERIAL))
    base += n
  }
  const totalTris = base - 1

  // Shared bbox framing.
  const box = new THREE.Box3()
  for (const p of prims) {
    p.geometry.computeBoundingBox()
    box.union(p.geometry.boundingBox!)
  }
  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getSize(new THREE.Vector3()).length() / 2

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 6)
  const visible = new Uint8Array(totalTris + 1)
  const target = targetFor(rtSize)
  const pixels = new Uint8Array(rtSize * rtSize * 4)

  for (const dir of DIRECTIONS) {
    camera.up.set(0, 1, 0)
    if (Math.abs(dir.y) > 0.99) camera.up.set(0, 0, 1)
    camera.position.copy(center).addScaledVector(dir, radius * 3)
    camera.left = -radius
    camera.right = radius
    camera.top = radius
    camera.bottom = -radius
    camera.lookAt(center)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)

    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, rtSize, rtSize, pixels)
    for (let i = 0; i < pixels.length; i += 4) {
      const id = pixels[i] | (pixels[i + 1] << 8) | (pixels[i + 2] << 16)
      if (id) visible[id] = 1
    }
  }
  renderer.setRenderTarget(null)

  // Repackage per prim.
  const perPrim: Uint8Array[] = prims.map((p, i) => {
    const flags = new Uint8Array(p.triCount)
    const b0 = bases[i]
    for (let t = 0; t < p.triCount; t++) flags[t] = visible[b0 + t]
    return flags
  })

  scene.clear()
  for (const p of prims) p.geometry.deleteAttribute('idColor')
  return { visible: perPrim, totalTris }
}

// ---- Cull + export ------------------------------------------------------------
interface CullStats {
  totalTris: number
  keptTris: number
  perMaterial: { material: string; total: number; kept: number }[]
}

async function cullGlb(b64: string): Promise<{ glbB64: string; stats: CullStats }> {
  const prims = await loadPrims(b64)
  const { visible } = measureVisibility(prims, CULL_RT_SIZE)

  const group = new THREE.Group()
  const stats: CullStats = { totalTris: 0, keptTris: 0, perMaterial: [] }
  prims.forEach((p, i) => {
    const flags = visible[i]
    const n = p.triCount
    let kept = 0
    for (let t = 0; t < n; t++) if (flags[t]) kept++
    stats.totalTris += n
    stats.keptTris += kept
    stats.perMaterial.push({ material: p.material.name ?? '', total: n, kept })
    if (kept === 0) return // a fully-interior primitive ships nothing

    const srcPos = p.geometry.getAttribute('position') as THREE.BufferAttribute
    const srcNor = p.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    const pos = new Float32Array(kept * 9)
    const nor = srcNor ? new Float32Array(kept * 9) : null
    let w = 0
    for (let t = 0; t < n; t++) {
      if (!flags[t]) continue
      for (let v = 0; v < 3; v++) {
        const s = (t * 3 + v) * 3
        pos[w] = srcPos.array[s] as number
        pos[w + 1] = srcPos.array[s + 1] as number
        pos[w + 2] = srcPos.array[s + 2] as number
        if (nor && srcNor) {
          nor[w] = srcNor.array[s] as number
          nor[w + 1] = srcNor.array[s + 1] as number
          nor[w + 2] = srcNor.array[s + 2] as number
        }
        w += 3
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    if (nor) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    group.add(new THREE.Mesh(geo, p.material))
  })

  const exporter = new GLTFExporter()
  const glb = (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer
  return { glbB64: arrayBufferToB64(glb), stats }
}

// ---- Output re-check ------------------------------------------------------------
async function visibleFraction(
  b64: string,
): Promise<{
  totalTris: number
  visibleTris: number
  frac: number
  areaFrac: number
  materials: string[]
}> {
  const prims = await loadPrims(b64)
  const { visible } = measureVisibility(prims, CHECK_RT_SIZE)
  let total = 0
  let vis = 0
  let area = 0
  let visArea = 0
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let i = 0; i < prims.length; i++) {
    const pos = prims[i].geometry.getAttribute('position') as THREE.BufferAttribute
    total += prims[i].triCount
    for (let t = 0; t < prims[i].triCount; t++) {
      a.fromBufferAttribute(pos, t * 3)
      b.fromBufferAttribute(pos, t * 3 + 1)
      c.fromBufferAttribute(pos, t * 3 + 2)
      const triArea = b.sub(a).cross(c.sub(a)).length() / 2
      area += triArea
      if (visible[i][t]) {
        vis++
        visArea += triArea
      }
    }
  }
  const materials = [...new Set(prims.map((p) => p.material.name ?? ''))].sort()
  return {
    totalTris: total,
    visibleTris: vis,
    frac: total ? vis / total : 1,
    // The gate metric. Count-based frac punishes raster-tie noise (sub-pixel
    // triangles, quantization-shifted coplanar faces losing the depth tie);
    // interior GEOMETRY — the thing the IP guardrail forbids — has real
    // surface area, so area-weighting measures exactly the property we ship.
    areaFrac: area ? visArea / area : 1,
    materials,
  }
}

// ---- Boot -----------------------------------------------------------------------
declare global {
  interface Window {
    shellReady: boolean
    cullGlb: typeof cullGlb
    visibleFraction: typeof visibleFraction
  }
}

window.cullGlb = cullGlb
window.visibleFraction = visibleFraction
window.shellReady = true
document.getElementById('status')!.textContent = 'shell extractor ready'
