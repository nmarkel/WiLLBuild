/**
 * Non-passive wheel-zoom attachment for the image viewers, as a React
 * **callback ref** rather than a mount-once effect.
 *
 * Why a callback ref (Phase 0.11, Workstream E — the recurring "zoom sticks"
 * bug): `CompositeViewer`'s interactive wrapper does not exist on the first
 * commit. `useRenderManifest()` starts at `undefined`, so the component's first
 * render always returns the "Loading render…" branch — the wrapper (and its
 * ref) only appear on a LATER commit, once the manifest promise resolves. A
 * `useEffect(..., [])` that reads `wrapperRef.current` therefore runs exactly
 * once, sees `null`, bails, and never runs again: scroll-wheel zoom is silently
 * dead for the whole session while the +/- buttons keep working. That trap
 * shipped in Phase 0.7 and survived the 0.10.5 rewrite because nothing in the
 * code says "this effect depends on the node existing".
 *
 * A callback ref cannot miss the node: React invokes it with the element the
 * moment it is inserted — however late that is — and with `null` when it is
 * removed or swapped. There is no dependency array to get wrong, so the trap
 * cannot be reintroduced by editing deps.
 *
 * The DOM surface is kept to a structural minimum (`WheelZoomTarget` /
 * `WheelLikeEvent`) so the attachment logic is unit-testable in vitest's node
 * environment against a fake element — this repo has no jsdom.
 */

import { useMemo, useRef } from 'react'

/** The only bits of `WheelEvent` the zoom handler touches. */
export interface WheelLikeEvent {
  readonly deltaY: number
  preventDefault(): void
}

/** The only bits of `Element` the attachment touches. */
export interface WheelZoomTarget {
  addEventListener(
    type: 'wheel',
    handler: (event: WheelLikeEvent) => void,
    options: { passive: boolean },
  ): void
  removeEventListener(type: 'wheel', handler: (event: WheelLikeEvent) => void): void
}

/**
 * Non-passive is load-bearing: a passive listener cannot `preventDefault()`,
 * and the browser attaches `wheel` passively by default (including via React's
 * synthetic `onWheel`), which lets the page scroll behind the viewer.
 */
export const WHEEL_LISTENER_OPTIONS = { passive: false } as const

/** Exponential step per wheel tick, so zoom feels linear-ish at any level. */
export const WHEEL_SENSITIVITY = 0.0015

/** Multiplicative zoom factor for one wheel tick (scroll up = zoom in). */
export function wheelZoomFactor(deltaY: number, sensitivity = WHEEL_SENSITIVITY): number {
  return Math.exp(-deltaY * sensitivity)
}

/**
 * Attach the non-passive wheel listener to `target`; returns the detach fn.
 */
export function attachWheelZoom(
  target: WheelZoomTarget,
  onZoom: (factor: number) => void,
): () => void {
  const handler = (event: WheelLikeEvent) => {
    event.preventDefault()
    onZoom(wheelZoomFactor(event.deltaY))
  }
  target.addEventListener('wheel', handler, WHEEL_LISTENER_OPTIONS)
  return () => target.removeEventListener('wheel', handler)
}

/**
 * Build a React callback ref that keeps a non-passive wheel listener attached
 * to whatever node it is handed — attaching when the node arrives (however many
 * commits later), detaching on removal, and re-attaching across a node swap.
 *
 * Deliberately returns `void` rather than the detach fn: React 19 treats a
 * returned function as a ref cleanup and then stops calling the ref with
 * `null`. Owning both directions here keeps the behaviour identical on either
 * React contract.
 */
export function createWheelZoomRef<T extends WheelZoomTarget>(
  onZoom: (factor: number) => void,
): (node: T | null) => void {
  let detach: (() => void) | null = null
  return (node) => {
    if (detach) {
      detach()
      detach = null
    }
    if (node) detach = attachWheelZoom(node, onZoom)
  }
}

/**
 * Component-side wrapper: a ref callback that is stable for the component's
 * lifetime (so React never detaches/re-attaches on re-render) while always
 * invoking the LATEST `onZoom` closure.
 */
export function useWheelZoom<T extends WheelZoomTarget>(
  onZoom: (factor: number) => void,
): (node: T | null) => void {
  const latest = useRef(onZoom)
  latest.current = onZoom
  // Empty deps on purpose: the ref identity must never change, or React would
  // detach and re-attach the listener on every render. `latest` carries the
  // fresh closure instead.
  return useMemo(() => createWheelZoomRef<T>((factor) => latest.current(factor)), [])
}
