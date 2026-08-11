import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalogJson from '../../public/catalog.json'
import type { Catalog } from '../types'
import { COMING_SOON_LINES, isComingSoon, isConfigurable } from './availability'

/**
 * Phase 0.12, Workstream D.
 *
 * Two things are pinned here, and they are different:
 *
 *  1. The `realCad` flag in public/catalog.json agrees with the render rig's
 *     real-parts.json. That flag is GENERATED
 *     (scripts/merge-real-cad-flag.mjs); if someone hand-edits it, a product
 *     with placeholder geometry starts presenting as configurable, which is the
 *     exact dishonesty this workstream exists to remove.
 *
 *  2. The badged set is EXACTLY the coverage matrix's section-D list minus
 *     `direct-mount`. That list is the human-audited ground truth
 *     ("WiLLstudio STEP → Site Coverage Matrix (8-11)"), so it is written out
 *     here in full rather than derived from the same flag the rule uses —
 *     otherwise this would only assert the code agrees with itself.
 */

const catalog = catalogJson as unknown as Catalog
const REAL_PARTS_PATH = resolve(__dirname, '../../scripts/render-rig/real-parts.json')
const realParts = JSON.parse(readFileSync(REAL_PARTS_PATH, 'utf8')) as Record<string, unknown>

/**
 * Section D of the 8/11 coverage matrix: the 22 WiLLstudio parts still on
 * placeholder renders. `direct-mount` is the 22nd row and is excluded from
 * badging — it is the tenon-adapter pseudo-part and needs no CAD ever.
 */
const SECTION_D_BADGED = [
  'aluminum-decorative-bullhorn-brackets-round-pole-mount',
  'aluminum-light-pole-base-covers',
  'bc-fluted',
  'bc-round',
  'huntington-decorative-aluminum-anchor-base-light-poles',
  'pa1-pendant-arm',
  'pm1-pendant-arm',
  'round-tapered-fiberglass-anchor-base-light-poles',
  'round-tapered-fiberglass-direct-burial-light-poles',
  'round-tapered-steel-fluted-anchor-base-light-poles',
  'sacramento-decorative-aluminum-anchor-base-light-poles',
  'upsweep',
  'washington-decorative-aluminum-anchor-base-light-poles',
  'williamsburg-decorative-aluminum-anchor-base-light-poles',
  'willstudio-cr2-decorative-crossarm',
  'willstudio-fr2-decorative-crossarm',
  'willstudio-hsx-decorative-upsweep-arms',
  'willstudio-pendant-ceiling-mounts',
  'willstudio-supported-decorative-arms',
  'willstudio-wm1-single-wall-mount-pendant',
  'willstudio-wm2-single-wall-tenon-mount-w-finial',
]

/** Section E: the 23 parts already rendering from real CAD. */
const SECTION_E_REAL_CAD = Object.keys(realParts)

const byId = (id: string) => catalog.parts.find((p) => p.id === id)

describe('the realCad flag tracks the render rig', () => {
  it('is set on exactly the parts real-parts.json maps', () => {
    const flagged = catalog.parts.filter((p) => p.realCad).map((p) => p.id).sort()
    expect(flagged).toEqual([...SECTION_E_REAL_CAD].sort())
  })

  it('is present on every part, so "missing" can never read as "real"', () => {
    for (const part of catalog.parts) {
      expect(typeof part.realCad, `${part.id} has no realCad flag`).toBe('boolean')
    }
  })

  it('matches the matrix scoreboard: 23 of 117', () => {
    expect(catalog.parts.length).toBe(117)
    expect(catalog.parts.filter((p) => p.realCad).length).toBe(23)
  })
})

describe('Coming Soon covers exactly the coverage matrix section-D list', () => {
  it('badges every section-D part', () => {
    for (const id of SECTION_D_BADGED) {
      const part = byId(id)
      expect(part, `${id} is not in the catalog`).toBeDefined()
      expect(isComingSoon(part), `${id} should be Coming Soon`).toBe(true)
    }
  })

  it('badges nothing else', () => {
    const badged = catalog.parts
      .filter((p) => isComingSoon(p))
      .map((p) => p.id)
      .sort()
    expect(badged).toEqual([...SECTION_D_BADGED].sort())
  })

  it('never badges a real-CAD part', () => {
    for (const id of SECTION_E_REAL_CAD) {
      expect(isComingSoon(byId(id)), `${id} renders from real CAD`).toBe(false)
      expect(isConfigurable(byId(id))).toBe(true)
    }
  })

  it('excludes direct-mount — a pseudo-part, not a future product', () => {
    const dm = byId('direct-mount')
    expect(dm?.pseudoPart).toBe(true)
    expect(dm?.realCad).toBe(false)
    // Placeholder geometry AND excluded: the exclusion is doing real work here,
    // not coincidentally agreeing with the flag.
    expect(isComingSoon(dm)).toBe(false)
  })

  it('leaves lines outside the audited scope untouched', () => {
    // NAFCO/WiLLsport/WiLLev/WiLLcloud have not had the real-vs-placeholder
    // audit WiLLstudio got, so the rule must not sweep them in by accident.
    for (const part of catalog.parts) {
      if (!COMING_SOON_LINES.includes(part.line)) {
        expect(isComingSoon(part), `${part.id} (${part.line}) must not be badged`).toBe(false)
      }
    }
  })
})
