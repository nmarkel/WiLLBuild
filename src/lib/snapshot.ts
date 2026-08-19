import type { CompositeLayout } from './composite'
import { renderUrl } from './renders'

/** Minimum PNG dimensions for the Product Render card / herocard+spec+bundle renderPng. */
export const SNAPSHOT_WIDTH = 1920
export const SNAPSHOT_HEIGHT = 1080

const MARGIN_FRAC = 0.06
const HUMAN_HEIGHT_M = 1.83
const HUMAN_WORLD_X_M = 1.4

/**
 * Night fixture-light sizing, in real meters (converted to pixels via the
 * rig's pxPerMeterY). The illumination cue is a downward spotlight CONE onto a
 * warm ground POOL — NOT a big self-lit disc. The lens is a small emissive
 * element with a small soft bloom; the pool does the lighting work.
 * Shared by the live viewer (CompositeViewer + index.css) and this PNG export
 * so both read identically.
 */
export const LENS_DIAMETER_M = 0.16 // believable small lens, sized to the real lens
export const BLOOM_DIAMETER_M = 0.55 // small soft glow around the lens (used sparingly)
export const POOL_RX_M = 1.7 // ground pool half-width (bright center, soft falloff)
export const POOL_RY_M = 0.5 // pool half-depth — flattened ellipse read as ground

/** Warm ~2700–3000K palette — warm white/amber, never saturated cartoon yellow. */
export const WARM_LENS = 'rgba(255, 240, 214, 1)'
export const WARM_BLOOM_IN = 'rgba(255, 232, 198, 0.7)'
export const WARM_BLOOM_OUT = 'rgba(255, 232, 198, 0)'
export const WARM_POOL_IN = 'rgba(255, 214, 158, 0.5)'
export const WARM_POOL_OUT = 'rgba(255, 196, 130, 0)'
export const WARM_BEAM_TOP = 'rgba(255, 226, 182, 0.22)'
export const WARM_BEAM_BOTTOM = 'rgba(255, 212, 152, 0.02)'

export interface FitScale {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Pure geometry of the night spotlight, in the SAME coordinate space as its
 * inputs (i.e. `lightPx`/`groundY` in stage pixels → all outputs in stage
 * pixels). The live viewer consumes these directly; the PNG export maps them
 * through its own fit scale. Keeping it pure makes the make-or-break sizing
 * (small lens, wide ground pool, tapering beam) unit-testable.
 */
export interface NightLight {
  lens: { x: number; y: number; d: number }
  bloom: { x: number; y: number; d: number }
  pool: { x: number; y: number; rx: number; ry: number }
  /** Downward cone bounding box + apex half-width as a % of that box's width. */
  beam: { left: number; top: number; width: number; height: number; apexHalfPct: number }
}

export function nightLight(
  lightPx: [number, number],
  groundY: number,
  pxPerMeterY: number,
): NightLight {
  const [lx, ly] = lightPx
  const lensD = LENS_DIAMETER_M * pxPerMeterY
  const bloomD = BLOOM_DIAMETER_M * pxPerMeterY
  const poolRx = POOL_RX_M * pxPerMeterY
  const poolRy = POOL_RY_M * pxPerMeterY
  const apexHalf = (LENS_DIAMETER_M / 2) * pxPerMeterY
  const beamWidth = poolRx * 2
  const beamHeight = Math.max(0, groundY - ly)
  return {
    lens: { x: lx, y: ly, d: lensD },
    bloom: { x: lx, y: ly, d: bloomD },
    pool: { x: lx, y: groundY, rx: poolRx, ry: poolRy },
    beam: {
      left: lx - poolRx,
      top: ly,
      width: beamWidth,
      height: beamHeight,
      apexHalfPct: beamWidth > 0 ? (apexHalf / beamWidth) * 100 : 0,
    },
  }
}

/**
 * Pure: scale factor + centered offset to fit a `width x height` layout box
 * into a `minW x minH` canvas with a 6% margin on every side.
 */
export function fitScale(
  layout: { width: number; height: number },
  minW: number,
  minH: number,
): FitScale {
  const usableW = minW * (1 - 2 * MARGIN_FRAC)
  const usableH = minH * (1 - 2 * MARGIN_FRAC)
  const scale =
    layout.width > 0 && layout.height > 0
      ? Math.min(usableW / layout.width, usableH / layout.height)
      : 1
  return {
    scale,
    offsetX: (minW - layout.width * scale) / 2,
    offsetY: (minH - layout.height * scale) / 2,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load render asset: ${src}`))
    img.src = src
  })
}

/**
 * Render a composed assembly layout to a PNG blob for the Product Render card
 * and the herocard/spec/bundle `renderPng`. Day background is Gunmetal Silver;
 * night dims the layers and adds a warm fixture glow + ground pool. Never
 * throws — returns null when there is nothing to draw or canvas 2D is
 * unavailable (e.g. an image fails to load), so callers can fall back to the
 * "coming soon" card treatment used elsewhere in the output tray.
 */
export async function compositeToBlob(
  layout: CompositeLayout,
  opts: { night: boolean; pxPerMeterY: number; showScale?: boolean },
): Promise<Blob | null> {
  if (layout.layers.length === 0) return null

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SNAPSHOT_WIDTH
    canvas.height = SNAPSHOT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.fillStyle = opts.night ? '#111318' : '#e6e7e8'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const { scale, offsetX, offsetY } = fitScale(layout, canvas.width, canvas.height)
    const toCanvas = (x: number, y: number): [number, number] => [
      offsetX + x * scale,
      offsetY + y * scale,
    ]

    // Night light: the warm ground POOL + downward spotlight cone are drawn
    // BEFORE the layers (so the pole/fixture occlude them, reading as light in
    // the scene rather than a sticker on top). No self-lit lens "ball" at the
    // head — the illumination comes entirely from the pool + cone. This is a
    // conceptual LOOK, not a photometric result — the disclaimer stays in the UI.
    // One glow per fixture so twin/triple/quad poles light from every arm.
    const lightPoints = layout.lightPxs ?? (layout.lightPx ? [layout.lightPx] : [])
    const lights = opts.night
      ? lightPoints.map((p) => nightLight(p, layout.origin[1], opts.pxPerMeterY))
      : []

    for (const light of lights) {
      // 1. Warm ground pool — the primary illumination cue, brightest at
      //    center with soft radial falloff.
      const [px, py] = toCanvas(light.pool.x, light.pool.y)
      const poolRX = light.pool.rx * scale
      const poolRY = light.pool.ry * scale
      const pool = ctx.createRadialGradient(px, py, 0, px, py, poolRX)
      pool.addColorStop(0, WARM_POOL_IN)
      pool.addColorStop(1, WARM_POOL_OUT)
      ctx.save()
      ctx.fillStyle = pool
      ctx.beginPath()
      ctx.ellipse(px, py, poolRX, poolRY, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // 2. Downward spotlight cone: narrow at the lens, widening to the pool.
      if (light.beam.height > 0) {
        const { left, top, width, height, apexHalfPct } = light.beam
        const apexL = toCanvas(left + (width * (50 - apexHalfPct)) / 100, top)
        const apexR = toCanvas(left + (width * (50 + apexHalfPct)) / 100, top)
        const baseL = toCanvas(left, top + height)
        const baseR = toCanvas(left + width, top + height)
        const beam = ctx.createLinearGradient(0, apexL[1], 0, baseL[1])
        beam.addColorStop(0, WARM_BEAM_TOP)
        beam.addColorStop(1, WARM_BEAM_BOTTOM)
        ctx.save()
        ctx.fillStyle = beam
        ctx.beginPath()
        ctx.moveTo(apexL[0], apexL[1])
        ctx.lineTo(apexR[0], apexR[1])
        ctx.lineTo(baseR[0], baseR[1])
        ctx.lineTo(baseL[0], baseL[1])
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }

    // Soft ground-shadow ellipse under the assembly.
    const [ox, oy] = toCanvas(layout.origin[0], layout.origin[1])
    const shadowRX = 110 * scale + 50
    const shadowRY = shadowRX * 0.28
    ctx.save()
    ctx.globalAlpha = opts.night ? 0.35 : 0.2
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.ellipse(ox, oy, shadowRX, shadowRY, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Layers arrive already z-sorted (pole < baseCover < arm < fixture).
    const images = await Promise.all(
      layout.layers.map((l) => loadImage(renderUrl(l.asset.file))),
    )

    /** Phase 0.17: multiply a layer's neutral render by a hex, alpha kept. */
    function tintImage(img: HTMLImageElement, hex: string): HTMLCanvasElement {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const tctx = c.getContext('2d')!
      tctx.drawImage(img, 0, 0)
      tctx.globalCompositeOperation = 'multiply'
      tctx.fillStyle = hex
      tctx.fillRect(0, 0, c.width, c.height)
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(img, 0, 0)
      return c
    }

    ctx.save()
    if (opts.night) ctx.filter = 'brightness(0.42) saturate(0.8)'
    layout.layers.forEach((layer, i) => {
      const [x, y] = toCanvas(layer.left, layer.top)
      // Phase 0.17: custom-RAL layers tint their neutral render by the
      // customer's hex — same multiply → destination-in sequence as the
      // viewer's TintedLayer, so the PNG matches the screen.
      const source = layer.tint ? tintImage(images[i], layer.tint) : images[i]
      ctx.drawImage(source, x, y, layer.asset.width * scale, layer.asset.height * scale)
    })
    ctx.restore()

    if (opts.showScale) {
      const groundX = layout.origin[0] + HUMAN_WORLD_X_M * opts.pxPerMeterY
      const heightPx = HUMAN_HEIGHT_M * opts.pxPerMeterY
      const [gx, gy] = toCanvas(groundX, layout.origin[1])
      const bodyH = heightPx * scale
      const headR = bodyH * 0.09
      const bodyW = bodyH * 0.16

      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#8a8d92'
      ctx.strokeStyle = '#8a8d92'
      ctx.lineWidth = bodyW
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(gx, gy)
      ctx.lineTo(gx, gy - bodyH + headR * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(gx, gy - bodyH + headR, headR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}
