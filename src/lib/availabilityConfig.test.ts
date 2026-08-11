import { describe, expect, it } from 'vitest'
import catalogJson from '../../public/catalog.json'
import type { Catalog, ProductLine, Slot } from '../types'
import { compatibleParts, defaultConfig, partById, repairConfig, SLOT_ORDER } from './compat'
import { isComingSoon } from './availability'
import { buildPartNumber } from './summary'

/**
 * Phase 0.12, Workstream D — Coming Soon parts must be unreachable, not just
 * un-clickable.
 *
 * Disabling the button is the visible half. The half that actually matters is
 * that nothing can land on one behind the customer's back: not the default
 * config, not a repair after an upstream change, not a hand-edited share URL.
 * A config sitting on a disabled part would render placeholder geometry while
 * the rail insists the product is not configurable.
 */

const catalog = catalogJson as unknown as Catalog

describe('no configuration can rest on a Coming Soon part', () => {
  it('the default config selects only configurable parts', () => {
    const config = defaultConfig(catalog, 'WiLLstudio')
    for (const slot of SLOT_ORDER) {
      const part = partById(catalog, config[slot as Slot])
      if (!part) continue
      expect(isComingSoon(part), `default config landed on ${part.id}`).toBe(false)
    }
  })

  it('every brand default is configurable', () => {
    const brands: ProductLine[] = ['WiLLstudio', 'NAFCO', 'WiLLsport']
    for (const brand of brands) {
      const config = defaultConfig(catalog, brand)
      for (const slot of SLOT_ORDER) {
        const part = partById(catalog, config[slot as Slot])
        if (!part) continue
        expect(isComingSoon(part), `${brand} default landed on ${part.id}`).toBe(false)
      }
    }
  })

  it('repairs a share URL that names a Coming Soon part', () => {
    // A hand-edited or stale link pointing at a disabled arm must come back
    // configurable rather than silently building an un-orderable assembly.
    //
    // The arm must be one that is COMPATIBLE with the base config, or repair
    // would swap it out for compatibility reasons and this would pass without
    // testing availability at all — which is exactly how it was first written.
    const base = defaultConfig(catalog, 'WiLLstudio')
    const soonArms = compatibleParts(catalog, base, 'arm').filter((p) => isComingSoon(p))
    expect(soonArms.length, 'expected a compatible Coming Soon arm to exist').toBeGreaterThan(0)
    for (const arm of soonArms) {
      const repaired = repairConfig(catalog, { ...base, arm: arm.id })
      expect(
        isComingSoon(partById(catalog, repaired.arm)),
        `repair left the config on disabled arm ${arm.id}`,
      ).toBe(false)
    }
  })

  it('produces no part number for a Coming Soon part', () => {
    const soonArm = catalog.parts.find((p) => p.slot === 'arm' && isComingSoon(p))!
    const base = defaultConfig(catalog, 'WiLLstudio')
    // Bypass repair deliberately: even if a disabled part reaches the resolver,
    // it must not yield a spec-able SKU.
    expect(buildPartNumber(catalog, { ...base, arm: soonArm.id }, 'arm')).toBeUndefined()
  })

  it('still LISTS Coming Soon parts — visible, not deleted', () => {
    const config = defaultConfig(catalog, 'WiLLstudio')
    const arms = compatibleParts(catalog, config, 'arm')
    expect(arms.some((p) => isComingSoon(p)), 'disabled arms vanished from the rail').toBe(true)
  })
})
