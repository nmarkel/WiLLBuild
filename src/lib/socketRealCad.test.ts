import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalogJson from '../../public/catalog.json'
import type { Catalog, CatalogPart } from '../types'

/**
 * Phase 0.12 — a pendant arm's fixture socket must sit on the arm's real
 * terminal fitting, measured from the CAD.
 *
 * WHY THIS IS A POINT RULE NOW, AND NOT AN ENVELOPE
 * -------------------------------------------------
 * The first version of this suite (8/11) asserted only that the socket lay
 * somewhere inside the vertical span of the arm's *maximum-reach* band, with an
 * 8 cm pad. It shipped believing that was the best available: "the exact hang
 * point of a curled hook is a judgement call". That was wrong, and it let both
 * arms ship still misaligned:
 *
 *   SS  socket was 2.7 cm outboard and 2.8 cm low — the pendant hung off the
 *       OUTER WALL of the hook's descending leg instead of its centreline.
 *   AR  socket was 13.2 cm outboard — pinned to the END CAP of the horizontal
 *       bar, when the arm's actual mount is a drop nipple several inches in
 *       from that end. The envelope rule could never have caught this: it was
 *       DERIVED from max reach, which is precisely the wrong feature on an arm
 *       whose mounting point is inboard of its tip.
 *
 * The hang point is not a judgement call. All three pendant arms terminate in
 * the same standard 2-3/8" downward-open bore (measured: 0.0605/0.0605/0.0599 m
 * across x and z, 108 vertices each — it is the same fitting part). Once the
 * fitting is found by the right feature, the rule is exact:
 *
 *     socket = (centre of the fitting's open face, face y + stem insertion)
 *
 * It reproduces SH1's shipped socket — the anchor Nick confirms looks right —
 * to 0.4 mm. A rule that lands within half a millimetre of an independently
 * authored value on the one part with ground truth is the real rule, not a
 * curve fit, so it is asserted as a point with a 1 cm tolerance.
 *
 * FINDING THE FITTING: the downward-open bore nearest the far end — the lowest
 * face in the outer half of the reach. NOT the extreme vertex, which is the bar
 * end cap on AR and the outer wall of the curl on SS. That single change of
 * feature is the whole fix.
 *
 * SELF-CALIBRATING: the stem insertion is derived from SH1 at run time rather
 * than hardcoded, because SH1 is the designated anchor and the customer-visible
 * rule is literally "the SS family mounts just like the SH arm". SH1 is also
 * checked against the rule directly (its socket must BE its fitting centre), so
 * the calibration cannot quietly drift.
 *
 * SCOPE: `pendant` sockets only. FR2 carries an upward `tenon-2-3/8` — a
 * fixture SITS ON it rather than hanging from it, so a downward-open-bore rule
 * does not describe it and it is deliberately excluded rather than fudged.
 *
 * SKIPS when the GLBs are absent: they are gitignored real-CAD inputs, so a
 * fresh clone or CI has none. Same shape as
 * `geometry-service/tests/test_realgeom.py`'s `needs_cad` marker.
 */

const catalog = catalogJson as unknown as Catalog
const GLB_DIR = resolve(__dirname, '../../scripts/render-rig/real-assets/glb')
const REAL_PARTS = resolve(__dirname, '../../scripts/render-rig/real-parts.json')

/** Tolerance on the socket point. Catches SS's 3.9 cm and AR's 14.1 cm errors
 *  with wide margin, while absorbing decimation noise and the catalog's 3-dp
 *  rounding (the rule itself lands within 0.4 mm on the anchor). */
const TOL_M = 0.01
/** The standard 2-3/8" pendant bore every one of these arms terminates in. */
const BORE_DIA_M = 0.0602
const BORE_TOL_M = 0.006

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

type Mat4 = number[]

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Column-major 4x4 multiply (glTF's convention). */
function mul(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++)
      r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3]
  return r
}

/**
 * A node's local transform.
 *
 * The previous parser read `translation` and `scale` only. These particular
 * GLBs happen to carry neither rotation nor nesting, so it got the right answer
 * — by luck. A re-ingest that bakes a Y-up correction into a node rotation
 * would have silently moved every measurement, so the full TRS/hierarchy is
 * composed here instead of relying on that.
 */
function localMatrix(node: any): Mat4 {
  if (node.matrix) return node.matrix as Mat4
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const m: Mat4 = [
    (1 - 2 * (qy * qy + qz * qz)) * sx, (2 * (qx * qy + qz * qw)) * sx, (2 * (qx * qz - qy * qw)) * sx, 0,
    (2 * (qx * qy - qz * qw)) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, (2 * (qy * qz + qx * qw)) * sy, 0,
    (2 * (qx * qz + qy * qw)) * sz, (2 * (qy * qz - qx * qw)) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ]
  return m
}

/** World-space POSITION vertices of a GLB, with the rig's rotateY applied. */
function glbPoints(path: string, rotateY: number): [number, number, number][] {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) return []
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
  if (!gltf || !bin) return []

  const rad = (rotateY * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const out: [number, number, number][] = []

  const walk = (ni: number, parent: Mat4) => {
    const node = gltf.nodes[ni]
    const m = mul(parent, localMatrix(node))
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives ?? []) {
        const ai = prim.attributes?.POSITION
        if (ai === undefined) continue
        const acc = gltf.accessors[ai]
        const bv = gltf.bufferViews[acc.bufferView]
        const stride = bv.byteStride || COMP_SIZE[acc.componentType] * 3
        const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride
          const vx = bin!.readFloatLE(o)
          const vy = bin!.readFloatLE(o + 4)
          const vz = bin!.readFloatLE(o + 8)
          const x = m[0] * vx + m[4] * vy + m[8] * vz + m[12]
          const y = m[1] * vx + m[5] * vy + m[9] * vz + m[13]
          const z = m[2] * vx + m[6] * vy + m[10] * vz + m[14]
          // The rig's rotateY, in the same sense composite/render use it.
          out.push([x * cos + z * sin, y, -x * sin + z * cos])
        }
      }
    }
    for (const c of node.children ?? []) walk(c, m)
  }

  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes.map((_: unknown, i: number) => i)
  for (const r of roots) walk(r, IDENTITY)
  return out
}

interface Fitting {
  /** y of the fitting's downward-open face — where the fixture's stem enters. */
  faceY: number
  /** Centre of that face across the arm's reach. */
  centreX: number
  /** Face diameter across x and z: proves this is the round bore, not a stray flat. */
  diaX: number
  diaZ: number
  reach: number
}

/**
 * The pendant fitting: the downward-open bore nearest the arm's far end.
 *
 * Restricting to the outer half of the reach skips the pole clamp and any
 * mid-span brackets; taking the LOWEST face there (not the furthest vertex)
 * finds AR's inboard drop nipple, which is the whole point.
 */
function pendantFitting(path: string, rotateY: number): Fitting | null {
  const pts = glbPoints(path, rotateY)
  if (pts.length === 0) return null
  const reach = Math.max(...pts.map((p) => Math.abs(p[0])))
  const far = pts.filter((p) => Math.abs(p[0]) >= reach * 0.5)
  if (far.length === 0) return null
  const faceY = Math.min(...far.map((p) => p[1]))
  const face = far.filter((p) => p[1] <= faceY + 0.004)
  const xs = face.map((p) => p[0])
  const zs = face.map((p) => p[2])
  return {
    faceY,
    centreX: (Math.min(...xs) + Math.max(...xs)) / 2,
    diaX: Math.max(...xs) - Math.min(...xs),
    diaZ: Math.max(...zs) - Math.min(...zs),
    reach,
  }
}

const realParts: Record<string, string | { glb: string; rotateY?: number }> = existsSync(REAL_PARTS)
  ? JSON.parse(readFileSync(REAL_PARTS, 'utf8'))
  : {}

function rotateYFor(id: string): number {
  const e = realParts[id]
  return typeof e === 'string' ? 0 : (e?.rotateY ?? 0)
}

function fittingFor(part: CatalogPart): Fitting | null {
  const path = resolve(GLB_DIR, `${part.id}.glb`)
  if (!existsSync(path)) return null
  return pendantFitting(path, rotateYFor(part.id))
}

const ANCHOR_ID = 'sh1-shepherds-hook'

/** Real-CAD arms whose fixture hangs from a downward bore. */
const pendantArms = catalog.parts.filter(
  (p): p is CatalogPart =>
    p.slot === 'arm' && p.realCad === true && p.sockets?.fixture?.type === 'pendant',
)

const assetsPresent = existsSync(GLB_DIR)

describe.skipIf(!assetsPresent)('pendant sockets sit on the real CAD fitting they hang from', () => {
  const anchor = catalog.parts.find((p) => p.id === ANCHOR_ID) as CatalogPart | undefined
  const anchorFitting = anchor ? fittingFor(anchor) : null

  it('has pendant arms to check', () => {
    expect(pendantArms.length).toBeGreaterThan(0)
    expect(pendantArms.map((p) => p.id)).toContain(ANCHOR_ID)
  })

  it(`${ANCHOR_ID} is a usable calibration anchor: its socket IS its fitting centre`, () => {
    if (!anchorFitting) return
    const socket = anchor!.sockets!.fixture.position
    expect(
      Math.abs(socket[0] - anchorFitting.centreX),
      `the anchor's own socket x=${socket[0]} is off its fitting centre ` +
        `${anchorFitting.centreX.toFixed(4)} — every other arm is calibrated from it`,
    ).toBeLessThanOrEqual(TOL_M)
  })

  for (const arm of pendantArms) {
    it(`${arm.id}: fixture socket is the centre of its terminal bore`, () => {
      const fitting = fittingFor(arm)
      if (!fitting || !anchorFitting) return // no local GLB

      // Same standard bore on every one of these arms — if this fails, the
      // rule has latched onto some other face and the point check below is
      // meaningless, so assert it rather than assume it.
      expect(
        fitting.diaX,
        `${arm.id} terminal face is ${fitting.diaX.toFixed(4)} m across x — not the 2-3/8" bore`,
      ).toBeCloseTo(BORE_DIA_M, 2)
      expect(Math.abs(fitting.diaX - fitting.diaZ)).toBeLessThanOrEqual(BORE_TOL_M)

      // Insertion depth of the pendant's stem, taken from the anchor.
      const insertion = anchor!.sockets!.fixture.position[1] - anchorFitting.faceY
      const expected: [number, number] = [fitting.centreX, fitting.faceY + insertion]
      const socket = arm.sockets!.fixture.position

      expect(
        Math.abs(socket[0] - expected[0]),
        `${arm.id} socket x=${socket[0]} is ${(socket[0] - expected[0]).toFixed(4)} m off the ` +
          `bore centre ${expected[0].toFixed(3)} (reach ${fitting.reach.toFixed(3)}) — the ` +
          `fixture hangs beside the fitting instead of in it`,
      ).toBeLessThanOrEqual(TOL_M)

      expect(
        Math.abs(socket[1] - expected[1]),
        `${arm.id} socket y=${socket[1]} is ${(socket[1] - expected[1]).toFixed(4)} m off ` +
          `${expected[1].toFixed(3)} (bore face ${fitting.faceY.toFixed(3)} + ${insertion.toFixed(4)} ` +
          `stem insertion) — the fixture floats off the fitting vertically`,
      ).toBeLessThanOrEqual(TOL_M)
    })
  }
})
