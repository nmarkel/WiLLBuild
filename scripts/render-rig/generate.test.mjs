import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANGLES_FOR_SLOT,
  assertNoPlaceholderForRealPart,
  placeholderGraftChildren,
} from './generate.mjs'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const realParts = JSON.parse(readFileSync('scripts/render-rig/real-parts.json', 'utf-8'))
const realGeometry = JSON.parse(readFileSync('docs/real-geometry.json', 'utf-8'))

describe('render rig angle coverage (spec D9, view set reworked in 0.11 E)', () => {
  it('gives every slot the four canonical render azimuths', () => {
    // Phase 0.11 (E): 2 full-assembly views 180° apart + component focuses
    // replaced the 45° orbit. Four azimuths remain because a radial cluster
    // shows arms pointing four ways INSIDE one view — see composite.ts
    // RENDER_AZIMUTHS. No slot is exempt (spec D9 is unchanged).
    for (const slot of ['fixture', 'arm', 'pole', 'baseCover', 'banner', 'standalone']) {
      const keys = ANGLES_FOR_SLOT(slot).map((a) => a.key)
      expect(keys).toEqual(['hero', 'az90', 'az180', 'az270'])
    }
  })

  it('covers every catalog part', () => {
    const slots = new Set(catalog.parts.map((p) => p.slot))
    for (const slot of slots) expect(ANGLES_FOR_SLOT(slot)).toHaveLength(4)
  })

  it('renders exactly the azimuths the compositor can request', () => {
    // The rig and the app must not drift: every yaw the rig bakes must be an
    // angle key composite.ts can ask for, and vice versa.
    const rigKeys = ANGLES_FOR_SLOT('arm').map((a) => a.key).sort()
    const appKeys = ['hero', 'az90', 'az180', 'az270'].sort()
    expect(rigKeys).toEqual(appKeys)
    for (const { key, yaw } of ANGLES_FOR_SLOT('arm')) {
      expect(key).toBe(yaw === 0 ? 'hero' : `az${yaw}`)
    }
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

describe('real-parts.json matches the ingest provenance record (spec D8 union)', () => {
  // docs/real-geometry.json is mechanically regenerated (write_manifest() in
  // ingest.py) from the exact same INGEST/DERIVED literals real-parts.json is
  // supposed to mirror — reading it here avoids needing Python from a vitest
  // test while still pinning against the real source of truth. "components"
  // (kind==='component') is INGEST's real STEP mappings; "clusters" reuse an
  // existing component's partId (a 2/3/4-arm cluster is not a new render-rig
  // part) so they contribute no new ids; "unmapped" entries have no partId at
  // all. "derived" is ingest.DERIVED, the axially-scaled pole heights.
  it('maps exactly the union of ingest.INGEST and ingest.DERIVED — no more, no less', () => {
    const expected = new Set([
      ...realGeometry.components.filter((c) => c.kind === 'component').map((c) => c.partId),
      ...realGeometry.derived.map((d) => d.partId),
    ])
    const actual = new Set(Object.keys(realParts))
    const missing = [...expected].filter((id) => !actual.has(id)).sort()
    const extra = [...actual].filter((id) => !expected.has(id)).sort()
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })
})
