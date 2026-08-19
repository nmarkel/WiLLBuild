import { describe, expect, it } from 'vitest'
import { RAL_CLASSIC, nearestRal } from './ral'

// Phase 0.17 (Tyler 8/19): the live RAL cross-reference under the custom
// color picker. These pins hold the matcher to obviously-right answers so a
// palette edit or a Lab-math regression can't quietly ship absurd matches.
describe('nearestRal', () => {
  it('returns the exact shade when the hex IS a RAL approximation', () => {
    expect(nearestRal('#CC0605').ral).toBe('3020') // Traffic red
    expect(nearestRal('#FFFFFF').ral).toBe('9010') // Pure white
    expect(nearestRal('#0A0A0A').ral).toBe('9005') // Jet black
  })

  it('maps nearby colors to sensible shades', () => {
    expect(nearestRal('#000000').ral).toBe('9005') // pure black → jet black
    expect(nearestRal('#fefefe').ral).toBe('9010')
    // A saturated mid red lands on a red, never a grey or a brown.
    expect(nearestRal('#d40a10').ral.startsWith('3')).toBe(true)
  })

  it('is case- and prefix-tolerant, and survives junk input', () => {
    expect(nearestRal('cc0605').ral).toBe('3020')
    expect(nearestRal('not-a-color')).toBe(RAL_CLASSIC[0])
  })

  it('the palette is well-formed', () => {
    expect(RAL_CLASSIC.length).toBeGreaterThan(190)
    for (const c of RAL_CLASSIC) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/i)
      expect(c.ral).toMatch(/^\d{4}$/)
      expect(c.name.length).toBeGreaterThan(2)
    }
    // No duplicate RAL numbers.
    expect(new Set(RAL_CLASSIC.map((c) => c.ral)).size).toBe(RAL_CLASSIC.length)
  })
})
