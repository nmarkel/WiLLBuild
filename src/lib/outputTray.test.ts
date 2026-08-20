import { describe, expect, it } from 'vitest'
import { DELIVERABLE_DEFS } from '../components/OutputTray'

/**
 * Phase 0.17 (Tyler 8/19): the downloads distillation — one card per
 * audience, nothing fake. These pins keep the cut deliberate: re-adding the
 * mock RFA, the mislabeled standalone STEP, or the unimplemented IES card
 * should be a conscious decision that updates this test (RFA legitimately
 * returns when the Autodesk APS integration is real — Nick's call).
 */
describe('downloads tray (distilled, Phase 0.17)', () => {
  it('requests exactly the five real service formats', () => {
    expect(DELIVERABLE_DEFS.map((d) => d.format)).toEqual([
      'herocard',
      'pdf',
      'dxf',
      'ifc',
      'bundle',
    ])
  })

  it('never offers the cut formats: no mock RFA, no standalone STEP, no IES', () => {
    const formats = new Set<string>(DELIVERABLE_DEFS.map((d) => d.format))
    expect(formats.has('rfa')).toBe(false)
    expect(formats.has('step')).toBe(false)
    expect(formats.has('ies')).toBe(false)
  })

  it('every card names its audience and none claims exact geometry', () => {
    for (const d of DELIVERABLE_DEFS) {
      expect(d.audience).toMatch(/^For /)
      expect(d.formatLabel.toLowerCase()).not.toContain('exact')
    }
    // The ZIP is honest about what its STEP is.
    const bundle = DELIVERABLE_DEFS.find((d) => d.format === 'bundle')!
    expect(bundle.formatLabel).toContain('concept STEP')
  })
})
