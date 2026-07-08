import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useConfigurator } from '../store'

/** Minimum drawing-buffer dimensions for exported snapshots. */
const MIN_WIDTH = 1920
const MIN_HEIGHT = 1080

/** Frames to wait after a dpr change so the render loop (and EffectComposer) re-render at the new size. */
const SETTLE_FRAMES = 4

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Mount INSIDE the R3F <Canvas>. Registers a high-resolution capture function
 * into the configurator store; OutputTray calls it to export a PNG that is at
 * least 1920x1080 and reflects the full render pipeline (post effects included,
 * since the EffectComposer renders into the default framebuffer).
 */
export function SnapshotRig() {
  // Stable getter for live root state, so the capture closure never goes stale.
  const get = useThree((state) => state.get)
  const registerSnapshot = useConfigurator((s) => s.registerSnapshot)
  const inFlight = useRef(false)

  useEffect(() => {
    const capture = async (): Promise<Blob | null> => {
      if (inFlight.current) return null
      inFlight.current = true
      const { gl, size, viewport, setDpr } = get()
      const originalDpr = viewport.dpr
      try {
        // Pixel ratio needed so the drawing buffer is at least MIN_WIDTH x MIN_HEIGHT.
        const needed = Math.max(
          window.devicePixelRatio,
          MIN_WIDTH / size.width,
          MIN_HEIGHT / size.height,
        )
        setDpr(needed)
        // Let the loop render a few frames at the new resolution before grabbing the buffer.
        for (let i = 0; i < SETTLE_FRAMES; i++) await nextFrame()
        return await new Promise<Blob | null>((resolve) =>
          gl.domElement.toBlob(resolve, 'image/png'),
        )
      } finally {
        setDpr(originalDpr)
        inFlight.current = false
      }
    }

    registerSnapshot(capture)
    return () => registerSnapshot(null)
  }, [get, registerSnapshot])

  return null
}
