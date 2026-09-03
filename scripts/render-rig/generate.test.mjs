import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANGLES_FOR_SLOT,
  assertNoPlaceholderForRealPart,
  baseCoverGraftChildren,
  placeholderGraftChildren,
  poleGraftPlan,
} from './generate.mjs'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
/**
 * The supersample factor a shipped layer was rendered at: its webp's real
 * canvas width over the manifest entry's width (which the rig divides back to
 * rig density). Reads the VP8X canvas fields directly — the rig writes
 * extended webp, whose 24-bit LE width-1/height-1 sit at a fixed offset — so
 * the test needs no image library.
 */
function webpFactor(manifest, partId) {
  const entry = manifest.parts[partId]?.angles?.hero?.finishes?.['matte-black']
  if (!entry) throw new Error(`no hero/matte-black entry for ${partId}`)
  const buf = readFileSync(`public/${entry.file}`)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${entry.file} is not a RIFF/WEBP file`)
  }
  if (buf.toString('ascii', 12, 16) !== 'VP8X') {
    throw new Error(`${entry.file}: expected an extended (VP8X) webp`)
  }
  const width = buf.readUIntLE(24, 3) + 1
  return Math.round((width / entry.width) * 100) / 100
}

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

describe('base-cover stub is a hole-punch occluder (Phase 0.17.5)', () => {
  it('marks the stub holePunch so the opening becomes a window to the real pole', () => {
    // Tyler's 8/20 stub made the opening read as a recessed PLUG in the
    // cover's own finish — the pole visually ended at the rim ("the poles
    // look like they are behind the base covers", Nick 8/20). A holePunch
    // child renders depth-only (no color), so the bore interior is erased
    // from the cover layer and the REAL pole layer shows through the
    // opening in the pole's own finish.
    const cover = catalog.parts.find((p) => p.id === 'bc-sc1-spun-collar')
    const graft = baseCoverGraftChildren(cover, 0.207)
    expect(graft).toHaveLength(2)
    const punch = graft.find((c) => c.holePunch)
    expect(punch).toBeDefined()
    expect(punch.spec.kind).toBe('pole')
    // The bore is WIDER than the pole (SC1: ~5.5 in around the 4 in shaft),
    // so the punched window exposes clearance slivers of raw scene. A dark
    // SHADOW cylinder sits behind the punch: wider than any bore, topping
    // BELOW the rim (poking above would occlude the dome itself), rendered
    // in a fixed dark material — the slivers read as the cover's shadowed
    // interior while the punch still depth-kills its center for the pole.
    const shadow = graft.find((c) => c.shadow)
    expect(shadow).toBeDefined()
    expect(shadow.holePunch).toBeUndefined()
    expect(shadow.spec.kind).toBe('pole')
    expect(shadow.spec.radiusTopM).toBeGreaterThan(punch.spec.radiusTopM)
    expect(shadow.spec.heightM).toBeLessThan(punch.spec.heightM)
  })

  it('never marks the pole hand-hole cover or base plate as holePunch', () => {
    const pole = catalog.parts.find((p) => p.id === 'alum-pole-12')
    for (const child of placeholderGraftChildren(pole)) {
      expect(child.holePunch).toBeUndefined()
    }
  })
})

describe('gvx shell source is the de-featured simple export (Phase 0.17.5)', () => {
  it('gvx-pendant carries shellGlb pointing at the simple-shell GLB', () => {
    // Nick 8/20: geometry DOWNLOADS (web shell → service shell → IFC/STEP)
    // derive from GVX-Simple.STEP, while the RENDER master stays the full
    // WD-GVX-PM (the compositor hides its stem behind the arm; a download
    // cannot). realgeom.customer_step_path already ships this same file as
    // the factory-cad STEP (Nick-confirmed 2026-08-10).
    const entry = realParts['gvx-pendant']
    expect(typeof entry).toBe('object')
    expect(entry.glb).toBe('real-assets/glb/gvx-pendant.glb')
    expect(entry.shellGlb).toBe('real-assets/glb/gvx-pendant.shell.glb')
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

// ---- Phase 0.21: mode-bearing parts, slot vs density ----
describe('a mode-bearing part occupies one slot but renders at another tier', () => {
  it('answers the two questions separately, and must keep doing so', async () => {
    const { effectiveSlot, supersampleForPart, supersampleForSlot } = await import('./generate.mjs')
    const wall = { slot: 'standalone', assemblyMode: 'wall' }
    const ground = { slot: 'standalone', assemblyMode: 'ground' }

    // "Which slot does it occupy?" — drives the layer's FINISH in the
    // compositor. A wall bracket paints in the ARM's finish; collapsing this
    // into the density rule below would paint it in the fixture's colour.
    expect(effectiveSlot(wall)).toBe('arm')
    expect(effectiveSlot(ground)).toBe('fixture')

    // "How densely should it render?" — driven by how it is VIEWED. Wall mode
    // fits the whole unit to the frame (~2.5x, ~903 px/m); the arm tier's 2x
    // supplies 716 and the bracket came out visibly softer than the GVX
    // (4x = 1432 px/m) beside it. So a mode part takes the fixture tier.
    expect(supersampleForPart(wall)).toBe(4)
    expect(supersampleForPart(ground)).toBe(4)
    expect(supersampleForPart(wall)).not.toBe(supersampleForSlot(effectiveSlot(wall)))
  })

  it('leaves every ordinary part on its own slot tier', async () => {
    const { supersampleForPart } = await import('./generate.mjs')
    expect(supersampleForPart({ slot: 'fixture' })).toBe(4)
    expect(supersampleForPart({ slot: 'baseCover' })).toBe(4)
    expect(supersampleForPart({ slot: 'arm' })).toBe(2)
    expect(supersampleForPart({ slot: 'pole' })).toBe(2)
    expect(supersampleForPart({ slot: 'standalone' })).toBe(1)
  })

  it('gives the shipped wall brackets the same density as the fixture they carry', () => {
    // Guards the actual ASSETS, not just the rule: read each webp's real
    // canvas size and compare it with the manifest entry, which is stored
    // divided back to rig density. The ratio IS the supersample factor the
    // file was rendered at, so this fails if the parts are ever re-rendered
    // under the old arm tier — which is what made the bracket look soft
    // beside the GVX (716 px/m against a ~903 px/m wall-mode view).
    const manifest = JSON.parse(readFileSync('public/renders/manifest.json', 'utf-8'))
    const fixtureFactor = webpFactor(manifest, 'gvx-pendant')
    expect(fixtureFactor).toBe(4)
    for (const part of catalog.parts.filter((p) => p.assemblyMode !== undefined)) {
      expect(webpFactor(manifest, part.id), part.id).toBe(fixtureFactor)
    }
  })
})
