import type { CompositeLayout } from './composite'
import {
  DEFAULT_COLOR_TEMP,
  DEFAULT_DISTRIBUTION,
  footprintBands,
  lightRgba,
  type FootprintBand,
} from './distribution'
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
/**
 * How much a ground shape squashes vertically in this view — the pool ellipse's
 * own ry/rx. The isolux contours do NOT use it: they go through the rig's real
 * ground map (see `groundToStage`), because this ratio is a look for the pool
 * rather than the plane the compass ring lies on.
 */
export const GROUND_FLATTEN = POOL_RY_M / POOL_RX_M

/**
 * The isolux contours are drawn at this fraction of their true size.
 *
 * They have to be. The stage is the ASSEMBLY's own box — about 0.9 m wide for a
 * pole build — and the sheet's 2.0 fc contour for a Type IV Medium covers some
 * 40 m of ground, i.e. forty times the frame. Drawn true to scale the pattern
 * is entirely off-stage and reads as a flat wash with no shape at all.
 *
 * One constant for every distribution, so their RELATIVE sizes stay exactly as
 * the sheet plots them; only the common scale is reduced. It is anchored so the
 * default 5M contour lands at about the ground pool's old radius, which is the
 * size the night view was reviewed at. The caption says "not to scale" because
 * of this.
 */
export const GROUND_DIAGRAM_SCALE = 0.12

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
  /**
   * The selected distribution's isolux contours, OUTERMOST FIRST, in GROUND
   * METRES relative to the light's own ground point: `[away-from-pole, lateral]`
   * (Tyler 8/20 — the plot's bottom faces the pole).
   *
   * Metres rather than pixels because the ground plane belongs to the rig's own
   * projection — the same map the compass ring uses — and the caller has it.
   * `groundToStage` below turns a band into stage pixels once given that map.
   */
  bands: FootprintBand[]
}

/**
 * Width/depth ratio of a circle lying on the ground in this view.
 *
 * Sampled from the rig's own map rather than assumed, so the pool sits on the
 * plane the compass ring marks (measured 9.57 for the shipped rig; the pool's
 * old ry/rx of 3.4 read as a second, steeper ground).
 */
export function groundAspect(
  project: (offset: [number, number, number]) => [number, number],
  samples = 32,
): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * Math.PI * 2
    const [x, y] = project([Math.cos(t), 0, Math.sin(t)])
    xs.push(x)
    ys.push(y)
  }
  const width = Math.max(...xs) - Math.min(...xs)
  const depth = Math.max(...ys) - Math.min(...ys)
  return depth > 0 ? width / depth : POOL_RX_M / POOL_RY_M
}

export function nightLight(
  lightPx: [number, number],
  groundY: number,
  pxPerMeterY: number,
  distribution: string = DEFAULT_DISTRIBUTION,
  poleX?: number,
  aspect: number = POOL_RX_M / POOL_RY_M,
): NightLight {
  const [lx, ly] = lightPx
  const lensD = LENS_DIAMETER_M * pxPerMeterY
  const bloomD = BLOOM_DIAMETER_M * pxPerMeterY
  const poolRx = POOL_RX_M * pxPerMeterY
  const poolRy = (POOL_RX_M * pxPerMeterY) / aspect  // the ground's own plane
  const apexHalf = (LENS_DIAMETER_M / 2) * pxPerMeterY
  const beamHeight = Math.max(0, groundY - ly)

  // The mounting height IS the beam height — the distance from the light point
  // down to the ground line — so the sheet's 15 ft contours scale to however
  // high this particular arm carries the fixture.
  const mountingHeightM = pxPerMeterY > 0 ? beamHeight / pxPerMeterY : 0
  // Which way is "away from the pole" on screen: the arm carries the fixture to
  // one side, so the pole's own ground point tells us. Tyler 8/20 wants the
  // plot's bottom edge facing the pole, which is what orients the contour.
  const awaySign = poleX !== undefined && poleX !== lx ? Math.sign(lx - poleX) : 1
  const bands = footprintBands(distribution, mountingHeightM).map((band) => ({
    ...band,
    ground: band.ground.map(
      ([away, lateral]) => [away * awaySign, lateral] as [number, number],
    ),
  }))

  // The cone keeps the reviewed spotlight proportions and only NARROWS to the
  // pool the distribution actually lights — a 70 deg narrow should not show a
  // cone wider than its own pool. Widening it to a Type IV's true 40 m swath
  // would turn the beam into a floor: the contours carry the spread, the cone
  // is what says "light from up there".
  const litRadiusM = bands.length
    ? Math.max(
        ...(bands[bands.length - 1] ?? bands[0]).ground.map(([a, l]) => Math.hypot(a, l)),
      ) * GROUND_DIAGRAM_SCALE
    : POOL_RX_M
  const beamWidth = Math.min(litRadiusM * pxPerMeterY, poolRx) * 2
  return {
    lens: { x: lx, y: ly, d: lensD },
    bloom: { x: lx, y: ly, d: bloomD },
    pool: { x: lx, y: groundY, rx: poolRx, ry: poolRy },
    beam: {
      left: lx - beamWidth / 2,
      top: ly,
      width: beamWidth,
      height: beamHeight,
      apexHalfPct: beamWidth > 0 ? (apexHalf / beamWidth) * 100 : 0,
    },
    bands,
  }
}

/**
 * A band's ground metres as stage pixels, through the rig's own ground map.
 *
 * `project` takes a world offset in metres (+Y up) and returns a PIXEL offset —
 * `projectOffset(manifest, ...)` from `composite.ts`, i.e. exactly what places
 * the ground compass ring. Passing it in keeps this module free of three.js and
 * of a home-made flattening factor, which is what had the light sitting on a
 * different plane from the compass that marks the ground.
 */
export function groundToStage(
  band: FootprintBand,
  origin: [number, number],
  project: (offset: [number, number, number]) => [number, number],
  scale: number = GROUND_DIAGRAM_SCALE,
): Array<[number, number]> {
  return band.ground.map(([away, lateral]) => {
    const [dx, dy] = project([away * scale, 0, lateral * scale])
    return [origin[0] + dx, origin[1] + dy]
  })
}

/**
 * Pure: scale factor + centered offset to fit a `width x height` layout box
 * into a `minW x minH` canvas with a 6% margin on every side.
 */
/**
 * Phase 0.17 (Tyler 8/19, hero-card rework): where each slot's part sits
 * inside the snapshot PNG, normalized 0..1. The concept card draws leader-line
 * callouts at these points — the same "compositor owns geometry, documents
 * consume it" split the viewer's own callouts use, so a label can never point
 * at the wrong place. Uses the SAME fitScale transform compositeToBlob draws
 * with, so the fractions are exact for the file that ships.
 */
export function snapshotAnchors(
  layout: CompositeLayout,
  canvasW: number,
  canvasH: number,
): Record<string, [number, number]> {
  const { scale, offsetX, offsetY } = fitScale(layout, canvasW, canvasH)
  const out: Record<string, [number, number]> = {}
  for (const layer of layout.layers) {
    // First instance per slot (radial arrangements suffix their layer ids).
    if (out[layer.slot]) continue
    const cx = layer.left + layer.asset.width / 2
    const cy = layer.top + layer.asset.height * 0.5
    out[layer.slot] = [
      (offsetX + cx * scale) / canvasW,
      (offsetY + cy * scale) / canvasH,
    ]
  }
  return out
}

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
  opts: {
    night: boolean
    pxPerMeterY: number
    showScale?: boolean
    distribution?: string
    colorTemp?: string
    /** The rig's ground map — `projectOffset(manifest, ...)`. */
    projectGround?: (offset: [number, number, number]) => [number, number]
  },
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
      ? lightPoints.map((p) =>
          nightLight(
            p,
            layout.origin[1],
            opts.pxPerMeterY,
            opts.distribution,
            layout.origin[0],
            opts.projectGround ? groundAspect(opts.projectGround) : undefined,
          ),
        )
      : []
    // The light's colour follows the Color Temp the customer picked (Tyler
    // 8/20) — 5000K by default — so a true-amber turtle fixture no longer
    // renders identically to a 5000K neutral.
    const temp = opts.colorTemp ?? DEFAULT_COLOR_TEMP
    const washIn = lightRgba(temp, 'wash', 0.5)
    const washOut = lightRgba(temp, 'wash', 0)
    const beamTop = lightRgba(temp, 'core', 0.22)
    const beamBottom = lightRgba(temp, 'wash', 0.02)

    for (const light of lights) {
      // 0. The selected distribution's ground footprint (Tyler 8/20). Drawn
      //    under the pool so the pool still marks where the light lands
      //    hardest, while the footprint shows the SHAPE the customer picked.
      // 0. The distribution's isolux contours, outermost first, each a little
      //    stronger than the last — that stack IS the falloff.
      if (opts.projectGround) {
        for (const band of light.bands) {
          const points = groundToStage(band, [light.pool.x, light.pool.y], opts.projectGround)
          if (points.length < 3) continue
          ctx.save()
          ctx.fillStyle = lightRgba(temp, 'wash', band.weight)
          ctx.filter = 'blur(6px)'
          ctx.beginPath()
          points.forEach(([x, y], i) => {
            const [cx, cy] = toCanvas(x, y)
            if (i === 0) ctx.moveTo(cx, cy)
            else ctx.lineTo(cx, cy)
          })
          ctx.closePath()
          ctx.fill()
          ctx.restore()
        }
      }

      // 1. Warm ground pool — the primary illumination cue, brightest at
      //    center with soft radial falloff.
      const [px, py] = toCanvas(light.pool.x, light.pool.y)
      const poolRX = light.pool.rx * scale
      const poolRY = light.pool.ry * scale
      const pool = ctx.createRadialGradient(px, py, 0, px, py, poolRX)
      pool.addColorStop(0, washIn)
      pool.addColorStop(1, washOut)
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
        beam.addColorStop(0, beamTop)
        beam.addColorStop(1, beamBottom)
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
