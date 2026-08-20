import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useConfigurator } from '../store'
import { SCENE_META } from './ScenePicker'

/**
 * Phase 0.10.5_TO: one compact grouped toolbar replacing the old row of nine
 * look-alike pills (.viewport-controls). Scene selection collapses into a
 * dropdown; day/night, human scale and compass stay as labeled toggles.
 * Scene choice is hidden at night (parity with the old ScenePicker gating).
 */
export function ViewerToolbar() {
  const scene = useConfigurator((s) => s.scene)
  const setScene = useConfigurator((s) => s.setScene)
  const customSceneUrl = useConfigurator((s) => s.customSceneUrl)
  const setCustomScene = useConfigurator((s) => s.setCustomScene)
  const mode = useConfigurator((s) => s.mode)
  const toggleMode = useConfigurator((s) => s.toggleMode)
  const showCompass = useConfigurator((s) => s.showCompass)
  const showLabels = useConfigurator((s) => s.showLabels)
  const toggleLabels = useConfigurator((s) => s.toggleLabels)
  const toggleCompass = useConfigurator((s) => s.toggleCompass)

  const [sceneOpen, setSceneOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const night = mode === 'night'

  useEffect(() => {
    if (!sceneOpen) return
    const onDown = (e: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setSceneOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSceneOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [sceneOpen])

  const onCustomFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCustomScene(URL.createObjectURL(file))
    setSceneOpen(false)
    e.target.value = ''
  }

  const sceneLabel =
    scene === 'custom'
      ? 'Your photo'
      : (SCENE_META.find((s) => s.id === scene)?.label ?? 'Scene')

  return (
    <div className="viewer-toolbar">
      {!night && (
        <>
          <div className="viewer-toolbar-scene" ref={menuRef}>
            <button
              type="button"
              className="viewer-tool"
              aria-haspopup="menu"
              aria-expanded={sceneOpen}
              onClick={() => setSceneOpen((o) => !o)}
              title="Change the backdrop scene (product is not relit per scene)"
            >
              <span className="viewer-tool-dim">Scene</span> {sceneLabel} ▾
            </button>
            {sceneOpen && (
              <div className="viewer-scene-menu" role="menu" aria-label="Backdrop scene">
                {SCENE_META.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={scene === id}
                    className={`viewer-scene-item${scene === id ? ' active' : ''}`}
                    onClick={() => {
                      setScene(id)
                      setSceneOpen(false)
                    }}
                  >
                    {label}
                  </button>
                ))}
                {customSceneUrl && (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={scene === 'custom'}
                    className={`viewer-scene-item${scene === 'custom' ? ' active' : ''}`}
                    onClick={() => {
                      setScene('custom')
                      setSceneOpen(false)
                    }}
                  >
                    Your photo
                  </button>
                )}
                {/* Session-only backdrop: stays on this device, never in share links. */}
                <button
                  type="button"
                  role="menuitem"
                  className="viewer-scene-item viewer-scene-upload"
                  onClick={() => fileRef.current?.click()}
                >
                  📷 {customSceneUrl ? 'Swap your photo…' : 'Upload your photo…'}
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onCustomFile}
            />
          </div>
          <span className="viewer-toolbar-divider" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        className={`viewer-tool${night ? ' active' : ''}`}
        aria-pressed={night}
        onClick={toggleMode}
        title="Conceptual preview — not a photometric simulation"
      >
        {night ? '☀ Day' : '☾ Night'}
      </button>
      <button
        type="button"
        className={`viewer-tool${showCompass ? ' active' : ''}`}
        aria-pressed={showCompass}
        onClick={toggleCompass}
        title="Ground compass at the pole base — 0° marks the hand-hole reference"
      >
        Compass
      </button>
      <button
        type="button"
        className={`viewer-tool${showLabels ? ' active' : ''}`}
        aria-pressed={showLabels}
        onClick={toggleLabels}
        title="Component labels — click one to see that part's configuration"
      >
        Labels
      </button>
    </div>
  )
}
