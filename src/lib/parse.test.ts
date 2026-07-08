import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../types'
import { parseDescription } from './parse'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

describe('parseDescription', () => {
  it('resolves the Phase 0.1 acceptance phrase', () => {
    const { matched } = parseDescription(
      catalog,
      'I want a 10k lm decorative pendant light on a 20ft pole with shepherds hook arm in a black finish',
    )
    expect(matched).toEqual({
      fixture: 'gvx-pendant',
      arm: 'sh1-shepherds-hook',
      pole: 'alum-pole-20',
      finish: 'matte-black',
    })
  })

  it('prefers the most specific keyword ("tex post top" is TEX, not the generic post top)', () => {
    expect(parseDescription(catalog, 'a tex post top').matched.fixture).toBe('tex-post-top')
    expect(parseDescription(catalog, 'a post top light').matched.fixture).toBe('drx-post-top')
  })

  it('matches coach fixtures and upsweep arms', () => {
    const { matched } = parseDescription(catalog, 'coach light on an upsweep arm')
    expect(matched.fixture).toBe('mvx-coach')
    expect(matched.arm).toBe('upsweep')
  })

  it('picks the nearest pole height', () => {
    expect(parseDescription(catalog, 'a 15 ft pole').matched.pole).toBe('alum-pole-14')
    expect(parseDescription(catalog, "a 30' pole").matched.pole).toBe('alum-pole-20')
  })

  it('ignores unmatched words gracefully', () => {
    const { matched, matchedTerms } = parseDescription(catalog, 'a purple elephant riding a bicycle')
    expect(matched).toEqual({})
    expect(matchedTerms).toEqual([])
  })

  it('does not confuse lumen counts with pole heights', () => {
    expect(parseDescription(catalog, 'a 10k lm pendant').matched.pole).toBeUndefined()
  })
})
