import { BrandSwitcher } from './BrandSwitcher'

/**
 * Phase 0.10.5_TO (Tesla-style builder): full-width gunmetal top bar.
 * Logo stays on the dark bar per brand rules (reversed lockup, ≥150px,
 * clear space ≈ ½ logo height); the BrandSwitcher rides along on the right.
 */
export function BuilderHeader() {
  return (
    <header className="builder-header">
      <img className="brand-logo" src="/will-logo.png" alt="WiLL" />
      <span className="brand-sub">3D Pole Configurator</span>
      <div className="builder-header-nav">
        <BrandSwitcher />
      </div>
    </header>
  )
}
