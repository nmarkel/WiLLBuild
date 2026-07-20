import { useEffect } from 'react'
import { useConfigurator } from './store'
import { Scene } from './components/Scene'
import { Panel } from './components/Panel'
import { Summary } from './components/Summary'
import { DescribeBox } from './components/DescribeBox'
import { OutputTray } from './components/OutputTray'
import { CatalogNav } from './components/CatalogNav'
import { ProductViewer } from './components/ProductViewer'
import { BrandSwitcher } from './components/BrandSwitcher'
import { BrandHome } from './components/BrandHome'

export default function App() {
  const { catalog, config, showScale, mode, view, brand, loadCatalog, toggleScale, toggleMode, openHome } =
    useConfigurator()

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  if (!catalog || !config) {
    return <div className="loading">Loading catalog…</div>
  }

  // Brand home (non-WiLLstudio): brand-scoped nav + product grid in main area
  if (view.kind === 'home') {
    return (
      <div className="app">
        <aside className="panel">
          <header className="brand">
            <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
            <span className="brand-sub">3D Pole Configurator</span>
          </header>
          <BrandSwitcher />
          <CatalogNav catalog={catalog} activeBrand={brand} />
        </aside>
        <main className="viewport brand-home-viewport">
          <BrandHome catalog={catalog} brand={brand} />
        </main>
      </div>
    )
  }

  // Product view: catalog nav panel + real product viewer in main area
  if (view.kind === 'product') {
    const part = catalog.parts.find((p) => p.id === view.productId)
    return (
      <div className="app">
        <aside className="panel">
          <header className="brand">
            <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
            <span className="brand-sub">3D Pole Configurator</span>
          </header>
          <BrandSwitcher />
          <CatalogNav catalog={catalog} activeBrand={brand} />
        </aside>
        <main className="viewport">
          <div className="product-viewer-shell">
            <div className="product-viewer-back-bar">
              <button
                className="btn secondary"
                onClick={openHome}
                aria-label={brand === 'WiLLstudio' ? 'Back to builder' : `Back to ${brand}`}
              >
                ← {brand === 'WiLLstudio' ? 'Back to builder' : `Back to ${brand}`}
              </button>
            </div>
            {part ? (
              <ProductViewer part={part} catalog={catalog} />
            ) : (
              <div className="product-viewer-not-found">
                Product not found: {view.productId}
              </div>
            )}
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
        <BrandSwitcher />
        <CatalogNav catalog={catalog} activeBrand={brand} />
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
