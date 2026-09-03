import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, CatalogPart, PlaceholderSpec } from '../types'
import { partById } from './compat'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const IN = 0.0254

/**
 * Phase 0.21 (Tyler, 9/3): "the wall mount proportions are incorrect to the
 * fixture ... reference the spec sheets for dimensions."
 *
 * They were. `scripts/placeholder-overrides.json` says in its own docstring
 * that its specs come from "the shape-refinement pass against the product
 * photos" — eyeballed, never dimensioned — and WM1 shipped at a 12.6 in plate
 * / 17.3 in reach / 21.7 in height against a sheet that says 8.0 / 13.0 / 11.0.
 * Next to a real-CAD GVX at true scale the bracket was 1.67x the fixture's
 * drawn height.
 *
 * This pins the placeholders to the ARMS SHEET (Rev. V08182026, page 9), which
 * is the authority Tyler named and which Cole's WM1/WM2 CAD independently
 * agrees with. A placeholder is allowed to be a rough SHAPE; it is not allowed
 * to be the wrong SIZE, because the compositor draws every part at true scale
 * against every other one.
 */
const SHEET = {
  'willstudio-wm1-single-wall-mount-pendant': { plateIn: 8.0, heightIn: 11.0, reachIn: 13.0 },
  'willstudio-wm2-single-wall-tenon-mount-w-finial': { plateIn: 8.0, heightIn: 18.0, reachIn: 13.0 },
} as const

/** Axis-aligned extent of a placeholder group, in metres. */
function extent(spec: PlaceholderSpec) {
  if (spec.kind !== 'group') throw new Error(`expected a group, got ${spec.kind}`)
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  for (const child of spec.children) {
    const s = child.spec
    const [px, py, pz] = child.position
    if (s.kind === 'box') {
      const [w, h, d] = s.sizeM
      const y0 = s.direction === 'up' ? py : py - h
      xs.push(px - w / 2, px + w / 2)
      ys.push(y0, y0 + h)
      zs.push(pz - d / 2, pz + d / 2)
    } else if (s.kind === 'pole' || s.kind === 'baseCover') {
      const r = Math.max(s.radiusTopM, s.radiusBottomM)
      xs.push(px - r, px + r)
      ys.push(py, py + s.heightM)
      zs.push(pz - r, pz + r)
    } else if (s.kind === 'lathe') {
      const r = Math.max(...s.profile.map((pt) => pt[0]))
      const py0 = Math.min(...s.profile.map((pt) => pt[1]))
      const py1 = Math.max(...s.profile.map((pt) => pt[1]))
      xs.push(px - r, px + r)
      ys.push(py + py0, py + py1)
      zs.push(pz - r, pz + r)
    }
  }
  return {
    height: Math.max(...ys) - Math.min(...ys),
    alongWall: Math.max(...zs) - Math.min(...zs),
  }
}

/** The reach the sheet dimensions: wall face to the stem/tenon AXIS. */
function reachToAxis(part: CatalogPart): number {
  const spec = part.placeholder
  if (spec?.kind !== 'group') throw new Error('expected a group')
  const round = spec.children.filter((c) => c.spec.kind === 'pole')
  expect(round.length).toBeGreaterThan(0)
  return Math.max(...round.map((c) => c.position[0]))
}

describe('wall-bracket placeholders match the arms spec sheet (Tyler, 0.21)', () => {
  for (const [id, want] of Object.entries(SHEET)) {
    describe(id, () => {
      const part = partById(catalog, id)

      it('exists and is a group placeholder', () => {
        expect(part).toBeDefined()
        expect(part!.placeholder?.kind).toBe('group')
      })

      it(`has an ${want.plateIn} in square wall plate`, () => {
        expect(extent(part!.placeholder!).alongWall / IN).toBeCloseTo(want.plateIn, 2)
      })

      it(`stands ${want.heightIn} in overall`, () => {
        expect(extent(part!.placeholder!).height / IN).toBeCloseTo(want.heightIn, 2)
      })

      it(`reaches ${want.reachIn} in to the stem axis`, () => {
        expect(reachToAxis(part!) / IN).toBeCloseTo(want.reachIn, 2)
      })

      it('carries its fixture socket at the stem axis, not at the old guessed reach', () => {
        const socket = Object.values(part!.sockets ?? {})[0]
        expect(socket).toBeDefined()
        // The socket must sit ON the stem axis — a socket left at the old
        // 0.44 m guess would hang the fixture 4 in past the end of the arm.
        expect(socket.position[0]).toBeCloseTo(reachToAxis(part!), 6)
        expect(socket.position[2]).toBe(0)
      })
    })
  }

  it('the placeholder override file and the shipped catalog agree', () => {
    // merge-inventory.mjs regenerates catalog.json from the overrides, so a
    // fix applied to only one of them silently reverts on the next run.
    const overrides = JSON.parse(readFileSync('scripts/placeholder-overrides.json', 'utf-8'))
    for (const id of Object.keys(SHEET)) {
      expect(overrides[id]).toEqual(partById(catalog, id)!.placeholder)
    }
  })
})
