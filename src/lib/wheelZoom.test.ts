import { describe, it, expect, vi } from 'vitest'
import {
  attachWheelZoom,
  createWheelZoomRef,
  wheelZoomFactor,
  WHEEL_LISTENER_OPTIONS,
  type WheelLikeEvent,
  type WheelZoomTarget,
} from './wheelZoom'

/**
 * Hand-rolled DOM stand-in — this repo runs vitest in the plain node
 * environment (no jsdom / happy-dom / testing-library, and Phase 0.11 does not
 * add test infrastructure), so the wheel wiring is verified against a fake
 * element instead of a rendered component.
 */
class FakeElement implements WheelZoomTarget {
  listeners: { handler: (event: WheelLikeEvent) => void; options: { passive: boolean } }[] = []

  addEventListener(
    type: 'wheel',
    handler: (event: WheelLikeEvent) => void,
    options: { passive: boolean },
  ) {
    if (type !== 'wheel') return
    this.listeners.push({ handler, options })
  }

  removeEventListener(type: 'wheel', handler: (event: WheelLikeEvent) => void) {
    if (type !== 'wheel') return
    this.listeners = this.listeners.filter((l) => l.handler !== handler)
  }

  /** Dispatch a wheel tick; returns the event so preventDefault can be asserted. */
  wheel(deltaY: number) {
    const event = {
      deltaY,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    for (const l of [...this.listeners]) l.handler(event)
    return event
  }
}

describe('wheelZoomFactor', () => {
  it('scrolls up to zoom in and down to zoom out, with a no-op at zero', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('is reversible — a tick and its opposite cancel out', () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 12)
  })
})

describe('attachWheelZoom', () => {
  it('registers non-passively so preventDefault can stop the page scrolling', () => {
    const el = new FakeElement()
    attachWheelZoom(el, () => {})
    expect(el.listeners).toHaveLength(1)
    expect(el.listeners[0].options).toEqual(WHEEL_LISTENER_OPTIONS)
    expect(WHEEL_LISTENER_OPTIONS.passive).toBe(false)
    expect(el.wheel(-100).defaultPrevented).toBe(true)
  })

  it('reports the tick factor and detaches on request', () => {
    const el = new FakeElement()
    const onZoom = vi.fn()
    const detach = attachWheelZoom(el, onZoom)
    el.wheel(-200)
    expect(onZoom).toHaveBeenCalledWith(wheelZoomFactor(-200))
    detach()
    expect(el.listeners).toHaveLength(0)
    el.wheel(-200)
    expect(onZoom).toHaveBeenCalledTimes(1)
  })
})

describe('createWheelZoomRef (regression: wheel zoom never attached)', () => {
  /**
   * CompositeViewer's first render ALWAYS returns the "Loading render…" branch
   * (`useRenderManifest()` starts `undefined` and only resolves in a promise
   * `.then`), so the interactive wrapper — and therefore the ref — arrives on a
   * later commit. This helper replays that mount order.
   */
  function mountWithLateNode(ref: (node: FakeElement | null) => void, el: FakeElement) {
    ref(null) // commit 1: loading branch, no wrapper in the tree
    ref(el) // commit 2: manifest resolved, wrapper mounted
  }

  it('attaches when the node arrives on a LATER commit', () => {
    const el = new FakeElement()
    const onZoom = vi.fn()
    mountWithLateNode(createWheelZoomRef<FakeElement>(onZoom), el)

    expect(el.listeners).toHaveLength(1)
    const event = el.wheel(-150)
    expect(event.defaultPrevented).toBe(true)
    expect(onZoom).toHaveBeenCalledWith(wheelZoomFactor(-150))
  })

  it('documents the trap: a mount-once effect misses that late node entirely', () => {
    // Phase 0.7 → 0.10.5 shipped this shape:
    //   useEffect(() => { const el = wrapperRef.current; if (!el) return; ... }, [])
    // The empty dep array runs it on the FIRST commit only, where the wrapper
    // does not exist yet, so it bails and never runs again — scroll-wheel zoom
    // is dead for the whole session while the +/- buttons keep working.
    const attachOnceOnMount = (nodeAtFirstCommit: FakeElement | null, onZoom: () => void) => {
      if (!nodeAtFirstCommit) return
      attachWheelZoom(nodeAtFirstCommit, onZoom)
    }

    const el = new FakeElement()
    attachOnceOnMount(null, () => {}) // commit 1
    // commit 2 mounts the wrapper, but a `[]`-deps effect does not re-run:
    expect(el.listeners).toHaveLength(0)
    expect(el.wheel(-150).defaultPrevented).toBe(false)

    // The shipped callback ref has no dep array to get wrong.
    createWheelZoomRef<FakeElement>(() => {})(el)
    expect(el.listeners).toHaveLength(1)
    expect(el.wheel(-150).defaultPrevented).toBe(true)
  })

  it('detaches when React hands the ref null on unmount', () => {
    const el = new FakeElement()
    const ref = createWheelZoomRef<FakeElement>(() => {})
    ref(el)
    ref(null)
    expect(el.listeners).toHaveLength(0)
  })

  it('moves the listener across a node swap without leaking the old one', () => {
    const first = new FakeElement()
    const second = new FakeElement()
    const onZoom = vi.fn()
    const ref = createWheelZoomRef<FakeElement>(onZoom)
    ref(first)
    ref(second)

    expect(first.listeners).toHaveLength(0)
    expect(second.listeners).toHaveLength(1)
    first.wheel(-100)
    expect(onZoom).not.toHaveBeenCalled()
    second.wheel(-100)
    expect(onZoom).toHaveBeenCalledTimes(1)
  })

  it('never stacks duplicate listeners when re-attached repeatedly', () => {
    const el = new FakeElement()
    const ref = createWheelZoomRef<FakeElement>(() => {})
    ref(el)
    ref(el)
    ref(el)
    expect(el.listeners).toHaveLength(1)
  })
})
