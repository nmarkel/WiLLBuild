import { describe, expect, it } from 'vitest'
import {
  fitScale,
  nightLight,
  LENS_DIAMETER_M,
  BLOOM_DIAMETER_M,
  POOL_RX_M,
  POOL_RY_M,
} from './snapshot'

describe('fitScale', () => {
  it('fits a wide layout by width, centering vertically', () => {
    // 1920x1080 canvas, 6% margin → usable 1689.6 x 950.4
    const { scale, offsetX, offsetY } = fitScale({ width: 1600, height: 400 }, 1920, 1080)
    expect(scale).toBeCloseTo(1689.6 / 1600, 5)
    expect(offsetX).toBeCloseTo((1920 - 1600 * scale) / 2, 5)
    expect(offsetY).toBeCloseTo((1080 - 400 * scale) / 2, 5)
  })

  it('fits a tall layout (a pole) by height, centering horizontally', () => {
    const { scale, offsetX, offsetY } = fitScale({ width: 200, height: 3000 }, 1920, 1080)
    expect(scale).toBeCloseTo(950.4 / 3000, 5)
    expect(offsetX).toBeCloseTo((1920 - 200 * scale) / 2, 5)
    expect(offsetY).toBeCloseTo((1080 - 3000 * scale) / 2, 5)
  })

  it('centers the layout exactly (offsets are symmetric margins)', () => {
    const { scale, offsetX, offsetY } = fitScale({ width: 400, height: 300 }, 1920, 1080)
    // Scaled content plus both offsets should exactly fill the canvas.
    expect(offsetX * 2 + 400 * scale).toBeCloseTo(1920, 5)
    expect(offsetY * 2 + 300 * scale).toBeCloseTo(1080, 5)
  })

  it('returns scale 1 for a degenerate zero-size layout instead of dividing by zero', () => {
    const { scale } = fitScale({ width: 0, height: 0 }, 1920, 1080)
    expect(Number.isFinite(scale)).toBe(true)
  })
})

describe('nightLight geometry', () => {
  // Fixture light at x=300px, y=100px; ground line at y=800px; 180 px per meter.
  const light = nightLight([300, 100], 800, 180)

  it('places the lens at the fixture light and sizes it to the real lens', () => {
    expect(light.lens.x).toBe(300)
    expect(light.lens.y).toBe(100)
    expect(light.lens.d).toBeCloseTo(LENS_DIAMETER_M * 180, 5)
  })

  it('gives a small bloom around the lens (not a big disc)', () => {
    expect(light.bloom.d).toBeCloseTo(BLOOM_DIAMETER_M * 180, 5)
    // Bloom stays modest — well under a meter diameter, hugging the lens.
    expect(BLOOM_DIAMETER_M).toBeLessThan(1)
  })

  it('grounds the pool on the ground line, wide and flattened', () => {
    expect(light.pool.x).toBe(300)
    expect(light.pool.y).toBe(800) // ground line, NOT the fixture height
    expect(light.pool.rx).toBeCloseTo(POOL_RX_M * 180, 5)
    expect(light.pool.ry).toBeCloseTo(POOL_RY_M * 180, 5)
    // Ground pool reads as ground: much wider than it is deep.
    expect(light.pool.rx).toBeGreaterThan(light.pool.ry * 2)
  })

  it('the pool is the dominant cue — wider than the lens/bloom by a lot', () => {
    expect(light.pool.rx * 2).toBeGreaterThan(light.lens.d * 5)
    expect(light.pool.rx * 2).toBeGreaterThan(light.bloom.d * 3)
  })

  it('makes a downward cone: narrow apex at the lens, widening to the pool', () => {
    // Beam spans from the lens height down to the ground line.
    expect(light.beam.top).toBe(100)
    expect(light.beam.height).toBe(700)
    // Box width equals the pool diameter (base of the cone).
    expect(light.beam.width).toBeCloseTo(light.pool.rx * 2, 5)
    expect(light.beam.left).toBeCloseTo(300 - light.pool.rx, 5)
    // Apex is a small fraction of the base → the cone tapers upward.
    expect(light.beam.apexHalfPct).toBeGreaterThan(0)
    expect(light.beam.apexHalfPct).toBeLessThan(10)
  })

  it('clamps a fixture at/below the ground line to a zero-height beam', () => {
    const flat = nightLight([300, 800], 800, 180)
    expect(flat.beam.height).toBe(0)
    const below = nightLight([300, 900], 800, 180)
    expect(below.beam.height).toBe(0)
  })
})
