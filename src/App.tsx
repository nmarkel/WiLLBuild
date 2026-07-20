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
import { BrandProductList, firstBrandProduct } from './components/BrandProductList'

export default function App() {
  const { catalog, config, showScale, mode, view, brand, loadCatalog, toggleScale, toggleMode, openHome } =
    useConfigurator()

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  if (!catalog || !config) {
    return <div className="loading">Loading catalog…</div>
  }

  // Brand showroom (non-WiLLstudio): product list in the panel, 3D renderer in
  // the main area. Landing on the brand shows its first product immediately.
  if (brand !== 'WiLLstudio' && (view.kind === 'home' || view.kind === 'product')) {
    const activePart =
      view.kind === 'product'
        ? catalog.parts.find((p) => p.id === view.productId)
        : firstBrandProduct(catalog, brand)
    return (
      <div className="app">
        <aside className="panel">
          <header className="brand">
            <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
            <span className="brand-sub">3D Pole Configurator</span>
          </header>
          <BrandSwitcher />
          <BrandProductList catalog={catalog} brand={brand} activeId={activePart?.id} />
        </aside>
        <main className="viewport">
          <div className="product-viewer-shell">
            {activePart ? (
              <ProductViewer part={activePart} catalog={catalog} />
            ) : (
              <div className="product-viewer-not-found">No products listed yet.</div>
            )}
          </div>
        </main>
      </div>
    )
  }

  // WiLLstudio product view: catalog nav panel + product viewer in main area
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
        {brand === 'WiLLstudio' && <DescribeBox />}
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
