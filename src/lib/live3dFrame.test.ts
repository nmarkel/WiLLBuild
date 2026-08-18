import { describe, expect, it } from 'vitest'
import {
  LIVE_AZIMUTH_DEG,
  LIVE_ELEVATION_DEG,
  LIVE_FILL_FRAC,
  LIVE_PAD_FRAC,
  liveFrustum,
  turntableExtents,
  viewBasis,
} from './live3dFrame'

const dot = (a: [number, number, number], b: [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: [number, number, number]) => Math.hypot(a[0], a[1], a[2])

describe('viewBasis', () => {
  it('is the identity camera frame at azimuth 0 / elevation 0', () => {
    const b = viewBasis(0, 0)
    expect(b.dir[0]).toBeCloseTo(0, 10)
    expect(b.dir[1]).toBeCloseTo(0, 10)
    expect(b.dir[2]).toBeCloseTo(1, 10)
    expect(b.right[0]).toBeCloseTo(1, 10)
    expect(b.right[1]).toBeCloseTo(0, 10)
    expect(b.right[2]).toBeCloseTo(0, 10)
    expect(b.up[0]).toBeCloseTo(0, 10)
    expect(b.up[1]).toBeCloseTo(1, 10)
    expect(b.up[2]).toBeCloseTo(0, 10)
  })

  it('yields an orthonormal frame at the rig angles', () => {
    const b = viewBasis(LIVE_AZIMUTH_DEG, LIVE_ELEVATION_DEG)
    expect(len(b.dir)).toBeCloseTo(1, 10)
    expect(len(b.right)).toBeCloseTo(1, 10)
    expect(len(b.up)).toBeCloseTo(1, 10)
    expect(dot(b.dir, b.right)).toBeCloseTo(0, 10)
    expect(dot(b.dir, b.up)).toBeCloseTo(0, 10)
    expect(dot(b.right, b.up)).toBeCloseTo(0, 10)
    // The camera never rolls: right stays horizontal.
    expect(b.right[1]).toBeCloseTo(0, 10)
  })
})

describe('turntableExtents', () => {
  it('sweeps a unit cube to its horizontal diagonal at elevation 0', () => {
    const b = viewBasis(0, 0)
    const e = turntableExtents([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], b)
    // A corner is √(0.5²+0.5²) ≈ 0.7071 from the spin axis; the 5° sampling
    // lands exactly on the 45° pose, so the bound is exact.
    expect(e.vx[0]).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(e.vx[1]).toBeCloseTo(Math.SQRT1_2, 6)
    // Height is unaffected by a yaw spin at zero elevation.
    expect(e.vy[0]).toBeCloseTo(-0.5, 6)
    expect(e.vy[1]).toBeCloseTo(0.5, 6)
  })

  it('is measured about the box center, wherever the box sits', () => {
    const b = viewBasis(LIVE_AZIMUTH_DEG, LIVE_ELEVATION_DEG)
    const centered = turntableExtents([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], b)
    const offset = turntableExtents([9.5, 99.5, -20.5], [10.5, 100.5, -19.5], b)
    expect(offset.center).toEqual([10, 100, -20])
    expect(offset.vx[0]).toBeCloseTo(centered.vx[0], 6)
    expect(offset.vx[1]).toBeCloseTo(centered.vx[1], 6)
    expect(offset.vy[0]).toBeCloseTo(centered.vy[0], 6)
    expect(offset.vy[1]).toBeCloseTo(centered.vy[1], 6)
  })

  it('an explicit pivot widens the sweep of an off-axis box', () => {
    // A unit cube 2 m from the pivot sweeps a ~2.7 m-radius annulus — the
    // frustum must budget for the orbit, not just the box's own diagonal.
    const b = viewBasis(0, 0)
    const own = turntableExtents([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], b)
    const orbiting = turntableExtents([1.5, -0.5, -0.5], [2.5, 0.5, 0.5], b, 5, [0, 0, 0])
    expect(orbiting.center).toEqual([0, 0, 0])
    const rMax = Math.hypot(2.5, 0.5) // farthest corner from the axis
    expect(orbiting.vx[1]).toBeCloseTo(rMax, 2)
    expect(orbiting.vx[1]).toBeGreaterThan(own.vx[1] * 3)
  })

  it('a tilted view sees some swept width in its vertical extent', () => {
    // With elevation, the horizontal sweep leaks into view-space Y — the
    // frustum must account for it or the model clips top/bottom mid-spin.
    const flat = turntableExtents([-1, 0, -0.1], [1, 0.2, 0.1], viewBasis(35, 0))
    const tilted = turntableExtents([-1, 0, -0.1], [1, 0.2, 0.1], viewBasis(35, 30))
    const flatH = flat.vy[1] - flat.vy[0]
    const tiltedH = tilted.vy[1] - tilted.vy[0]
    expect(tiltedH).toBeGreaterThan(flatH)
  })
})

describe('liveFrustum', () => {
  const b = viewBasis(LIVE_AZIMUTH_DEG, LIVE_ELEVATION_DEG)
  const ext = turntableExtents([-0.4, 0, -0.1], [0.5, 1.2, 0.1], b)

  it('keeps the frustum aspect equal to the viewport aspect', () => {
    const f = liveFrustum(ext, 1280, 720)
    expect((f.right - f.left) / (f.top - f.bottom)).toBeCloseTo(1280 / 720, 6)
  })

  it('fills exactly the fill fraction on the constraining axis', () => {
    const f = liveFrustum(ext, 1280, 720)
    const padded = {
      w: (ext.vx[1] - ext.vx[0]) + 2 * LIVE_PAD_FRAC * Math.max(ext.vx[1] - ext.vx[0], ext.vy[1] - ext.vy[0]),
      h: (ext.vy[1] - ext.vy[0]) + 2 * LIVE_PAD_FRAC * Math.max(ext.vx[1] - ext.vx[0], ext.vy[1] - ext.vy[0]),
    }
    const fillW = padded.w / (f.right - f.left)
    const fillH = padded.h / (f.top - f.bottom)
    expect(Math.max(fillW, fillH)).toBeCloseTo(LIVE_FILL_FRAC, 6)
    expect(fillW).toBeLessThanOrEqual(LIVE_FILL_FRAC + 1e-9)
    expect(fillH).toBeLessThanOrEqual(LIVE_FILL_FRAC + 1e-9)
  })

  it('centers the frustum on the swept content, not the pivot', () => {
    const f = liveFrustum(ext, 1000, 1000)
    expect((f.left + f.right) / 2).toBeCloseTo((ext.vx[0] + ext.vx[1]) / 2, 6)
    expect((f.top + f.bottom) / 2).toBeCloseTo((ext.vy[0] + ext.vy[1]) / 2, 6)
  })

  it('survives a degenerate box or viewport without NaN', () => {
    const point = turntableExtents([0, 0, 0], [0, 0, 0], b)
    const f = liveFrustum(point, 800, 600)
    expect(Number.isFinite(f.left)).toBe(true)
    expect(f.right).toBeGreaterThan(f.left)
    const g = liveFrustum(ext, 0, 0)
    expect(Number.isFinite(g.left)).toBe(true)
    expect(g.right).toBeGreaterThan(g.left)
  })
})
