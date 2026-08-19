import { describe, expect, it } from 'vitest'
import { displayArmName, displayPartName } from './display'

describe('displayPartName', () => {
  it('strips the redundant brand prefix', () => {
    expect(displayPartName('WiLLstudio® DWX Flood & Spot')).toBe('DWX Flood & Spot')
    expect(displayPartName('SH1 Shepherds Hook')).toBe('SH1 Shepherds Hook')
  })
})

// Phase 0.17 (Tyler 8/19): bracket cards show the sheet name MINUS the PN —
// the code lives in the card's right-hand chip, so the name must not repeat it.
describe('displayArmName', () => {
  it('strips a leading model code', () => {
    expect(displayArmName({ name: 'SH1 Shepherds Hook', modelCodes: { 1: 'SH1' } })).toBe(
      'Shepherds Hook',
    )
    expect(displayArmName({ name: 'PM1 Pendant Arm', modelCodes: { 1: 'PM1' } })).toBe(
      'Pendant Arm',
    )
  })

  it('strips the consolidated X-form of the model codes (HSX from HS1/HS2)', () => {
    expect(
      displayArmName({
        name: 'WiLLstudio® HSX Decorative Upsweep Arms',
        modelCodes: { 1: 'HS1', 2: 'HS2' },
      }),
    ).toBe('Decorative Upsweep Arms')
  })

  it('never strips a real word, even one that shares letters with a code', () => {
    expect(
      displayArmName({
        name: 'WiLLstudio® Side Shepherds Hook Pole Top Brackets',
        modelCodes: { 1: 'SS1', 2: 'SS2', 3: 'SS3', 4: 'SS4' },
      }),
    ).toBe('Side Shepherds Hook Pole Top Brackets')
    expect(
      displayArmName({
        name: 'WiLLstudio® Supported Decorative Arms',
        modelCodes: { 1: 'SD1', 2: 'SD2' },
      }),
    ).toBe('Supported Decorative Arms')
  })

  it('leaves parts without model codes alone, and never empties a name', () => {
    expect(displayArmName({ name: 'Direct Pole Mount' })).toBe('Direct Pole Mount')
    expect(displayArmName({ name: 'SH1', modelCodes: { 1: 'SH1' } })).toBe('SH1')
  })
})
