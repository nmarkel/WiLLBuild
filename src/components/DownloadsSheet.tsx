import { useEffect, useRef } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { OutputTray } from './OutputTray'

interface Props {
  catalog: Catalog
  config: PoleConfig
  open: boolean
  onClose: () => void
}

/**
 * Phase 0.10.5_TO (Tesla-style builder): slide-up sheet holding the Downloads
 * tray. Always mounted, CSS-toggled — OutputTray keeps in-flight download
 * progress across close/reopen, and the snapshot fn stays wired to the
 * still-mounted viewer behind it. `inert` (React 19) removes the closed sheet
 * from the tab order. Stacking: sheet z40 sits under the contact gate's z50.
 */
export function DownloadsSheet({ catalog, config, open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreRef.current?.focus()
    }
  }, [open, onClose])

  return (
    <>
      <div
        className={`downloads-sheet-backdrop${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`downloads-sheet${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Downloads"
        inert={!open}
      >
        <div className="downloads-sheet-head">
          <span className="downloads-sheet-handle" aria-hidden="true" />
          <button
            ref={closeRef}
            className="downloads-sheet-close"
            onClick={onClose}
            aria-label="Close downloads"
          >
            ✕
          </button>
        </div>
        <OutputTray catalog={catalog} config={config} />
      </div>
    </>
  )
}
