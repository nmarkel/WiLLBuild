import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANGLES_FOR_SLOT,
  assertNoPlaceholderForRealPart,
  placeholderGraftChildren,
  poleGraftPlan,
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
  it('grafts the hand-hole cover AND the base plate onto a real pole', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    const graft = placeholderGraftChildren(pole)
    // Phase 0.14 (Tyler 8/14): two box children — the cover (proud of the
    // shaft) and the anchor-base plate (on the axis at y=0, 8.63in square
    // for the 4in pole per Tyler's base drawings; 1in thickness assumed).
    expect(graft).toHaveLength(2)
    const cover = graft.find((c) => c.position[0] > 0)
    const plate = graft.find((c) => c.name === 'base-plate')
    expect(cover?.spec.kind).toBe('box')
    expect(cover?.position).toEqual([0.0508, 0.3175, 0])
    expect(plate?.spec.kind).toBe('box')
    expect(plate?.position).toEqual([0, 0, 0])
    expect(plate?.spec.sizeM[0]).toBeCloseTo(8.63 * 0.0254, 3)
    expect(plate?.spec.sizeM[0]).toBe(plate?.spec.sizeM[2])
  })

  it('grafts nothing onto parts whose real geometry is already complete', () => {
    for (const id of ['gvx-pendant', 'sh1-shepherds-hook', 'bc-cl1-small-clamshell']) {
      const part = catalog.parts.find((p) => p.id === id)
      expect(placeholderGraftChildren(part)).toEqual([])
    }
  })

  // Phase 0.14 (Tyler 8/14): with Cole's HH-4R GLB on the machine the graft is
  // real frame + cover plate TOGETHER — measured first: the real opening is
  // flush and vanishes alone at 360 px/m, which would delete the 0° homing
  // reference. The plate (a real installed hand hole's cover, proud of the
  // opening) keeps the reference visible; the frame adds the true geometry.
  it('grafts the real HH-4R section AND keeps the cover plate when the GLB is present', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    const plan = poleGraftPlan(pole, { glbPresent: true, baseGlbPresent: false })
    expect(plan.boxes).toHaveLength(2) // cover + base plate (0.14)
    expect(plan.glbs).toHaveLength(1)
    expect(plan.glbs[0].glb).toMatch(/willstudio-acc-hand-hole\.glb$/)
    // Positioned to keep the COVER's vertical CENTRE (cover base + h/2), on
    // the pole axis — the frame anchors on the cover, never the base plate.
    const cover = plan.boxes.find((b) => b.position[0] > 0)
    expect(plan.glbs[0].position).toEqual([0, cover.position[1] + cover.spec.sizeM[1] / 2, 0])
  })

  // Phase 0.17 (Tyler 8/19): Cole's 4-RND-STANDARD-BASE is the standard base
  // detail — its GLB REPLACES the placeholder plate box outright (the casting
  // is fully visible, unlike the flush hand hole whose cover stays).
  it('the real standard base replaces the plate box when its GLB is present', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    const plan = poleGraftPlan(pole, { glbPresent: true, baseGlbPresent: true })
    expect(plan.boxes.some((b) => b.name === 'base-plate')).toBe(false)
    expect(plan.boxes).toHaveLength(1) // the hand-hole cover stays
    expect(plan.glbs.map((g) => g.glb)).toEqual([
      'real-assets/glb/willstudio-pole-base-standard.glb',
      'real-assets/glb/willstudio-acc-hand-hole.glb',
    ])
    expect(plan.glbs[0].position).toEqual([0, 0, 0])
  })

  it('falls back to the box grafts alone on a machine without the accessory GLBs', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    const plan = poleGraftPlan(pole, { glbPresent: false, baseGlbPresent: false })
    expect(plan.glbs).toEqual([])
    expect(plan.boxes).toHaveLength(2)
  })

  it('plans no graft for non-pole parts', () => {
    const arm = catalog.parts.find((p) => p.id === 'sh1-shepherds-hook')
    expect(poleGraftPlan(arm, { glbPresent: true })).toEqual({ boxes: [], glbs: [] })
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

describe('per-slot supersampling (Phase 0.16 candidate c)', () => {
  it('supersamples every assembly slot a zoomed view can smear', async () => {
    const { supersampleForSlot } = await import('./generate.mjs')
    expect(supersampleForSlot('fixture')).toBe(4)
    expect(supersampleForSlot('baseCover')).toBe(4)
    expect(supersampleForSlot('arm')).toBe(2)
    // 0.16.5: poles joined at 2x — a 4in pole is ~37px wide at 1x and smears
    // "translucent" next to a 4x base cover; 2x fits the 20 ft pole under the
    // raised 8192px canvas cap.
    expect(supersampleForSlot('pole')).toBe(2)
    expect(supersampleForSlot('banner')).toBe(1)
    expect(supersampleForSlot('standalone')).toBe(1)
    expect(supersampleForSlot(undefined)).toBe(1)
  })

  it('divides entries back to rig density using the density the page REPORTS', async () => {
    const { entryAtRigDensity } = await import('./generate.mjs')
    // the GVX case measured in the 0.16 diagnosis: 1440 px/m file, 360 rig
    expect(
      entryAtRigDensity({ width: 702, height: 716, anchorX: 351, anchorY: 10, pxPerMeter: 1440 }, 360),
    ).toEqual({ width: 175.5, height: 179, anchor: [87.75, 2.5] })
    // cap guard halved a 4x request to 2x: factor must follow the RESULT
    expect(
      entryAtRigDensity({ width: 400, height: 200, anchorX: 100, anchorY: 50, pxPerMeter: 720 }, 360),
    ).toEqual({ width: 200, height: 100, anchor: [50, 25] })
    // un-supersampled result passes through unchanged (and tolerates a page
    // that predates the pxPerMeter field)
    expect(
      entryAtRigDensity({ width: 185, height: 188, anchorX: 92.5, anchorY: 7 }, 360),
    ).toEqual({ width: 185, height: 188, anchor: [92.5, 7] })
  })
})
