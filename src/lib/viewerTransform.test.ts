import { describe, it, expect } from 'vitest'
import { clampPan } from './viewerTransform'

// A product box taller than the viewport (typical zoomed-in pole): foot near
// the bottom of the box (origin y large), so the fixture sits well above.
const box = { width: 400, height: 1200, origin: [200, 1150] as [number, number] }
const viewport = { w: 1200, h: 800 }
const base = { zoom: 2, scale: 1.5, box, viewport, horizonFrac: 0.8 }

describe('clampPan', () => {
  it('allows placement panning at fit and below (Phase 0.10.5), still bounded', () => {
    // Dragging at any zoom places the product in the backdrop photo — a small
    // pan passes through unchanged even at fit.
    expect(clampPan({ x: 50, y: -30 }, { ...base, zoom: 1, scale: 0.6 })).toEqual({ x: 50, y: -30 })
    const flung = clampPan({ x: 100000, y: 0 }, { ...base, zoom: 0.6, scale: 0.4 })
    expect(flung.x).toBeLessThan(100000)
  })

  it('returns {0,0} when the viewport has no size yet', () => {
    expect(clampPan({ x: 500, y: 500 }, { ...base, viewport: { w: 0, h: 0 } })).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('leaves a small in-bounds pan unchanged when zoomed in', () => {
    const p = { x: 20, y: 30 }
    expect(clampPan(p, base)).toEqual(p)
  })

  it('clamps a huge pan so the product cannot be flung out of the viewport', () => {
    const flung = clampPan({ x: 100000, y: 100000 }, base)
    // The clamped foot (viewport centre + pan) must keep the product box
    // overlapping the viewport — never entirely off-screen.
    const footX = viewport.w / 2 + flung.x
    const footY = viewport.h * base.horizonFrac + flung.y
    const left = footX - base.scale * box.origin[0]
    const right = footX + base.scale * (box.width - box.origin[0])
    const top = footY - base.scale * box.origin[1]
    const bottom = footY + base.scale * (box.height - box.origin[1])
    // At least part of the box stays within the viewport on each axis.
    expect(right).toBeGreaterThan(0)
    expect(left).toBeLessThan(viewport.w)
    expect(bottom).toBeGreaterThan(0)
    expect(top).toBeLessThan(viewport.h)
  })

  it('clamps X symmetrically (foot horizontally centred in the box)', () => {
    const pos = clampPan({ x: 100000, y: 0 }, base)
    const neg = clampPan({ x: -100000, y: 0 }, base)
    expect(pos.x).toBeCloseTo(-neg.x, 5)
  })

  it('allows more downward pan than upward (foot near the bottom of a tall box)', () => {
    // Panning down (+y) reveals the tall upper pole/fixture, so its range is
    // larger than the small upward range — asymmetry is expected, not a bug.
    const down = clampPan({ x: 0, y: 100000 }, base)
    const up = clampPan({ x: 0, y: -100000 }, base)
    expect(down.y).toBeGreaterThan(Math.abs(up.y))
  })
})
