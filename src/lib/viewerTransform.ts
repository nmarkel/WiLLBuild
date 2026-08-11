/**
 * Pure viewer pan/zoom bounds for the compositing viewer.
 *
 * The product's foot is pinned to the shared horizon at (viewport.w/2,
 * viewport.h·horizonFrac); zoom scales about that foot and `pan` nudges it for
 * inspection. Without bounds the product can be dragged out of view and left
 * stuck (dragging is disabled at fit, so only Reset recovers it). `clampPan`
 * makes the displayed offset a bounded, self-healing function of state:
 *
 *   - pan works at ANY zoom (Phase 0.10.5: dragging the product places it in the
 *     backdrop photo), clamped so the scaled product box always keeps a margin
 *     of overlap with the viewport — you can put the pole anywhere in frame
 *     but never fling it off-screen; Reset restores grounded/centred.
 *
 * Deriving the effective pan every render (rather than mutating stored pan)
 * means the view can never get into a stuck state regardless of the order of
 * zoom/pan/reset interactions.
 */

// Phase 0.10.5: zoom doubles as the product's SCALE within the backdrop photo
// (the backdrop never scales) — 0.2x places a pole far down a lot, 10x is close
// detail. clampPan keeps the product on screen; Reset restores the grounded,
// centred, true-scale view.
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 10

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export interface ViewTransform {
  zoom: number
  pan: { x: number; y: number }
}

/**
 * Re-express a screen-space pan for a new zoom level.
 *
 * `pan` is stored in screen pixels but the pannable range is proportional to
 * the applied scale (see `clampPan`: the bounds work out to +/- scale x the
 * product's half-extent). Holding a raw pixel pan constant across a zoom change
 * therefore means the SAME pan is a nudge when zoomed in and a hard boundary
 * pin when zoomed out — the product ends up jammed against the edge of its
 * allowed range at every lower zoom level and only Reset recovers it. That is
 * the "stuck off-centre after zooming back out" half of the recurring zoom bug.
 *
 * Scaling the pan with the zoom ratio fixes both directions at once:
 *   - zooming out walks the product proportionally back toward the centre
 *     instead of leaving it pinned to a stale, larger-zoom boundary;
 *   - zooming in keeps the layout point the user dragged under the pin, so the
 *     product no longer drifts out from under the cursor as you magnify.
 */
export function renormalizePan(
  pan: { x: number; y: number },
  fromZoom: number,
  toZoom: number,
): { x: number; y: number } {
  if (!(fromZoom > 0) || !Number.isFinite(toZoom)) return pan
  const ratio = toZoom / fromZoom
  return { x: pan.x * ratio, y: pan.y * ratio }
}

/**
 * One zoom step — the single transition used by BOTH the wheel and the +/-
 * buttons, so they can never drift apart. Clamps the zoom to [MIN_ZOOM,
 * MAX_ZOOM] and renormalises the pan alongside it.
 *
 * Callers pass the CLAMPED (on-screen) pan, not the raw stored pan: writing the
 * result back is what stops an out-of-bounds pan from surviving a zoom change.
 */
export function zoomStep(view: ViewTransform, factor: number): ViewTransform {
  const zoom = clampZoom(view.zoom * factor)
  if (zoom === view.zoom) return view
  return { zoom, pan: renormalizePan(view.pan, view.zoom, zoom) }
}

/**
 * Phase 0.11 (Workstream E) — the zoom/pan that frames one component.
 *
 * The other half of the Tesla view set: 2 full-assembly views plus tight
 * per-component shots. A focus is a CAMERA move over the already-composited
 * layers (see `focusBox` in lib/composite.ts for why it is not a new render),
 * so it reduces to "pick a zoom that makes the target fill the frame, and a
 * pan that puts the target's centre at the viewport centre".
 *
 * Solving against the same pin the viewer draws with
 * (`screen = (W/2, H·horizonFrac) − scale·origin + pan + scale·local`):
 *   target centre → viewport centre
 *   ⇒ panX = scale·(originX − cx)
 *     panY = H/2 − H·horizonFrac + scale·(originY − cy)
 *
 * The result always satisfies `clampPan` — its bounds are ±scale × the box's
 * own extents from the foot, and a point inside the box is by definition
 * within them — so a focus can never be clipped into a wrong framing.
 */
export interface FocusFrameOpts {
  /** Scale at which the whole assembly fits the viewport (zoom === 1). */
  fitScale: number
  /** The full assembly box, in layout pixel space. */
  box: { width: number; height: number; origin: [number, number] }
  viewport: { w: number; h: number }
  horizonFrac: number
  /** Fraction of the viewport the focused region should fill. */
  fillFrac?: number
}

/** How much of the frame a focused component takes up. */
const FOCUS_FILL_FRAC = 0.8

export function focusFrame(
  target: { left: number; top: number; width: number; height: number },
  opts: FocusFrameOpts,
): ViewTransform {
  const { fitScale, box, viewport, horizonFrac } = opts
  const fill = opts.fillFrac ?? FOCUS_FILL_FRAC
  if (viewport.w <= 0 || viewport.h <= 0 || target.width <= 0 || target.height <= 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } }
  }
  if (!(fitScale > 0) || !Number.isFinite(fitScale)) return { zoom: 1, pan: { x: 0, y: 0 } }

  const scaleWanted = Math.min(
    (viewport.w * fill) / target.width,
    (viewport.h * fill) / target.height,
  )
  const zoom = clampZoom(scaleWanted / fitScale)
  const scale = fitScale * zoom
  const cx = target.left + target.width / 2
  const cy = target.top + target.height / 2
  return {
    zoom,
    pan: {
      x: scale * (box.origin[0] - cx),
      y: viewport.h / 2 - viewport.h * horizonFrac + scale * (box.origin[1] - cy),
    },
  }
}

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
