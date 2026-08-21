import { describe, expect, it } from 'vitest'
import { FINISHABLE_RAL, RAL_CLASSIC, finishableRal, nearestRal } from './ral'

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

// Phase 0.18 (Tyler 8/20): matching is restricted to what WiLL can SPRAY.
describe('finishable-only matching', () => {
  it('carries the coater list and every code exists in the palette', () => {
    expect(FINISHABLE_RAL.size).toBe(185)
    const palette = new Set(RAL_CLASSIC.map((c) => c.ral))
    for (const code of FINISHABLE_RAL) expect(palette.has(code), `RAL ${code}`).toBe(true)
    expect(finishableRal()).toHaveLength(FINISHABLE_RAL.size)
  })

  it('never proposes a shade WiLL cannot finish', () => {
    // Sweep the cube: every match must be finishable, whatever the input.
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          expect(FINISHABLE_RAL.has(nearestRal(hex).ral), hex).toBe(true)
        }
  })

  it('excludes a palette colour the coater does not carry', () => {
    // RAL 9006 White aluminium is in the RAL standard but not on the list.
    expect(FINISHABLE_RAL.has('9006')).toBe(false)
    expect(nearestRal('#A5A5A5').ral).not.toBe('9006')
  })
})
