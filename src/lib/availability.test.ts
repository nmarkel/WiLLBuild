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
const SECTION_D_AUDITED = [
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

/**
 * Parts Workstream A has since taken OFF that list by mapping their real CAD.
 *
 * The audit above is kept intact rather than edited down, so this line is the
 * running record of progress against it — and re-enabling is exactly the
 * automatic behaviour the generated flag is for: map the part in
 * real-parts.json, re-render, and it stops being Coming Soon.
 *
 * FR2 (0.12, A1): the only one of the six C1 arms whose catalog socket already
 * matched its real CAD — it needed the rotateY alone.
 */
const LANDED_SINCE_AUDIT = ['willstudio-fr2-decorative-crossarm']

/**
 * EDITORIAL holds — parts pulled from the cut by decision, not by a geometry
 * gap. All three render from real CAD; Tyler's 8/11 call keeps the fixture set
 * to GVX + TEX, so DRX / MVX / DWX come out anyway.
 *
 * Kept as its own list because it behaves differently from the audit above:
 * these do NOT re-enable themselves when more geometry lands. Someone has to
 * decide they are back in the cut.
 */
// tex-post-top joined the holds 8/12 (Tyler): fixture cut narrows to GVX
// only for the Casey pilot. Held ≠ deleted — TEX re-enables by clearing the flag.
const EDITORIAL_HOLDS = ['drx-post-top', 'mvx-coach', 'tex-post-top', 'willstudio-dwx-flood-spot']

const SECTION_D_BADGED = SECTION_D_AUDITED.filter((id) => !LANDED_SINCE_AUDIT.includes(id))
const ALL_BADGED = [...SECTION_D_BADGED, ...EDITORIAL_HOLDS]

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

  it('matches the matrix scoreboard, plus what 0.12 has landed', () => {
    // The 8/11 audit measured 23 of 117; Workstream A1 added FR2.
    expect(catalog.parts.length).toBe(117)
    expect(catalog.parts.filter((p) => p.realCad).length).toBe(23 + LANDED_SINCE_AUDIT.length)
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
    expect(badged).toEqual([...ALL_BADGED].sort())
  })

  it('never badges a real-CAD part for a GEOMETRY reason', () => {
    // Real CAD means the geometry gap does not apply. An editorial hold still
    // can — and must not be confused with one: the flag stays true and the
    // render still comes from that part's real CAD.
    for (const id of SECTION_E_REAL_CAD) {
      if (EDITORIAL_HOLDS.includes(id)) continue
      expect(isComingSoon(byId(id)), `${id} renders from real CAD`).toBe(false)
      expect(isConfigurable(byId(id))).toBe(true)
    }
  })

  it('holds DRX / MVX / DWX editorially, without touching their real-CAD flag', () => {
    // Tyler's 8/11 cut is GVX + TEX. These three are finished enough to render
    // and their `realCad` must stay true — clearing it would be a lie about the
    // geometry and would drag the render pipeline and coverage gate along with
    // a merchandising decision.
    for (const id of EDITORIAL_HOLDS) {
      const part = byId(id)
      expect(part?.comingSoon, `${id} should carry an explicit hold`).toBe(true)
      expect(part?.realCad, `${id} still renders from real CAD`).toBe(true)
      expect(isComingSoon(part)).toBe(true)
    }
  })

  it('leaves exactly GVX configurable in the fixture slot (8/12 cut)', () => {
    const fixtures = catalog.parts.filter((p) => p.slot === 'fixture' && p.line === 'WiLLstudio')
    const usable = fixtures.filter((p) => isConfigurable(p)).map((p) => p.id).sort()
    expect(usable).toEqual(['gvx-pendant'])
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
