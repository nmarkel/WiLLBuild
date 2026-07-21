import type { CompositeLayout } from './composite'
import { renderUrl } from './renders'

/** Minimum PNG dimensions for the Product Render card / herocard+spec+bundle renderPng. */
export const SNAPSHOT_WIDTH = 1920
export const SNAPSHOT_HEIGHT = 1080

const MARGIN_FRAC = 0.06
const HUMAN_HEIGHT_M = 1.83
const HUMAN_WORLD_X_M = 1.4

export interface FitScale {
  scale: number
  offsetX: number
  offsetY: number
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

    if (opts.night && layout.lightPx) {
      const [lx, ly] = toCanvas(layout.lightPx[0], layout.lightPx[1])
      const glowR = 220 * scale + 60
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, glowR)
      glow.addColorStop(0, 'rgba(255, 207, 46, 0.35)')
      glow.addColorStop(1, 'rgba(255, 207, 46, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(lx - glowR, ly - glowR, glowR * 2, glowR * 2)

      // Warm ground pool below the fixture, at the assembly's ground line.
      const [, groundY] = toCanvas(layout.lightPx[0], layout.origin[1])
      const poolRX = 160 * scale + 40
      const poolRY = poolRX * 0.32
      const pool = ctx.createRadialGradient(lx, groundY, 0, lx, groundY, poolRX)
      pool.addColorStop(0, 'rgba(255, 207, 46, 0.28)')
      pool.addColorStop(1, 'rgba(255, 207, 46, 0)')
      ctx.fillStyle = pool
      ctx.beginPath()
      ctx.ellipse(lx, groundY, poolRX, poolRY, 0, 0, Math.PI * 2)
      ctx.fill()
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

    ctx.save()
    if (opts.night) ctx.filter = 'brightness(0.42) saturate(0.8)'
    layout.layers.forEach((layer, i) => {
      const [x, y] = toCanvas(layer.left, layer.top)
      ctx.drawImage(images[i], x, y, layer.asset.width * scale, layer.asset.height * scale)
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
