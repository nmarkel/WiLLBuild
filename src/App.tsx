import { useEffect } from 'react'
import { useConfigurator } from './store'
import { Scene } from './components/Scene'
import { Panel } from './components/Panel'
import { Summary } from './components/Summary'
import { DescribeBox } from './components/DescribeBox'
import { OutputTray } from './components/OutputTray'
import { CatalogNav } from './components/CatalogNav'

export default function App() {
  const { catalog, config, showScale, mode, view, loadCatalog, toggleScale, toggleMode, openBuilder } =
    useConfigurator()

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  if (!catalog || !config) {
    return <div className="loading">Loading catalog…</div>
  }

  // Product view: full-width with brand header, back button, placeholder viewer
  if (view.kind === 'product') {
    const part = catalog.parts.find((p) => p.id === view.productId)
    return (
      <div className="app">
        <aside className="panel">
          <header className="brand">
            <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
            <span className="brand-sub">3D Pole Configurator</span>
          </header>
          <CatalogNav catalog={catalog} />
        </aside>
        <main className="viewport">
          <div className="product-viewer-placeholder">
            <div>
              <button
                className="btn secondary"
                onClick={openBuilder}
                style={{ marginBottom: 24, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                ← Back to builder
              </button>
              <p>{part ? part.name : view.productId} — product viewer coming in the next commit</p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Builder view (default): existing UI unchanged
  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
          <span className="brand-sub">3D Pole Configurator</span>
        </header>
        <CatalogNav catalog={catalog} />
        <DescribeBox />
        <Panel catalog={catalog} config={config} />
        <Summary catalog={catalog} config={config} />
        <OutputTray catalog={catalog} config={config} />
      </aside>
      <main className="viewport">
        <Scene catalog={catalog} config={config} showScale={showScale} mode={mode} />
        {mode === 'night' && (
          <div className="night-disclaimer">Conceptual night preview — not a photometric simulation</div>
        )}
        <div className="viewport-controls">
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
        </div>
      </main>
    </div>
  )
}
