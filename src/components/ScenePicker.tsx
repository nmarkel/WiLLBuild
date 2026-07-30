import { useConfigurator } from '../store'
import type { Scene } from '../lib/url'

/**
 * Viewer backdrop presets. The picker only swaps the BACKDROP behind the
 * composited product — the product keeps its own baked render-rig lighting and
 * is NOT relit per scene (matches the Sternberg/Genesis3D benchmark: flat
 * backdrop images, product not per-scene relit).
 */
export const SCENE_META: { id: Scene; label: string }[] = [
  { id: 'park', label: 'Park' },
  { id: 'street', label: 'Street side' },
  { id: 'courtyard', label: 'Courtyard' },
  { id: 'blank', label: 'Blank' },
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
    </div>
  )
}
