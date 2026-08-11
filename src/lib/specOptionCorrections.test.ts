import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalogJson from '../../public/catalog.json'
import type { Catalog, SpecOption } from '../types'

/**
 * Phase 0.12 — the spec-option corrections drift guard.
 *
 * `scripts/spec-parse/parse_specs.py` assigns ordering-table cells to columns by
 * PDF x-coordinate, which merges adjacent columns on sheets with two-line
 * headers. A merged column is fatal to the part number: one column can emit only
 * ONE segment, so whichever of the two the customer did not pick is silently
 * dropped from a customer-facing SKU.
 *
 * Before 0.12 those fixes were edited straight into public/catalog.json, which
 * made re-running scripts/merge-spec-options.mjs silently revert them (the
 * HAZARD note that used to head that script). The fixes are now declarative, in
 * docs/spec-option-corrections.json.
 *
 * This suite pins the two files together: the shipped catalog must actually be
 * in the corrected state, and it must match the corrections file exactly. If
 * someone hand-edits a corrected column in the catalog, or edits the corrections
 * file without re-running the applier, this fails.
 *
 *   node scripts/apply-spec-option-corrections.mjs
 */

const catalog = catalogJson as unknown as Catalog
const CORRECTIONS_PATH = resolve(__dirname, '../../docs/spec-option-corrections.json')

interface Rule {
  rawKey: string
  why: string
  columns: SpecOption[]
}
interface CorrectionsFile {
  products: Record<string, { reason: string; replace: Rule[] }>
}

const corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')) as CorrectionsFile

const handleFromUrl = (url: string | undefined) =>
  url?.match(/\/products\/([^/?#]+)/)?.[1] ?? null

const partsFor = (handle: string) =>
  catalog.parts.filter((p) => handleFromUrl(p.productUrl) === handle && p.options)

describe('spec-option corrections are applied in the shipped catalog', () => {
  const entries = Object.entries(corrections.products)

  it('covers at least the two sheets with known column merges', () => {
    expect(entries.length).toBeGreaterThanOrEqual(2)
  })

  for (const [handle, entry] of entries) {
    describe(handle, () => {
      it('matches at least one catalog part', () => {
        expect(partsFor(handle).length).toBeGreaterThan(0)
      })

      for (const rule of entry.replace) {
        it(`${rule.rawKey} -> ${rule.columns.map((c) => c.key).join(' + ')}`, () => {
          for (const part of partsFor(handle)) {
            const keys = part.options!.map((o) => o.key)

            // The merged column must be gone — unless the split legitimately
            // re-emits a column under the same key.
            const reemitted = rule.columns.some((c) => c.key === rule.rawKey)
            if (!reemitted) {
              expect(keys, `${part.id} still carries merged column ${rule.rawKey}`).not.toContain(
                rule.rawKey,
              )
            }

            // Every corrected column present, with exactly the reviewed content.
            for (const col of rule.columns) {
              const actual = part.options!.find((o) => o.key === col.key)
              expect(actual, `${part.id} missing corrected column ${col.key}`).toBeDefined()
              expect(actual).toEqual(col)
            }
          }
        })
      }
    })
  }

  it('leaves every corrected ordering column in a stable sheet order', () => {
    // Fractional orderPositions keep a split adjacent to its neighbours without
    // renumbering the sheet; duplicates would make the segment order ambiguous.
    for (const part of catalog.parts) {
      const ordering = (part.options ?? []).filter((o) => o.group === 'ordering')
      const positions = ordering.map((o) => o.orderPosition)
      expect(new Set(positions).size, `${part.id} has duplicate orderPositions`).toBe(
        positions.length,
      )
    }
  })
})
