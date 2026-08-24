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
const LANDED_SINCE_AUDIT = [
  'willstudio-fr2-decorative-crossarm',
  // Phase 0.13: three more of the six, each socket re-derived from its own GLB
  // by the rule in socketRealCad.test.ts (calibrated on SH1 to 0.4 mm and
  // reproducing the shipped SS/AR sockets to <0.5 mm), then verified in the
  // browser. PA1 and PM1 also needed `mountOffset` — their GLB origin is not
  // their pole attachment, so they hung 32.6 cm and 1.3 cm clear of the pole.
  'pa1-pendant-arm',
  'pm1-pendant-arm',
  'willstudio-supported-decorative-arms',
  // HS1 landed last, and only after the bore search was fixed: it is a BRACED
  // upsweep whose support stay hangs 37 mm below its bore, so "lowest face in
  // the outer half" found the stay's flat underside (0.110 x 0.024 m) instead of
  // the Ø0.060 bore that was there all along, 84 mm inboard of the decorative
  // end. Socket moved 0.72 m — the largest correction of the set.
  'willstudio-hsx-decorative-upsweep-arms',
]

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
// only for the Casey pilot. UN-HELD 8/24 (Nick, Phase 0.19): the cut returns
// to GVX + TEX, after Cole's simplified TEX landed and its side-mount gap was
// contained (mounting constrained to 3T — see spec-option-corrections.json).
// willstudio-rxb-sxb-bollard: held by Tyler 8/14 the same hour it joined the
// builder (CR-GM-01) — visible in the Fixture step, badged, not selectable
// until its ordering matrix is encoded and the render is blessed.
const EDITORIAL_HOLDS = [
  'drx-post-top',
  'mvx-coach',
  'willstudio-dwx-flood-spot',
  'willstudio-rxb-sxb-bollard',
]

/**
 * Tyler 8/12: parts approved to SELL from placeholder art — an explicit,
 * per-part exemption from the geometry-gap rule (`placeholderApproved` in the
 * catalog). Unlike LANDED_SINCE_AUDIT these still render placeholders; the
 * exemption is a product call, and it stops mattering the day realCad lands.
 */
const PLACEHOLDER_APPROVED = [
  'willstudio-supported-decorative-arms',
  'willstudio-hsx-decorative-upsweep-arms',
  'pm1-pendant-arm',
]

const SECTION_D_BADGED = SECTION_D_AUDITED.filter(
  (id) => !LANDED_SINCE_AUDIT.includes(id) && !PLACEHOLDER_APPROVED.includes(id),
)
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

  it('matches the matrix scoreboard, plus what 0.12–0.17 have landed', () => {
    // The 8/11 audit measured 23 of 117; A1 added FR2, and 0.13 added PA1, PM1,
    // SD and HS1 — 28 of 117. That is FIVE of the six C1 arms; only CR2 is left,
    // parked on its tenon-shoulder question. Phase 0.14 added 5 render-only
    // accessory parts (117 → 122), 4 from real CAD (HH-4R, FH-4R, PH-4R,
    // CPL-P-12), festoon on a placeholder. Phase 0.17 added 2 more from
    // Cole's 8/17 exports (122 → 124): the standard pole base graft source
    // (4-RND-STANDARD-BASE) and the clamshell extender (CLE) — 34 real-CAD.
    expect(catalog.parts.length).toBe(124)
    expect(catalog.parts.filter((p) => p.slot === 'accessory').length).toBe(7)
    expect(catalog.parts.filter((p) => p.realCad).length).toBe(23 + LANDED_SINCE_AUDIT.length + 6)
    expect(catalog.parts.filter((p) => p.realCad).length).toBe(34)
  })
})

describe('placeholder-approved parts (Tyler 8/12)', () => {
  it('flags exactly the three approved arms, and all three are configurable', () => {
    for (const id of PLACEHOLDER_APPROVED) {
      const part = byId(id)
      expect(part?.placeholderApproved, id).toBe(true)
      expect(isComingSoon(part), id).toBe(false)
    }
    const flagged = catalog.parts.filter((p) => p.placeholderApproved).map((p) => p.id).sort()
    expect(flagged).toEqual([...PLACEHOLDER_APPROVED].sort())
  })

  /**
   * Phase 0.13: exactly what Tyler said would happen — "it stops mattering the
   * day realCad lands". All three now render from real CAD (SD, PM1, then HS1
   * once the bore search was fixed), so the exemption is fully redundant.
   *
   * The flags are deliberately LEFT in the catalog: they are Tyler's product call
   * to retire, they are harmless once realCad is true, and stripping them would
   * be a data edit dressed up as cleanup. This test is the evidence he needs to
   * make that call — and it will fail loudly if a future re-ingest ever DROPS one
   * of these parts' real CAD, which would quietly make the exemption matter again.
   */
  it('is now FULLY redundant — all three have real CAD', () => {
    // 0.13 finished what Tyler predicted: "it stops mattering the day realCad
    // lands". HS1 was the last holdout and landed too, so not one of the three
    // still depends on the exemption. Clearing every flag would change nothing.
    const stillLoadBearing = PLACEHOLDER_APPROVED.filter((id) => byId(id)?.realCad !== true)
    expect(stillLoadBearing).toEqual([])
    for (const id of PLACEHOLDER_APPROVED) {
      expect(isComingSoon({ ...byId(id)!, placeholderApproved: undefined }), id).toBe(false)
    }
    // Left in the catalog deliberately: they are Tyler's product call to retire,
    // and a redundant flag is harmless. This test is the evidence for that call.
  })

  it('an editorial hold still outranks the approval', () => {
    const part = byId(PLACEHOLDER_APPROVED[0])!
    expect(isComingSoon({ ...part, comingSoon: true })).toBe(true)
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

  it('leaves exactly GVX + TEX configurable in the fixture slot (8/24 cut)', () => {
    // Nick 8/24 (Phase 0.19): the fixture cut returns to GVX + TEX — reversing
    // the 8/12 GVX-only hold — after Cole's simplified TEX shipped as the
    // customer download and the service shell.
    const fixtures = catalog.parts.filter((p) => p.slot === 'fixture' && p.line === 'WiLLstudio')
    const usable = fixtures.filter((p) => isConfigurable(p)).map((p) => p.id).sort()
    expect(usable).toEqual(['gvx-pendant', 'tex-post-top'])
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
