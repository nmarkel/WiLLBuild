/**
 * Pure viewer pan/zoom bounds for the compositing viewer.
 *
 * The product's foot is pinned to the shared horizon at (viewport.w/2,
 * viewport.h·horizonFrac); zoom scales about that foot and `pan` nudges it for
 * inspection. Without bounds the product can be dragged out of view and left
 * stuck (dragging is disabled at fit, so only Reset recovers it). `clampPan`
 * makes the displayed offset a bounded, self-healing function of state:
 *
 *   - pan works at ANY zoom (Phase 1.0: dragging the product places it in the
 *     backdrop photo), clamped so the scaled product box always keeps a margin
 *     of overlap with the viewport — you can put the pole anywhere in frame
 *     but never fling it off-screen; Reset restores grounded/centred.
 *
 * Deriving the effective pan every render (rather than mutating stored pan)
 * means the view can never get into a stuck state regardless of the order of
 * zoom/pan/reset interactions.
 */

export interface PanClampOpts {
  /** Current zoom multiplier (1 === fitted). */
  zoom: number
  /** Effective scale actually applied to the layout (fitScale · zoom). */
  scale: number
  /** Layout box in its own pixel space, with the foot at `origin`. */
  box: { width: number; height: number; origin: [number, number] }
  /** Live viewport size in CSS px. */
  viewport: { w: number; h: number }
  /** Foot pin as a fraction of viewport height (matches HORIZON_FRAC). */
  horizonFrac: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Half the viewport may sit empty on any side — the rest always shows product. */
const KEEP_MARGIN_FRAC = 0.5

export function clampPan(
  pan: { x: number; y: number },
  opts: PanClampOpts,
): { x: number; y: number } {
  const { scale, box, viewport, horizonFrac } = opts
  if (viewport.w <= 0 || viewport.h <= 0) return { x: 0, y: 0 }

  // Product box edges in screen space at pan = 0 (foot pinned to the horizon).
  const footX = viewport.w / 2
  const footY = viewport.h * horizonFrac
  const left = footX - scale * box.origin[0]
  const right = footX + scale * (box.width - box.origin[0])
  const top = footY - scale * box.origin[1]
  const bottom = footY + scale * (box.height - box.origin[1])

  const marginX = viewport.w * KEEP_MARGIN_FRAC
  const marginY = viewport.h * KEEP_MARGIN_FRAC

  // Keep the box overlapping the viewport: its right edge can't move left of
  // marginX, nor its left edge right of (W - marginX); likewise on Y.
  const loX = marginX - right
  const hiX = viewport.w - marginX - left
  const loY = marginY - bottom
  const hiY = viewport.h - marginY - top

  return {
    x: clamp(pan.x, Math.min(loX, hiX), Math.max(loX, hiX)),
    y: clamp(pan.y, Math.min(loY, hiY), Math.max(loY, hiY)),
  }
}
