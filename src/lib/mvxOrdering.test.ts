import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig, SpecOptionValue } from '../types'
import { partById, valueCompatibleWithChosen } from './compat'
import { buildPartNumber } from './summary'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const MVX = 'mvx-coach'

/**
 * Phase 0.21 (Nick, 9/3): the MVX ordering table, against its own spec sheet.
 *
 * Two things brought this on at once. Cole's 9/3 re-export REMOVED the finial
 * from the MVX body (measured: −171.9 mm, 65.7% silhouette IoU), and the sheet
 * explains why — the finial is an ACCESSORY CODE, `FT` on a 3T mount or `FB` on
 * a PM mount, never part of the base luminaire. So the geometry split and the
 * ordering data have to tell the same story.
 *
 * The sheet also exposed a parse defect. Its "Options & Accessories" block is
 * three visual sub-columns headed Options | Options | Accessories, and several
 * PDF text runs SPAN those columns, so nearest-centroid cell assignment welded
 * neighbouring cells together and truncated others — six of 22 labels wrong.
 * The worst was customer-visible: `CL-MVX-3T` and `CL-MVX-PM` both read simply
 * "MVX Clear Lens", two indistinguishable checkboxes for different mounts.
 *
 * The corrections live in `docs/spec-option-corrections.json` (never hand-edited
 * into catalog.json — the merge scripts silently revert that). This pins the
 * corrected state so a parser re-run cannot quietly restore the artifact.
 */

/** Every option/accessory code on the sheet, with its label VERBATIM. */
const SHEET: Record<string, string> = {
  'CL-MVX-3T': 'MVX Clear Lens (Requires 3T Mount)',
  'CL-MVX-PM': 'MVX Clear Lens (Requires PM Mount)',
  'DL-MVX-3T': 'MVX Frosted Lens (Requires 3T Mount)',
  'DL-MVX-PM': 'MVX Frosted Lens (Requires PM Mount)',
  CF: 'Custom',
  WHP3NP: '2’ Cord w/o Plug, Stripped Pigtail',
  WHP7NP: '6’ Cord w/o Plug, Stripped Pigtail',
  WHP11NP: '10’ Cord w/o Plug, Stripped Pigtail',
  SRG27710: '10kA Surge Suppressor (Field Replaceable), 120-277V',
  SRG48010: '10kA Surge Suppressor (Field Replaceable), 347-480V',
  BPC1: 'Button Photocontrol, 120-277V',
  BPC3: 'Button Photocontrol, 347V',
  BPC4: 'Button Photocontrol, 480V',
  N5P: 'NEMA 5pin Twist-Lock Receptacle (Not Available With FT Finial Top)',
  MPS:
    'Programmable Motion Sensor w/ ON/OFF + Dimming + Photocontrol, Bluetooth Settings ' +
    'Adjustable, maximum coverage of 100’ diameter from 40’ mounting height ' +
    '(Available On PM Mount Only) (Not Available With FB Finial Bottom)',
  TLPC1: 'Twist-Lock Photocell, 120-277V (Not Installed) (Requires N5P Receptacle)',
  TLPC4: 'Twist-Lock Photocell, 347/480V (Not Installed) (Requires N5P Receptacle)',
  'BLP-MVX': 'Back Light Lens Panel (Match Fixture Finish)',
  GFX: 'Wireless DMX Lighting Control System (Consult Factory)',
  GFM: 'Wireless Mesh Lighting Control System (Consult Factory)',
  FT: 'Decorative Finial Top (Available With 3T Mount Only)',
  FB: 'Decorative Finial Bottom (Available On PM Mount Only)',
}

/** Which mounting each conditional code is restricted to, per the sheet. */
const MOUNT_ONLY: Record<string, '3T' | 'PM'> = {
  'CL-MVX-3T': '3T',
  'DL-MVX-3T': '3T',
  FT: '3T',
  'CL-MVX-PM': 'PM',
  'DL-MVX-PM': 'PM',
  FB: 'PM',
  MPS: 'PM',
}

function optionValues(cat: Catalog): Map<string, { optKey: string; value: SpecOptionValue }> {
  const part = partById(cat, MVX)
  expect(part, 'mvx-coach is in the catalog').toBeDefined()
  const out = new Map<string, { optKey: string; value: SpecOptionValue }>()
  for (const opt of part!.options ?? []) {
    if (opt.group !== 'options-accessories') continue
    for (const value of opt.values) out.set(value.code, { optKey: opt.key, value })
  }
  return out
}

describe('MVX ordering table matches its spec sheet (Rev. V08182026 p8)', () => {
  const codes = optionValues(catalog)

  it('offers exactly the sheet’s 22 option/accessory codes, and nothing else', () => {
    expect([...codes.keys()].sort()).toEqual(Object.keys(SHEET).sort())
  })

  it('carries every label VERBATIM from the sheet', () => {
    for (const [code, label] of Object.entries(SHEET)) {
      expect(codes.get(code)!.value.label, code).toBe(label)
    }
  })

  it('distinguishes the clear from the frosted lens on each mount', () => {
    // The regression that made this file: all four lens codes are different
    // products, and two of them had collapsed to the same string.
    const labels = ['CL-MVX-3T', 'CL-MVX-PM', 'DL-MVX-3T', 'DL-MVX-PM'].map(
      (c) => codes.get(c)!.value.label,
    )
    expect(new Set(labels).size, 'four lens codes, four distinct labels').toBe(4)
  })

  it('never splices a neighbouring column’s text onto a cord', () => {
    // WHP3NP read "2’ Cord w/o Plug, Stripped Pigtail (Requires 3T Mount) N5P
    // Receptacle)" — the lens column's mount qualifier AND the photocell
    // column's tail, welded onto a cord that has neither restriction.
    for (const code of ['WHP3NP', 'WHP7NP', 'WHP11NP']) {
      const label = codes.get(code)!.value.label
      expect(label, code).toMatch(/^\d+’ Cord w\/o Plug, Stripped Pigtail$/)
    }
  })

  it('gates each mount-conditional code to its own mounting, both ways', () => {
    const part = partById(catalog, MVX)!
    for (const [code, only] of Object.entries(MOUNT_ONLY)) {
      const { optKey, value } = codes.get(code)!
      const other = only === '3T' ? 'PM' : '3T'
      expect(valueCompatibleWithChosen(part, { mounting: only }, optKey, value), `${code} on ${only}`).toBe(true)
      expect(valueCompatibleWithChosen(part, { mounting: other }, optKey, value), `${code} on ${other}`).toBe(false)
    }
  })

  it('leaves the unrestricted codes unrestricted', () => {
    // The sheet puts no mounting restriction on cords, surge, photocontrols or
    // the receptacle — so a rule that gated everything would be just as wrong.
    const part = partById(catalog, MVX)!
    for (const code of ['WHP3NP', 'WHP7NP', 'WHP11NP', 'SRG27710', 'BPC1', 'N5P', 'TLPC1']) {
      const { optKey, value } = codes.get(code)!
      for (const mounting of ['3T', 'PM']) {
        expect(valueCompatibleWithChosen(part, { mounting }, optKey, value), `${code}/${mounting}`).toBe(true)
      }
    }
  })
})

describe('MVX part numbers (pinned against a hold-cleared catalog)', () => {
  // MVX is editorially held under the GVX + TEX cut, so `buildPartNumber`
  // returns undefined for it and the SHARED contract fixture
  // (docs/part-number-cases.json) correctly records null. These numbers are
  // pinned here instead, against a copy with the hold cleared, so the sheet's
  // own published example is guarded NOW rather than discovered whenever the
  // cut changes — the same pattern as WP-WM1-WM-BK.
  const unheld: Catalog = {
    ...catalog,
    parts: catalog.parts.map((p) => (p.id === MVX ? { ...p, comingSoon: undefined } : p)),
  }

  function cfg(mounting: string, extra: Record<string, string | string[]> = {}): PoleConfig {
    return {
      configId: 'mvx-pn',
      brand: 'WiLLstudio',
      pole: '',
      baseCover: '',
      arm: '',
      fixture: MVX,
      finish: 'matte-black',
      rev: 1,
      specOptions: {
        fixture: {
          design: 'MVX',
          'lumen-output': '80',
          'color-temp': '30',
          voltage: 'MV',
          distribution: '5W',
          mounting,
          'finish-color': 'BK',
          ...extra,
        },
      },
    }
  }

  it('reproduces the sheet’s own published example byte-exact', () => {
    // The sheet prints: Ex: WD-MVX-80-30-MV-5W-3T-BK-SRG27710
    expect(buildPartNumber(unheld, cfg('3T', { 'options-2': ['SRG27710'] }), 'fixture')).toBe(
      'WD-MVX-80-30-MV-5W-3T-BK-SRG27710',
    )
  })

  it('orders the finial as a suffix code, on the mount that takes it', () => {
    // This is the ordering half of Cole's 9/3 geometry split: the body lost its
    // finial because the finial is FT (top, 3T) or FB (bottom, PM).
    expect(buildPartNumber(unheld, cfg('3T', { accessories: ['FT'] }), 'fixture')).toBe(
      'WD-MVX-80-30-MV-5W-3T-BK-FT',
    )
    expect(buildPartNumber(unheld, cfg('PM', { accessories: ['FB'] }), 'fixture')).toBe(
      'WD-MVX-80-30-MV-5W-PM-BK-FB',
    )
  })

  it('prints no number at all while the editorial hold stands', () => {
    // Negative control on the hold itself: the shipped catalog must not emit an
    // MVX SKU, because a spec-able-looking number is exactly what a designer
    // pastes into a project spec for a product outside the cut.
    expect(buildPartNumber(catalog, cfg('3T'), 'fixture')).toBeUndefined()
  })
})
