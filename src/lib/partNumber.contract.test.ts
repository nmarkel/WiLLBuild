import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalogJson from '../../public/catalog.json'
import type { Catalog, PoleConfig, Slot } from '../types'
import { buildPartNumber } from './summary'

/**
 * Phase 0.11, Workstream Z1 — the cross-language drift guard.
 *
 * The 0.10.5 combine dropped the geometry-service's part-number resolver, so
 * the number existed only in the browser and generated CAD/PDF carried none.
 * 0.11 re-adds the Python mirror (`geometry-service/app/partnumber.py`). Two
 * implementations of one customer-facing SKU is exactly the setup that rots
 * silently, so both read ONE shared fixture of expected strings:
 *
 *   docs/part-number-cases.json
 *
 * This suite pins the TypeScript resolver — the reference implementation —
 * against it. `geometry-service/tests/test_partnumber.py` pins the Python one
 * against the same file. Change the resolution rules in either language and
 * the other language's suite fails until they are brought back into step.
 *
 * To regenerate after a DELIBERATE rule change:
 *   UPDATE_PN_CASES=1 npx vitest run src/lib/partNumber.contract.test.ts
 * then read the diff — every changed line is a changed part number.
 */

const CASES_PATH = resolve(__dirname, '../../docs/part-number-cases.json')

interface PartNumberCase {
  name: string
  why: string
  config: PoleConfig
  expected?: Record<string, string | null>
}

interface CasesFile {
  note: string
  regenerate: string
  expectedIsNullWhen: string
  cases: PartNumberCase[]
}

const catalog = catalogJson as unknown as Catalog
const SLOTS: Slot[] = ['fixture', 'arm', 'pole', 'baseCover']
const casesFile = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as CasesFile

function resolveAll(config: PoleConfig): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const slot of SLOTS) {
    out[slot] = buildPartNumber(catalog, config, slot) ?? null
  }
  return out
}

if (process.env.UPDATE_PN_CASES) {
  // Regeneration mode: rewrite only the `expected` blocks, preserving the
  // hand-authored name/why/config so the file stays reviewable.
  for (const c of casesFile.cases) {
    c.expected = resolveAll(c.config)
  }
  writeFileSync(CASES_PATH, `${JSON.stringify(casesFile, null, 2)}\n`)
}

describe('part-number contract (shared with geometry-service)', () => {
  it('every case carries a generated expectation', () => {
    const missing = casesFile.cases.filter((c) => c.expected === undefined).map((c) => c.name)
    expect(
      missing,
      'Run: UPDATE_PN_CASES=1 npx vitest run src/lib/partNumber.contract.test.ts',
    ).toEqual([])
  })

  it.each(casesFile.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(resolveAll(c.config)).toEqual(c.expected)
  })

  it('resolves the GVX sheet ordering example exactly', () => {
    // Anchors the fixture to a number sourced from the spec sheet itself
    // rather than from our own output — the one case that is not circular.
    const config = {
      ...casesFile.cases[1].config,
      specOptions: {
        fixture: {
          'lumen-output': '80',
          'color-temp': '30',
          voltage: 'MV',
          distribution: '5W',
        },
      },
    } as PoleConfig
    // CR-OPT-06 (Tyler 8/14): the sheet example rides an SH1 bracket, so the
    // REQUIRED derived cord joins the number.
    expect(buildPartNumber(catalog, config, 'fixture')).toBe('WD-GVX-80-30-MV-5W-BK-WHP7NP')
  })

  it('a slot with no ordering data resolves to no number, never a guess', () => {
    const config = casesFile.cases.find((c) => c.config.arm === 'direct-mount')!.config
    expect(buildPartNumber(catalog, config, 'arm')).toBeUndefined()
  })

  it('per-slot finishes produce different finish segments on different parts', () => {
    const base = casesFile.cases[0].config
    const mono = buildPartNumber(catalog, base, 'pole')
    const split = buildPartNumber(
      catalog,
      { ...base, finishes: { pole: 'forest-green' } },
      'pole',
    )
    expect(mono).not.toBe(split)
    expect(split).toContain('DG')
  })
})
