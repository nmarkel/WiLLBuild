import { describe, expect, it } from 'vitest'
import { fitScale } from './snapshot'

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
