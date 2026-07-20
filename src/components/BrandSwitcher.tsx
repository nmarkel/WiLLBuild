import type { ProductLine } from '../types'
import { useConfigurator } from '../store'
import { brandHomePath, BRAND_SLUGS } from '../lib/routes'

/** Display order for the brand list — mirrors a Tesla-style model selector. */
const BRAND_ORDER: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport', 'WiLLev', 'WiLLcloud']

/** Human-readable brand labels. */
const BRAND_LABELS: Record<ProductLine, string> = {
  WiLLstudio: 'WiLLstudio',
  NAFCO: 'NAFCO',
  WiLLsport: 'WiLLsport',
  WiLLev: 'WiLLev',
  WiLLcloud: 'WiLLcloud',
  Other: 'Other',
}

export function BrandSwitcher() {
  const { brand } = useConfigurator()

  return (
    <nav className="brand-switcher" aria-label="Brand selector">
      {BRAND_ORDER.map((b) => {
        const hasFlow = BRAND_SLUGS[b] !== null
        const isActive = b === brand
        return (
          <div
            key={b}
            className={
              'brand-switcher-item' +
              (isActive ? ' active' : '') +
              (!hasFlow ? ' disabled' : '')
            }
          >
            {hasFlow ? (
              <a
                href={brandHomePath(b)}
                className="brand-switcher-link"
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="brand-switcher-name">{BRAND_LABELS[b]}</span>
              </a>
            ) : (
              <span className="brand-switcher-link" aria-disabled="true">
                <span className="brand-switcher-name">{BRAND_LABELS[b]}</span>
                <span className="brand-switcher-soon">Coming soon</span>
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
