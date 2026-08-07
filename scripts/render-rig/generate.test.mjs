import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANGLES_FOR_SLOT,
  assertNoPlaceholderForRealPart,
  placeholderGraftChildren,
} from './generate.mjs'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const realParts = JSON.parse(readFileSync('scripts/render-rig/real-parts.json', 'utf-8'))

describe('render rig angle coverage (spec D9)', () => {
  it('gives every slot the full 8-angle compass', () => {
    for (const slot of ['fixture', 'arm', 'pole', 'baseCover', 'banner', 'standalone']) {
      const keys = ANGLES_FOR_SLOT(slot).map((a) => a.key)
      expect(keys).toEqual([
        'hero', 'az45', 'az90', 'az135', 'az180', 'az225', 'az270', 'az315',
      ])
    }
  })

  it('covers every catalog part', () => {
    const slots = new Set(catalog.parts.map((p) => p.slot))
    for (const slot of slots) expect(ANGLES_FOR_SLOT(slot)).toHaveLength(8)
  })
})

describe('real-CAD-first rule (spec D8)', () => {
  it('throws when a part with available real geometry renders as a placeholder', () => {
    const anyRealPart = Object.keys(realParts)[0]
    expect(() =>
      assertNoPlaceholderForRealPart(anyRealPart, { realLoaded: false, glbPresent: true }),
    ).toThrow(/real geometry available/i)
  })

  it('allows a placeholder for a part with no real geometry mapped', () => {
    expect(() =>
      assertNoPlaceholderForRealPart('definitely-not-a-real-part', {
        realLoaded: false,
        glbPresent: false,
      }),
    ).not.toThrow()
  })
})

describe('pole hand-hole graft (spec D8a)', () => {
  it('grafts the placeholder hand-hole child onto a real pole', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    const graft = placeholderGraftChildren(pole)
    expect(graft).toHaveLength(1)
    // The cover box, not the pole cylinder itself.
    expect(graft[0].spec.kind).toBe('box')
    expect(graft[0].position).toEqual([0.0508, 0.3175, 0])
  })

  it('grafts nothing onto parts whose real geometry is already complete', () => {
    for (const id of ['gvx-pendant', 'sh1-shepherds-hook', 'bc-cl1-small-clamshell']) {
      const part = catalog.parts.find((p) => p.id === id)
      expect(placeholderGraftChildren(part)).toEqual([])
    }
  })

  it('keeps the hand hole at native size and height regardless of pole length', () => {
    // The access door does not stretch with the pole — same box, same Y, on
    // every height. A graft that scaled with the pole would be a defect.
    const grafts = ['alum-pole-12', 'alum-pole-20'].map((id) =>
      placeholderGraftChildren(catalog.parts.find((p) => p.id === id)),
    )
    expect(grafts[0]).toEqual(grafts[1])
  })
})
