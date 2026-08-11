import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalogJson from '../../public/catalog.json'
import type { Catalog, CatalogPart } from '../types'

/**
 * Phase 0.12 — catalog sockets must agree with the real CAD they sit on.
 *
 * The bug this exists to catch, reported by Nick on 8/11: the GVX pendant hung
 * "way down low" on the side shepherds hook and sat off to the side on the
 * suspension arm. Both arms render from real CAD, but their catalog sockets
 * were authored earlier — SS1's `y` was 0.42 against a real hook whose tip
 * sits at y 0.584..0.840, so the fixture composited about a quarter of a metre
 * below the arm that is supposed to carry it.
 *
 * Nothing could see it. The coverage gate checks that every layer EXISTS, and
 * every layer did; `resolveAssemblyLayout` places them wherever the socket
 * says. A wrong-but-present socket composites happily. This suite closes that
 * hole for the parts where a ground truth exists.
 *
 * The rule is deliberately loose — an envelope, not a point. The exact hang
 * point of a curled hook is a judgement call (SH1's own shipped socket sits
 * ~3 cm from every candidate rule I tried), so asserting an exact value would
 * encode one guess as truth. What is NOT a judgement call is that the socket
 * must lie on the arm's terminal fitting.
 *
 * SCOPE, stated honestly: with an 8 cm pad this catches GROSS misplacement, not
 * fine offsets. It fails on SS1's real 16 cm error. It would NOT have caught
 * AR1's 4 cm one — that was found by measuring, not by this suite. Tightening
 * the pad far enough to catch 4 cm would start failing arms whose fitting is
 * legitimately inset from the extreme vertex, so the pad stays loose and this
 * is a floor, not a proof of correctness.
 *
 * SKIPS when the GLBs are absent: they are gitignored real-CAD inputs, so a
 * fresh clone or CI has none. That is the same shape as
 * `geometry-service/tests/test_realgeom.py`'s `needs_cad` marker.
 */

const catalog = catalogJson as unknown as Catalog
const GLB_DIR = resolve(__dirname, '../../scripts/render-rig/real-assets/glb')
const REAL_PARTS = resolve(__dirname, '../../scripts/render-rig/real-parts.json')

interface Tip {
  /** Vertical span of the arm AT its far end — where a fixture can actually mount. */
  yMin: number
  yMax: number
  /** Maximum horizontal reach. */
  reach: number
}

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

/**
 * Real POSITION vertices, not accessor bounds.
 *
 * Bounds alone cannot express "at the tip": a shepherds hook's overall box
 * spans the whole vertical post, so a socket a quarter-metre BELOW the hook
 * still sits inside it. That is exactly why the SS1 defect survived every
 * existing check, and why the first version of this suite passed on the buggy
 * values too.
 */
function armTip(path: string, rotateY: number): Tip | null {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) return null
  const total = buf.readUInt32LE(8)
  let off = 12
  let gltf: any = null
  let bin: Buffer | null = null
  while (off < total) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const chunk = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'))
    else if (type === 0x004e4942) bin = chunk
    off += 8 + len + (len % 4 ? 4 - (len % 4) : 0)
  }
  if (!gltf || !bin) return null

  const rad = (rotateY * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const pts: [number, number][] = []

  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue
    const t = node.translation ?? [0, 0, 0]
    const sc = node.scale ?? [1, 1, 1]
    for (const prim of gltf.meshes[node.mesh].primitives ?? []) {
      const ai = prim.attributes?.POSITION
      if (ai === undefined) continue
      const acc = gltf.accessors[ai]
      const bv = gltf.bufferViews[acc.bufferView]
      const stride = bv.byteStride || COMP_SIZE[acc.componentType] * 3
      const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
      for (let i = 0; i < acc.count; i++) {
        const o = base + i * stride
        const x = bin.readFloatLE(o) * sc[0] + t[0]
        const y = bin.readFloatLE(o + 4) * sc[1] + t[1]
        const z = bin.readFloatLE(o + 8) * sc[2] + t[2]
        pts.push([x * cos + z * sin, y])
      }
    }
  }
  if (pts.length === 0) return null

  const reach = Math.max(...pts.map((p) => Math.abs(p[0])))
  // Vertices within 3 cm of the far end: the terminal fitting the fixture hangs on.
  const band = pts.filter((p) => Math.abs(p[0]) >= reach - 0.03)
  return {
    reach,
    yMin: Math.min(...band.map((p) => p[1])),
    yMax: Math.max(...band.map((p) => p[1])),
  }
}

const realParts: Record<string, string | { glb: string; rotateY?: number }> = existsSync(REAL_PARTS)
  ? JSON.parse(readFileSync(REAL_PARTS, 'utf8'))
  : {}

/** Arms that render from real CAD and carry a fixture socket. */
const armsWithRealCad = catalog.parts.filter(
  (p): p is CatalogPart =>
    p.slot === 'arm' && p.realCad === true && Object.keys(p.sockets ?? {}).length > 0,
)

const assetsPresent = existsSync(GLB_DIR)

describe.skipIf(!assetsPresent)('catalog sockets sit on the real CAD they mount to', () => {
  it('has real-CAD arms to check', () => {
    expect(armsWithRealCad.length).toBeGreaterThan(0)
  })

  for (const arm of armsWithRealCad) {
    it(`${arm.id}: fixture socket sits on the arm's terminal fitting`, () => {
      const entry = realParts[arm.id]
      const rotateY = typeof entry === 'string' ? 0 : (entry?.rotateY ?? 0)
      const tip = armTip(resolve(GLB_DIR, `${arm.id}.glb`), rotateY)
      if (!tip) return // no GLB for this arm locally

      const socket = Object.values(arm.sockets!)[0].position

      // Reach: the fixture hangs near the far end, never back at the pole clamp.
      expect(
        Math.abs(socket[0]),
        `${arm.id} socket x=${socket[0].toFixed(3)} against a reach of ${tip.reach.toFixed(3)}`,
      ).toBeGreaterThan(tip.reach * 0.8)

      // Height: the socket must be within the vertical span the arm actually
      // occupies AT that reach. This is the assertion SS1 failed — its socket
      // sat 0.164 m below a hook spanning y 0.584..0.840, so the GVX hung a
      // sixth of a metre under the arm carrying it.
      const PAD = 0.08
      expect(
        socket[1],
        `${arm.id} socket y=${socket[1].toFixed(3)} is below its own tip ` +
          `(${tip.yMin.toFixed(3)}..${tip.yMax.toFixed(3)}) — the fixture composites off the arm`,
      ).toBeGreaterThanOrEqual(tip.yMin - PAD)
      expect(
        socket[1],
        `${arm.id} socket y=${socket[1].toFixed(3)} is above its own tip ` +
          `(${tip.yMin.toFixed(3)}..${tip.yMax.toFixed(3)})`,
      ).toBeLessThanOrEqual(tip.yMax + PAD)
    })
  }
})
