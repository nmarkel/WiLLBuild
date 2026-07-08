import { useEffect } from 'react'
import { useConfigurator } from './store'
import { Scene } from './components/Scene'
import { Panel } from './components/Panel'
import { Summary } from './components/Summary'
import { DescribeBox } from './components/DescribeBox'
import { OutputTray } from './components/OutputTray'

export default function App() {
  const { catalog, config, showScale, loadCatalog, toggleScale } = useConfigurator()

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  if (!catalog || !config) {
    return <div className="loading">Loading catalog…</div>
  }

  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
          <span className="brand-sub">3D Pole Configurator</span>
        </header>
        <DescribeBox />
        <Panel catalog={catalog} config={config} />
        <Summary catalog={catalog} config={config} />
        <OutputTray catalog={catalog} config={config} />
      </aside>
      <main className="viewport">
        <Scene catalog={catalog} config={config} showScale={showScale} />
        <button className="scale-toggle" onClick={toggleScale}>
          {showScale ? 'Hide' : 'Show'} human scale
        </button>
      </main>
    </div>
  )
}
