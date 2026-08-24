import { describe, expect, it } from 'vitest'
import catalogJson from '../../public/catalog.json'
import type { Catalog, ProductLine, Slot } from '../types'
import { autofillConfig, compatibleParts, defaultConfig, partById, repairConfig, SLOT_ORDER } from './compat'
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

  it('KEEPS a Coming Soon part a share URL already names, rather than rewriting it', () => {
    // Deliberate: repair never CHOOSES a held part, but it does not evict one
    // the customer's link already names. Swapping their saved product for a
    // different one because it left the cut would rewrite their design without
    // telling them; leaving it inert (badged, no part number, no downloads) is
    // what "visible, not configurable" actually means.
    //
    // The arm must be COMPATIBLE with the base config, or repair would drop it
    // for compatibility reasons and this would prove nothing about availability.
    const base = defaultConfig(catalog, 'WiLLstudio')
    const soonArms = compatibleParts(catalog, base, 'arm').filter((p) => isComingSoon(p))
    expect(soonArms.length, 'expected a compatible Coming Soon arm to exist').toBeGreaterThan(0)
    for (const arm of soonArms) {
      const repaired = repairConfig(catalog, { ...base, arm: arm.id })
      expect(repaired.arm, `repair rewrote the customer's ${arm.id}`).toBe(arm.id)
      // ...and it stays inert while selected.
      expect(buildPartNumber(catalog, repaired, 'arm')).toBeUndefined()
    }
  })

  it('never CHOOSES a Coming Soon part when it has to replace one', () => {
    // The other half: when the named part is genuinely invalid, the replacement
    // must be configurable. This is what keeps a fresh visitor off a held part.
    const base = defaultConfig(catalog, 'WiLLstudio')
    const repaired = repairConfig(catalog, { ...base, arm: 'not-a-real-part-id' })
    expect(repaired.arm).not.toBe('not-a-real-part-id')
    expect(isComingSoon(partById(catalog, repaired.arm))).toBe(false)
  })

  it('opens the builder blank; autofill never lands on a held part', () => {
    // 8/12 blank slate: no fixture is chosen for the customer at all — which
    // trivially keeps the opening state off Coming Soon parts. The choosing
    // path that must still dodge held parts is autofillConfig.
    const base = defaultConfig(catalog, 'WiLLstudio')
    expect(base.fixture).toBe('')
    const filled = autofillConfig(catalog, base)
    expect(isComingSoon(partById(catalog, filled.fixture))).toBe(false)
    // TEX since 8/24 (Phase 0.19 un-hold): autofill takes the FIRST
    // configurable fixture in catalog order (drx, tex, mvx, gvx …), and TEX
    // now precedes GVX in that walk. The builder itself still opens blank —
    // this only moves where "build one for me" starts.
    expect(filled.fixture).toBe('tex-post-top')
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
