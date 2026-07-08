import type { Catalog, PoleConfig } from '../types'
import { partsForSlot } from './compat'

export interface ParseResult {
  /** Slot selections recognized in the text; absent keys were not mentioned. */
  matched: Partial<Pick<PoleConfig, 'fixture' | 'arm' | 'pole' | 'finish'>>
  /** The phrases that produced each match, for UI feedback. */
  matchedTerms: string[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(text)
}

/** Longest matching keyword wins so "tex post top" beats the generic "post top". */
function pickByKeywords<T extends { id: string; keywords: string[] }>(
  text: string,
  candidates: T[],
): { id: string; term: string } | null {
  let best: { id: string; term: string } | null = null
  for (const candidate of candidates) {
    for (const keyword of candidate.keywords) {
      if (containsPhrase(text, keyword) && (!best || keyword.length > best.term.length)) {
        best = { id: candidate.id, term: keyword }
      }
    }
  }
  return best
}

/**
 * Deterministic keyword parser for the "Describe Your Product" box — no LLM.
 * Matches fixture type, arm style, pole height, and finish against catalog
 * metadata; everything else in the text is ignored gracefully. Real intent
 * parsing is Phase 1+.
 */
export function parseDescription(catalog: Catalog, text: string): ParseResult {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const matched: ParseResult['matched'] = {}
  const matchedTerms: string[] = []

  const fixture = pickByKeywords(normalized, partsForSlot(catalog, 'fixture'))
  if (fixture) {
    matched.fixture = fixture.id
    matchedTerms.push(fixture.term)
  }

  const arm = pickByKeywords(normalized, partsForSlot(catalog, 'arm'))
  if (arm) {
    matched.arm = arm.id
    matchedTerms.push(arm.term)
  }

  // "20ft pole", "20 ft", "20 foot", "20'" — pick the pole nearest that height.
  const height = normalized.match(/(\d+(?:\.\d+)?)\s*(?:ft|foot|feet|')/)
  if (height) {
    const wantFt = parseFloat(height[1])
    const poles = partsForSlot(catalog, 'pole').filter((p) => p.heightFt != null)
    const nearest = poles.reduce((best, p) =>
      Math.abs(p.heightFt! - wantFt) < Math.abs(best.heightFt! - wantFt) ? p : best,
    )
    matched.pole = nearest.id
    matchedTerms.push(height[0].trim())
  }

  const finish = pickByKeywords(normalized, catalog.finishes)
  if (finish) {
    matched.finish = finish.id
    matchedTerms.push(finish.term)
  }

  return { matched, matchedTerms }
}
