import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { defaultConfig, exclusiveFamily, repairConfig, specCodes } from './compat'
import { useConfigurator } from '../store'

/**
 * Phase 0.11 (Workstream C): the store's exclusive-family swap, exercised end
 * to end for the new CF family. `repairConfig` is the backstop that rejects a
 * crafted URL carrying two CF codes (covered in compat.test.ts); this covers
 * the interactive path — clicking CF3 while CF1 is on must SWAP, not stack, and
 * clicking the selected one must clear it (the UI renders these as
 * de-selectable radios, so both directions have to work).
 *
 * These tests run in the default node environment, so the store's URL sync
 * needs a minimal window stub — the assertions never look at it.
 */

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

const initial = useConfigurator.getState()
const realWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = {
    history: { replaceState: () => {} },
    location: { href: 'https://example.test/studio/design' },
  }
})

afterEach(() => {
  useConfigurator.setState(initial, true)
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window
  else (globalThis as { window?: unknown }).window = realWindow
})

function load(overrides: Partial<PoleConfig> = {}) {
  // SH1 mounts pendant fixtures, so the GVX is what keeps it through repair.
  const config = repairConfig(catalog, {
    ...defaultConfig(catalog, 'WiLLstudio'),
    fixture: 'gvx-pendant',
    arm: 'sh1-shepherds-hook',
    ...overrides,
  })
  useConfigurator.setState({ catalog, config, view: { kind: 'builder' }, brand: 'WiLLstudio' })
  return config
}

const armCodes = (key = 'center-feature') =>
  specCodes(useConfigurator.getState().config?.specOptions?.arm?.[key])

describe('toggleSpecOption — centre-feature single-select (Phase 0.11, C2)', () => {
  it('CF1/CF2/CF3 are one exclusive family, so only one can be on', () => {
    expect(exclusiveFamily('CF1')).toBe('center-feature')
    load()
    const { toggleSpecOption } = useConfigurator.getState()
    toggleSpecOption('arm', 'center-feature', 'CF1')
    expect(armCodes()).toEqual(['CF1'])
    toggleSpecOption('arm', 'center-feature', 'CF3')
    expect(armCodes()).toEqual(['CF3'])
    toggleSpecOption('arm', 'center-feature', 'CF2')
    expect(armCodes()).toEqual(['CF2'])
  })

  it('clicking the selected code clears it — none of these is mandatory', () => {
    load()
    const { toggleSpecOption } = useConfigurator.getState()
    toggleSpecOption('arm', 'center-feature', 'CF2')
    expect(armCodes()).toEqual(['CF2'])
    toggleSpecOption('arm', 'center-feature', 'CF2')
    expect(armCodes()).toEqual([])
  })

  it('switching to an arm without the column drops the choice', () => {
    load()
    useConfigurator.getState().toggleSpecOption('arm', 'center-feature', 'CF1')
    expect(armCodes()).toEqual(['CF1'])
    // Phase 0.12 (D): this used to switch to pa1-pendant-arm, which is now
    // Coming Soon — the store refuses to select it, so nothing changed and the
    // test passed for no reason. The side shepherds hook is GVX-compatible,
    // real-CAD (so selectable) and has no centre-feature column, which is the
    // property under test.
    useConfigurator.getState().select('arm', 'willstudio-side-shepherds-hook-pole-top-brackets')
    expect(useConfigurator.getState().config?.arm).toBe(
      'willstudio-side-shepherds-hook-pole-top-brackets',
    )
    expect(useConfigurator.getState().config?.specOptions?.arm).toBeUndefined()
  })
})

describe('toggleSpecOption — genuinely multi-select values still stack', () => {
  it('two unrelated accessory codes coexist on one part', () => {
    // The single-select rendering must not leak into ordinary accessories.
    load({ fixture: 'drx-post-top', arm: 'direct-mount' })
    const { toggleSpecOption } = useConfigurator.getState()
    toggleSpecOption('fixture', 'options-2', 'BPC1')
    toggleSpecOption('fixture', 'options-2', 'N5P')
    const codes = specCodes(useConfigurator.getState().config?.specOptions?.fixture?.['options-2'])
    expect(codes).toContain('BPC1')
    expect(codes).toContain('N5P')
  })
})
