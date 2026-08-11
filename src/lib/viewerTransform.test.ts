import { describe, it, expect } from 'vitest'
import {
  clampPan,
  clampZoom,
  focusFrame,
  renormalizePan,
  zoomStep,
  MAX_ZOOM,
  MIN_ZOOM,
} from './viewerTransform'

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

describe('clampZoom', () => {
  it('holds the zoom inside the configured range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(1e6)).toBe(MAX_ZOOM)
  })
})

describe('renormalizePan', () => {
  it('scales the pan with the zoom ratio', () => {
    expect(renormalizePan({ x: 400, y: -200 }, 4, 1)).toEqual({ x: 100, y: -50 })
    expect(renormalizePan({ x: 100, y: -50 }, 1, 4)).toEqual({ x: 400, y: -200 })
  })

  it('is a no-op at the same zoom and for a zero pan', () => {
    expect(renormalizePan({ x: 37, y: -12 }, 2, 2)).toEqual({ x: 37, y: -12 })
    expect(renormalizePan({ x: 0, y: 0 }, 8, 0.5)).toEqual({ x: 0, y: 0 })
  })

  it('refuses to divide by a non-positive starting zoom', () => {
    expect(renormalizePan({ x: 40, y: 40 }, 0, 2)).toEqual({ x: 40, y: 40 })
  })
})

describe('zoomStep', () => {
  it('clamps the zoom and stops dead at the limits', () => {
    expect(zoomStep({ zoom: 1, pan: { x: 0, y: 0 } }, 2).zoom).toBe(2)
    expect(zoomStep({ zoom: MAX_ZOOM, pan: { x: 5, y: 5 } }, 2)).toEqual({
      zoom: MAX_ZOOM,
      pan: { x: 5, y: 5 },
    })
    expect(zoomStep({ zoom: MIN_ZOOM, pan: { x: 5, y: 5 } }, 0.5).zoom).toBe(MIN_ZOOM)
  })

  /**
   * Regression (Phase 0.11, Workstream E): zooming used to change `zoom` alone
   * and leave the stored pan untouched. Because clampPan's bounds are
   * proportional to the applied scale, a pan chosen while zoomed in then
   * exceeds the bounds at every lower zoom, so the product sits jammed against
   * the edge of its range and only Reset recovers it.
   */
  it('renormalises the pan so zooming out un-pins the product from a stale boundary', () => {
    const zoomedIn = { zoom: 4, pan: { x: -180, y: 0 } }
    const opts = { ...base, zoom: 4, scale: 3, box, viewport }
    // The pan is comfortably inside the bounds at high zoom.
    expect(clampPan(zoomedIn.pan, opts)).toEqual(zoomedIn.pan)

    const zoomedOut = zoomStep(zoomedIn, 0.25)
    expect(zoomedOut.zoom).toBe(1)
    expect(zoomedOut.pan).toEqual({ x: -45, y: 0 })

    const lowOpts = { ...base, zoom: 1, scale: 0.75, box, viewport }
    const fixed = clampPan(zoomedOut.pan, lowOpts)
    const stale = clampPan(zoomedIn.pan, lowOpts) // what shipping code used to show

    // Old behaviour pinned the product to the boundary; the fix leaves it
    // strictly inside, proportionally closer to centre.
    const boundX = base.scale === 0 ? 0 : lowOpts.scale * (box.width - box.origin[0])
    expect(Math.abs(stale.x)).toBeCloseTo(boundX, 6)
    expect(Math.abs(fixed.x)).toBeLessThan(Math.abs(stale.x))
    expect(fixed.x).toBe(-45)
  })

  it('keeps a renormalised pan inside the bounds it started inside', () => {
    const start = { zoom: 4, pan: { x: -180, y: 60 } }
    for (const factor of [0.25, 0.5, 2, 100]) {
      const next = zoomStep(start, factor)
      const opts = { ...base, zoom: next.zoom, scale: 0.75 * next.zoom, box, viewport }
      expect(clampPan(next.pan, opts)).toEqual(next.pan)
    }
  })

  it('round-trips: zoom in then back out returns the original pan', () => {
    const start = { zoom: 1, pan: { x: -45, y: 17 } }
    const there = zoomStep(start, 4)
    const back = zoomStep(there, 0.25)
    expect(back.zoom).toBe(start.zoom)
    expect(back.pan.x).toBeCloseTo(start.pan.x, 10)
    expect(back.pan.y).toBeCloseTo(start.pan.y, 10)
  })
})

/**
 * Phase 0.11 (Workstream E) — the component focus views.
 *
 * `focusFrame` is the whole camera move, so it is tested here rather than only
 * eyeballed in a browser. The load-bearing property is the last one: a focus
 * must survive `clampPan` unchanged, or the component ends up off-centre and
 * the feature quietly doesn't work.
 */
describe('focusFrame (Phase 0.11 E)', () => {
  // A 20 ft pole-ish box: tall, narrow, foot at the bottom-centre.
  const box = { width: 400, height: 2200, origin: [200, 2200] as [number, number] }
  const viewport = { w: 1000, h: 800 }
  const horizonFrac = 0.72
  const base = { fitScale: 0.25, box, viewport, horizonFrac }

  // The fixture: a small region near the top of the assembly.
  const fixtureBox = { left: 150, top: 60, width: 260, height: 240 }

  it('zooms in so the target fills most of the frame', () => {
    // fitScale 0.5 keeps the wanted zoom (5.3x) under MAX_ZOOM, so this
    // measures the framing rule itself rather than the clamp.
    const opts = { ...base, fitScale: 0.5 }
    const { zoom } = focusFrame(fixtureBox, opts)
    const scale = opts.fitScale * zoom
    const covered = Math.max(
      (scale * fixtureBox.width) / viewport.w,
      (scale * fixtureBox.height) / viewport.h,
    )
    expect(covered).toBeCloseTo(0.8, 6)
    expect(zoom).toBeGreaterThan(1)
  })

  it('a tiny target on a small fitScale is capped by MAX_ZOOM, not over-zoomed', () => {
    // fitScale 0.25 wants 10.7x for this fixture; the cap binds, so the
    // component fills a bit less of the frame rather than exceeding the limit.
    const { zoom } = focusFrame(fixtureBox, base)
    expect(zoom).toBe(MAX_ZOOM)
    const covered = (base.fitScale * zoom * fixtureBox.height) / viewport.h
    expect(covered).toBeCloseTo(0.75, 6)
  })

  it('puts the target centre at the viewport centre', () => {
    const { zoom, pan } = focusFrame(fixtureBox, base)
    const scale = base.fitScale * zoom
    const cx = fixtureBox.left + fixtureBox.width / 2
    const cy = fixtureBox.top + fixtureBox.height / 2
    // Same pin the viewer draws with (see CompositeViewer's stageTransform).
    const screenX = viewport.w / 2 - scale * box.origin[0] + pan.x + scale * cx
    const screenY = viewport.h * horizonFrac - scale * box.origin[1] + pan.y + scale * cy
    expect(screenX).toBeCloseTo(viewport.w / 2, 6)
    expect(screenY).toBeCloseTo(viewport.h / 2, 6)
  })

  it('framing the whole assembly is a no-op pan at roughly fit zoom', () => {
    const whole = { left: 0, top: 0, width: box.width, height: box.height }
    const { zoom, pan } = focusFrame(whole, base)
    const scale = base.fitScale * zoom
    const screenX = viewport.w / 2 - scale * box.origin[0] + pan.x + scale * (box.width / 2)
    expect(screenX).toBeCloseTo(viewport.w / 2, 6)
  })

  it('survives clampPan unchanged — a focus is never clipped off-centre', () => {
    // This is the property that makes the feature work at all: clampPan's
    // bounds are ±scale × the box's extents from the foot, and a point inside
    // the box is by definition within them.
    for (const target of [
      fixtureBox,
      { left: 0, top: 900, width: 400, height: 300 }, // an arm, mid-height
      { left: 120, top: 2000, width: 320, height: 200 }, // a base cover, at the foot
    ]) {
      const { zoom, pan } = focusFrame(target, base)
      const scale = base.fitScale * zoom
      expect(clampPan(pan, { zoom, scale, box, viewport, horizonFrac })).toEqual(pan)
    }
  })

  it('never exceeds the zoom limits', () => {
    const speck = { left: 200, top: 100, width: 1, height: 1 }
    expect(focusFrame(speck, base).zoom).toBeLessThanOrEqual(MAX_ZOOM)
    expect(focusFrame(speck, base).zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  })

  it('degrades safely on an unmeasured viewport or empty target', () => {
    expect(focusFrame(fixtureBox, { ...base, viewport: { w: 0, h: 0 } })).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    })
    expect(focusFrame({ left: 0, top: 0, width: 0, height: 0 }, base)).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    })
  })
})
