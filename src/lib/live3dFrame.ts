/**
 * Phase 0.15 (Workstream A) — pure camera math for the live 3D focus canvas.
 *
 * The live canvas replaces the image focus crop, so its framing must land where
 * the crop would: same rig view direction (azimuth 35° / elevation 6°), same
 * padding fraction as `focusBox`, same fill fraction as `focusFrame`. Keeping
 * the math here, three-free, means it is unit-tested like the rest of the
 * viewer transforms (this repo has no DOM test infra) and the three-importing
 * canvas component stays a thin shell around it.
 *
 * The model spins on a turntable about its own bounding-box center, so the
 * frustum is sized to the SWEPT extents — the widest the model gets at any yaw
 * — rather than the initial pose. Framing the initial pose would clip a long
 * arm the moment its reach swings toward the camera.
 */

// Mirrors AZIMUTH_DEG / ELEVATION_DEG in scripts/render-rig/page/main.ts — the
// swap is only seamless if the canvas looks along the same rig view direction.
export const LIVE_AZIMUTH_DEG = 35
export const LIVE_ELEVATION_DEG = 6
/** Mirrors FOCUS_FILL_FRAC in viewerTransform.ts. */
export const LIVE_FILL_FRAC = 0.8
/** Mirrors FOCUS_PAD_FRAC in composite.ts (the px floor has no world analog). */
export const LIVE_PAD_FRAC = 0.28

type V3 = [number, number, number]

export interface ViewBasis {
  /** Unit vector from the framed content toward the camera. */
  dir: V3
  /** Camera-space +X (screen right) in world coordinates. */
  right: V3
  /** Camera-space +Y (screen up) in world coordinates. */
  up: V3
}

/**
 * The camera frame for a given azimuth/elevation, with world +Y as the no-roll
 * reference — the same construction three.js performs in lookAt, mirrored from
 * the rig's `cameraBasis()`.
 */
export function viewBasis(
  azimuthDeg: number = LIVE_AZIMUTH_DEG,
  elevationDeg: number = LIVE_ELEVATION_DEG,
): ViewBasis {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const dir: V3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
  // right = worldUp × dir, normalized; up = dir × right.
  const rx = 1 * dir[2] - 0 * dir[1]
  const ry = 0 * dir[0] - 0 * dir[2]
  const rz = 0 * dir[1] - 1 * dir[0]
  const rl = Math.hypot(rx, ry, rz) || 1
  const right: V3 = [rx / rl, ry / rl, rz / rl]
  const up: V3 = [
    dir[1] * right[2] - dir[2] * right[1],
    dir[2] * right[0] - dir[0] * right[2],
    dir[0] * right[1] - dir[1] * right[0],
  ]
  return { dir, right, up }
}

export interface TurntableExtents {
  /** World center of the model's bounding box — the turntable pivot. */
  center: V3
  /** View-space X range relative to the pivot, over a full revolution. */
  vx: [number, number]
  /** View-space Y range relative to the pivot, over a full revolution. */
  vy: [number, number]
}

/**
 * View-space extents of a bounding box spinning about the vertical axis
 * through its own center. Sampled every `stepDeg`; 5° lands exactly on the
 * diagonal poses, so the bound is tight for boxes.
 */
export function turntableExtents(
  min: V3,
  max: V3,
  basis: ViewBasis,
  stepDeg = 5,
): TurntableExtents {
  const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const corners: V3[] = []
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]])
        corners.push([x - center[0], y - center[1], z - center[2]])

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const c = Math.cos((deg * Math.PI) / 180)
    const s = Math.sin((deg * Math.PI) / 180)
    for (const [x, y, z] of corners) {
      const rx = x * c + z * s
      const rz = -x * s + z * c
      const vx = rx * basis.right[0] + y * basis.right[1] + rz * basis.right[2]
      const vy = rx * basis.up[0] + y * basis.up[1] + rz * basis.up[2]
      if (vx < minX) minX = vx
      if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy
      if (vy > maxY) maxY = vy
    }
  }
  return { center, vx: [minX, maxX], vy: [minY, maxY] }
}

export interface OrthoFrustum {
  /** View-space frustum bounds relative to the turntable pivot. */
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * The orthographic frustum that frames the swept extents the way the image
 * focus frames its crop: padded by LIVE_PAD_FRAC of the larger dimension, then
 * filling LIVE_FILL_FRAC of the viewport on the constraining axis, centered on
 * the content.
 */
export function liveFrustum(
  ext: TurntableExtents,
  viewportW: number,
  viewportH: number,
  fillFrac = LIVE_FILL_FRAC,
  padFrac = LIVE_PAD_FRAC,
): OrthoFrustum {
  let w = ext.vx[1] - ext.vx[0]
  let h = ext.vy[1] - ext.vy[0]
  if (!(w > 0) || !(h > 0)) {
    w = Math.max(w, 0.1)
    h = Math.max(h, 0.1)
  }
  const pad = padFrac * Math.max(w, h)
  const paddedW = w + 2 * pad
  const paddedH = h + 2 * pad
  const vw = viewportW > 0 ? viewportW : 1
  const vh = viewportH > 0 ? viewportH : 1
  const worldPerPx = Math.max(paddedW / (vw * fillFrac), paddedH / (vh * fillFrac))
  const cx = (ext.vx[0] + ext.vx[1]) / 2
  const cy = (ext.vy[0] + ext.vy[1]) / 2
  const halfW = (vw / 2) * worldPerPx
  const halfH = (vh / 2) * worldPerPx
  return { left: cx - halfW, right: cx + halfW, top: cy + halfH, bottom: cy - halfH }
}
