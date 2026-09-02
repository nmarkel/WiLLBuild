/* eslint-disable react-refresh/only-export-components -- Phase 0.20 hygiene:
   this file exports a component alongside constants/helpers that belong with
   it. The rule is a Fast-Refresh ergonomics hint, not a correctness one, and
   the fix is splitting files purely to satisfy the dev server. Waived: the
   colocation is deliberate and the runtime cost is zero. */
import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { useConfigurator } from '../store'
import type { Scene } from '../lib/url'

/**
 * Viewer backdrop presets. The picker only swaps the BACKDROP behind the
 * composited product — the product keeps its own baked render-rig lighting and
 * is NOT relit per scene (matches the Sternberg/Genesis3D benchmark: flat
 * backdrop images, product not per-scene relit).
 */
/*
 * Phase 0.11 (F1): Blank leads the row because it is now DEFAULT_SCENE — the
 * chip that is active on first load should be the first one you read, and the
 * order then runs clean studio → add context. Nothing depends on this order
 * (SCENES in url.ts is a validation whitelist, order-independent).
 */
export const SCENE_META: { id: Scene; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'park', label: 'Park' },
  { id: 'street', label: 'Street side' },
  { id: 'parking', label: 'Parking lot' },
]

/**
 * Public-asset path for a scene's backdrop photo. These are real daytime stock
 * photos (Pexels License — free for commercial use, no attribution required;
 * provenance in public/scenes/SOURCES.md), cropped to a shared ~0.72 ground
 * line so one product placement grounds across all three. Interim until final
 * brand photography; final images drop into the same slots at the same ground
 * line with no code change.
 */
export function sceneBackdrop(scene: Scene): string {
  return `${import.meta.env.BASE_URL}scenes/${scene}.jpg`
}

/**
 * Small, unobtrusive backdrop switcher that sits alongside the day/night and
 * human-scale controls. Selected chip = brand yellow bg + gunmetal text (per
 * the WiLL palette); the rest reuse the existing `.scale-toggle` chrome.
 */
export function ScenePicker() {
  const scene = useConfigurator((s) => s.scene)
  const setScene = useConfigurator((s) => s.setScene)
  const customSceneUrl = useConfigurator((s) => s.customSceneUrl)
  const setCustomScene = useConfigurator((s) => s.setCustomScene)
  const fileRef = useRef<HTMLInputElement>(null)

  const onCustomFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCustomScene(URL.createObjectURL(file))
    e.target.value = ''
  }

  return (
    <div className="scene-picker" role="group" aria-label="Viewer backdrop scene">
      {SCENE_META.map(({ id, label }) => {
        const active = scene === id
        return (
          <button
            key={id}
            type="button"
            className={`scale-toggle scene-chip${active ? ' active' : ''}`}
            aria-pressed={active}
            onClick={() => setScene(id)}
            title={`Backdrop: ${label} (product is not relit per scene)`}
          >
            {label}
          </button>
        )
      })}
      {/* Phase 0.10.5: user-supplied backdrop. Session-only (never in share URLs);
          clicking with a photo already loaded re-activates it, and the 📷
          affordance re-opens the picker to swap photos. */}
      <button
        type="button"
        className={`scale-toggle scene-chip${scene === 'custom' ? ' active' : ''}`}
        aria-pressed={scene === 'custom'}
        onClick={() => (customSceneUrl ? setScene('custom') : fileRef.current?.click())}
        title="Backdrop: your own photo (stays on this device — not part of share links)"
      >
        {customSceneUrl ? 'Custom' : 'Custom…'}
      </button>
      {customSceneUrl && (
        <button
          type="button"
          className="scale-toggle scene-chip"
          onClick={() => fileRef.current?.click()}
          title="Swap the custom backdrop photo"
          aria-label="Swap the custom backdrop photo"
        >
          📷
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onCustomFile}
      />
    </div>
  )
}
