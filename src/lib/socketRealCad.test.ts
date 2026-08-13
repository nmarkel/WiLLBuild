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
 * The hang point is not a judgement call. Every pendant arm terminates in the
 * same standard 2-3/8" downward-open bore — measured across all SEVEN as of
 * 0.13 (SH1/SS/AR/PA1/PM1/SD/HS1), 0.0599-0.0605 m in both x and z. It is the
 * same fitting part every time. Once the fitting is found by the right feature,
 * the rule is exact:
 *
 *     socket = (centre of the fitting's open face, face y + stem insertion)
 *
 * It reproduces SH1's shipped socket — the anchor Nick confirms looks right —
 * to 0.4 mm. A rule that lands within half a millimetre of an independently
 * authored value on the one part with ground truth is the real rule, not a
 * curve fit, so it is asserted as a point with a 1 cm tolerance.
 *
 * FINDING THE FITTING: the lowest face in the outer half of the reach THAT IS
 * the 2-3/8" bore. NOT the extreme vertex (the bar end cap on AR, the outer
 * wall of the curl on SS), and — since 0.13 — not merely the lowest face
 * either: HS1 is a braced upsweep whose support stay hangs 37 mm BELOW its
 * bore, so the diameter has to filter the search rather than check it
 * afterwards.
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
 *
 * Phase 0.13 — the bore diameter is a FILTER, not a post-hoc check. It used to
 * take the single lowest face and then assert its diameter, which assumes
 * nothing in the outer half hangs below the fitting. HS1 breaks that: it is a
 * BRACED upsweep, and its diagonal support stay dips to y=0.522 while the bore's
 * open face is at y=0.559 — so the stay won the "lowest" test by 37 mm and the
 * rule reported its flat underside (0.110 x 0.024 m) instead of a Ø0.060 bore.
 * HS1's bore was there all along, 84 mm inboard of the decorative end, exactly
 * like AR's drop nipple. So: walk candidate faces upward and take the lowest one
 * that actually IS the 2-3/8" bore. Verified to reproduce the six sockets already
 * derived under the old rule, to the millimetre.
 */
function pendantFitting(path: string, rotateY: number): Fitting | null {
  const pts = glbPoints(path, rotateY)
  if (pts.length === 0) return null
  const reach = Math.max(...pts.map((p) => Math.abs(p[0])))
  const far = pts.filter((p) => Math.abs(p[0]) >= reach * 0.5)
  if (far.length === 0) return null

  // Candidate face heights, lowest first, quantised to the millimetre.
  const levels = [...new Set(far.map((p) => Math.round(p[1] * 1000)))].sort((a, b) => a - b)
  for (const level of levels) {
    const faceY = level / 1000
    const face = far.filter((p) => p[1] >= faceY - 0.0005 && p[1] <= faceY + 0.004)
    if (face.length < 12) continue // too few verts to be a tessellated circle
    const xs = face.map((p) => p[0])
    const zs = face.map((p) => p[2])
    const diaX = Math.max(...xs) - Math.min(...xs)
    const diaZ = Math.max(...zs) - Math.min(...zs)
    if (Math.abs(diaX - BORE_DIA_M) > 0.01) continue
    if (Math.abs(diaX - diaZ) > BORE_TOL_M) continue
    return { faceY, centreX: (Math.min(...xs) + Math.max(...xs)) / 2, diaX, diaZ, reach }
  }
  return null
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

/**
 * The socket a pendant hangs from, BY TYPE not by key name.
 *
 * Phase 0.13: this used to read `sockets.fixture` only, which silently excluded
 * HS1 — its pendant socket is keyed `side`. Nothing in the app cares about the
 * key (compat and compositing both match on socket TYPE), so the one place the
 * name mattered was this guard, i.e. exactly the test that exists to catch a bad
 * socket would have skipped the arm with the worst one (0.72 m out).
 */
function pendantSocketKey(p: CatalogPart): string | undefined {
  return Object.keys(p.sockets ?? {}).find((k) => p.sockets![k].type === 'pendant')
}

/** Real-CAD arms whose fixture hangs from a downward bore. */
const pendantArms = catalog.parts.filter(
  (p): p is CatalogPart => p.slot === 'arm' && p.realCad === true && !!pendantSocketKey(p),
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

      // Same standard bore on every one of these arms. Since 0.13 the search
      // FILTERS on this, so a failure here means no qualifying bore was found
      // at all (fitting would be null) — kept as a belt-and-braces statement
      // of what the rule guarantees, not as the thing that catches HS1's case.
      expect(
        fitting.diaX,
        `${arm.id} terminal face is ${fitting.diaX.toFixed(4)} m across x — not the 2-3/8" bore`,
      ).toBeCloseTo(BORE_DIA_M, 2)
      expect(Math.abs(fitting.diaX - fitting.diaZ)).toBeLessThanOrEqual(BORE_TOL_M)

      // Insertion depth of the pendant's stem, taken from the anchor.
      const insertion = anchor!.sockets!.fixture.position[1] - anchorFitting.faceY
      const expected: [number, number] = [fitting.centreX, fitting.faceY + insertion]
      // by TYPE, not key: HS1's pendant socket is keyed `side`.
      const socket = arm.sockets![pendantSocketKey(arm)!].position

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

/**
 * Phase 0.12 — the same class of bug on a TENON arm, found on FR2.
 *
 * FR2's single fixture socket was [0.62, 0.30]: derived from the arm's furthest
 * feature, which on this part is the DECORATIVE END FINIAL, not a mount. The
 * real fixture tenons are the upward columns at x = ±0.4572 topping out at
 * y = 0.4191, so the TEX composited 16 cm outboard and 12 cm low — hanging off
 * the end of the crossarm rather than sitting on it. Same root cause as SS/AR:
 * the extreme vertex is not the mounting feature.
 *
 * Two further facts this pins, both CAD-measured:
 *   - the crossarm is SYMMETRIC (x -0.611..+0.610), so it carries a fixture at
 *     each end. One socket = one bare tenon, forever.
 *   - its pole collar starts 0.0889 m ABOVE the GLB origin (every other arm's
 *     starts at 0), which is why it floated off the pole and why it needs
 *     `mountOffset`.
 */
describe.skipIf(!assetsPresent)('FR2 crossarm sits on the pole and mounts on its tenons', () => {
  const FR2 = 'willstudio-fr2-decorative-crossarm'
  const fr2 = catalog.parts.find((p) => p.id === FR2) as CatalogPart | undefined
  const path = resolve(GLB_DIR, `${FR2}.glb`)
  const pts = existsSync(path) && fr2 ? glbPoints(path, rotateYFor(FR2)) : []

  it('carries a fixture socket at BOTH ends of a symmetric crossarm', () => {
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    // Symmetric about the pole: both ends reach within a centimetre of each other.
    expect(Math.abs(Math.abs(Math.min(...xs)) - Math.max(...xs))).toBeLessThan(0.01)

    const sockets = Object.values(fr2!.sockets ?? {}).filter((s) => s.type === 'tenon-2-3/8')
    expect(sockets, 'a two-ended crossarm needs a socket per end').toHaveLength(2)
    // One either side of the pole axis.
    expect(Math.min(...sockets.map((s) => s.position[0]))).toBeLessThan(0)
    expect(Math.max(...sockets.map((s) => s.position[0]))).toBeGreaterThan(0)
  })

  /**
   * A TENON fixture does not perch on the tenon's top — its base is a SLEEVE
   * that slides DOWN over the tenon (Nick, 8/11). So the socket, which is where
   * the fixture's origin (its sleeve's bottom rim) lands, is the tenon's BASE:
   * the host's top face that the sleeve comes to rest on.
   *
   * That holds here because the sleeve is deeper than the tenon is tall —
   * measured off the CAD, TEX's bore runs y 0..0.121 while FR2's tenon stands
   * 0.4191 - 0.3175 = 0.1016 m (4.000", a standard tenon) proud of the
   * crossarm. The tenon therefore never bottoms out inside the sleeve, and the
   * fixture drops the full 4" until sleeve meets crossarm.
   *
   * If a future fixture's sleeve were SHALLOWER than the tenon, the seat would
   * instead be `tenonTop - boreDepth` and this rule would need the fixture's
   * bore measured too. Not asserted here because it is not the case for any
   * shipping combination, and parsing TEX's 21 MB GLB per run to prove a
   * negative is not worth the suite time.
   */
  it('seats each fixture at the tenon BASE — the sleeve slides over the tenon', () => {
    if (!pts.length) return
    for (const socket of Object.values(fr2!.sockets ?? {})) {
      const sx = socket.position[0]
      const side = (p: [number, number, number]) =>
        Math.sign(p[0]) === Math.sign(sx) && Math.abs(p[0]) > 0.30
      // The tenon column standing above the crossarm body, on this socket's side.
      const column = pts.filter((p) => side(p) && p[1] > 0.36)
      expect(column.length, `no tenon column found near x=${sx}`).toBeGreaterThan(0)
      const top = Math.max(...column.map((p) => p[1]))
      const cap = column.filter((p) => p[1] >= top - 0.004)
      const cx = (Math.min(...cap.map((p) => p[0])) + Math.max(...cap.map((p) => p[0]))) / 2

      // The crossarm's top face beside that tenon — where the sleeve rests.
      const axisDist = (p: [number, number, number]) => Math.hypot(p[0] - cx, p[2])
      const body = pts.filter((p) => side(p) && axisDist(p) > 0.05 && axisDist(p) < 0.2)
      expect(body.length, `no crossarm body found beside the tenon at x=${sx}`).toBeGreaterThan(0)
      const seat = Math.max(...body.map((p) => p[1]))

      expect(
        Math.abs(sx - cx),
        `FR2 socket x=${sx} is ${(sx - cx).toFixed(4)} m off its tenon centre ` +
          `${cx.toFixed(4)} — the fixture sits beside the tenon`,
      ).toBeLessThanOrEqual(TOL_M)

      expect(
        Math.abs(socket.position[1] - seat),
        `FR2 socket y=${socket.position[1]} should be the tenon BASE ${seat.toFixed(4)} ` +
          `(tenon top ${top.toFixed(4)}), because the fixture's sleeve slides over the tenon. ` +
          `Seating it at the top leaves the TEX standing ${(top - seat).toFixed(4)} m proud.`,
      ).toBeLessThanOrEqual(TOL_M)

      // The tenon this rule assumes: a standard 4" one, fully swallowed.
      expect(top - seat).toBeCloseTo(0.1016, 2)
    }
  })

  it('lands its pole collar on the pole top via mountOffset', () => {
    if (!pts.length) return
    // The collar that swallows the pole tenon, i.e. geometry on the pole axis.
    const collar = pts.filter((p) => Math.abs(p[0]) < 0.08 && Math.abs(p[2]) < 0.08)
    const collarBottom = Math.min(...collar.map((p) => p[1]))
    const offset = fr2!.mountOffset ?? [0, 0, 0]

    // FR2's collar bottom is 0.0889 m up, so the offset must cancel exactly
    // that or the crossarm floats. (When this was written FR2 was the only such
    // arm; PA1 and PM1 turned out to be the same in 0.13, which is why the
    // generalised guard below now covers every real-CAD arm rather than one.)
    expect(
      collarBottom + offset[1],
      `FR2 collar bottom ${collarBottom.toFixed(4)} + mountOffset ${offset[1]} must land on ` +
        `the pole top (0) — a non-zero result is the visible float`,
    ).toBeCloseTo(0, 3)
  })
})

/**
 * Phase 0.13 — the generalised form of FR2's float check.
 *
 * ASSETS.md says a part's origin is its LOWER ATTACHMENT POINT, but three arms
 * now violate that (FR2, PA1, PM1) and `mountOffset` is how the catalog absorbs
 * it. The trap this closes: a global `y_min == 0` looks like compliance and is
 * NOT — PA1's lowest geometry is its OUTBOARD PENDANT BORE at y=0, while its
 * pole collar sits 0.3257 m up, so it hung a third of a metre clear of the pole
 * while measuring "fine". PM1 was the same at 0.0127 m.
 *
 * The only measurement that means anything is the collar's own bottom: geometry
 * on the POLE AXIS, not the global minimum. Run over every real-CAD arm so the
 * next ingest cannot reintroduce it silently — the coverage gate never will,
 * because a floating arm's layers all exist.
 */
describe.skipIf(!assetsPresent)('every real-CAD arm lands its collar on the pole top', () => {
  const realArms = catalog.parts.filter(
    (p): p is CatalogPart => p.slot === 'arm' && p.realCad === true && !p.pseudoPart,
  )

  it('has real-CAD arms to check', () => {
    expect(realArms.length).toBeGreaterThan(0)
  })

  for (const arm of realArms) {
    it(`${arm.id}: collar bottom + mountOffset lands on the pole top`, () => {
      const path = resolve(GLB_DIR, `${arm.id}.glb`)
      if (!existsSync(path)) return
      const pts = glbPoints(path, rotateYFor(arm.id))
      if (!pts.length) return

      // Geometry hugging the pole axis — the collar that swallows the tenon.
      const collar = pts.filter((p) => Math.abs(p[0]) < 0.08 && Math.abs(p[2]) < 0.08)
      expect(collar.length, `${arm.id} has no geometry on the pole axis to seat`).toBeGreaterThan(0)
      const collarBottom = Math.min(...collar.map((p) => p[1]))
      const offset = arm.mountOffset ?? [0, 0, 0]

      expect(
        collarBottom + offset[1],
        `${arm.id} collar bottom ${collarBottom.toFixed(4)} + mountOffset ${offset[1]} = ` +
          `${(collarBottom + offset[1]).toFixed(4)}, not 0 — the arm floats that far off the ` +
          `pole top (or is sunk into it). Global y_min is NOT the check: PA1's is 0 at its ` +
          `outboard bore while its collar sat 0.3257 m up.`,
      ).toBeCloseTo(0, 3)
    })
  }
})
