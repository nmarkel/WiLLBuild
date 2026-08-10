import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { useConfigurator } from '../store'
import { CompositeViewer } from './CompositeViewer'
import { Panel } from './Panel'
import { Summary } from './Summary'
import { ScenePicker } from './ScenePicker'
import { BuilderHeader } from './BuilderHeader'
import { BottomBar } from './BottomBar'
import { DownloadsSheet } from './DownloadsSheet'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/**
 * Phase 0.10.5_TO: Tesla-configurator-style builder layout. Viewer dominant on
 * the left with its overlay controls unchanged, scrolling option rail on the
 * right, sticky bottom bar (a grid row, NOT an overlay — so the viewport
 * overlays keep their hardcoded offsets), downloads behind a slide-up sheet.
 * Serves every builder brand (WiLLstudio / NAFCO / WiLLsport).
 */
export function BuilderView({ catalog, config }: Props) {
  const {
    showScale,
    showCompass,
    mode,
    scene,
    brand,
    toggleScale,
    toggleCompass,
    toggleMode,
  } = useConfigurator()
  const [downloadsOpen, setDownloadsOpen] = useState(false)

  return (
    <div className="builder-app">
      <BuilderHeader />
      <div className="builder-stage">
        <main className="viewport">
          <CompositeViewer
            catalog={catalog}
            config={config}
            showScale={showScale}
            showCompass={showCompass}
            mode={mode}
            scene={scene}
          />
          {mode === 'night' && (
            <div className="night-disclaimer">
              Conceptual night preview — not a photometric simulation
            </div>
          )}
          <div className="viewport-controls">
            {mode === 'day' && <ScenePicker />}
            <button
              className="scale-toggle"
              onClick={toggleMode}
              title="Conceptual preview — not a photometric simulation"
            >
              {mode === 'day' ? '☾ Night view' : '☀ Day view'}
            </button>
            <button className="scale-toggle" onClick={toggleScale}>
              {showScale ? 'Hide' : 'Show'} human scale
            </button>
            <button
              className="scale-toggle"
              onClick={toggleCompass}
              title="Ground compass at the pole base — 0° marks the hand-hole reference"
            >
              {showCompass ? 'Hide' : 'Show'} compass
            </button>
          </div>
        </main>
        <BottomBar
          catalog={catalog}
          config={config}
          onOpenDownloads={() => setDownloadsOpen(true)}
        />
      </div>
      <aside className="builder-rail">
        <div className="builder-headline">
          <h1>{brand}</h1>
          <p>Design your pole — every choice updates the preview.</p>
        </div>
        <Panel catalog={catalog} config={config} />
        <Summary catalog={catalog} config={config} />
      </aside>
      <DownloadsSheet
        catalog={catalog}
        config={config}
        open={downloadsOpen}
        onClose={() => setDownloadsOpen(false)}
      />
    </div>
  )
}
