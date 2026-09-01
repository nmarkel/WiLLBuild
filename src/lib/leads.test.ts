import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { submitLead, getContact, CONTACT_FALLBACK_EMAIL, type LeadContext } from './leads'

/**
 * Phase 0.20 (Workstream A).
 *
 * The behaviour under test is mostly about what happens when capture FAILS,
 * because the bug being fixed was a gate that always appeared to succeed. The
 * rule these tests hold: the local "don't re-ask" cache is written only when
 * the server actually stored the lead. Any other outcome must leave the
 * visitor un-remembered, so the next attempt asks again instead of silently
 * treating them as captured.
 */

const CTX: LeadContext = {
  configId: 'cfg-0001',
  partNumbers: ['WD-GVX-80-30-MV-5W-BK-WHP7NP', 'RSAA-4040-20-BK'],
  shareUrl: 'https://build.willbrands.com/studio/design?fixture=gvx-pendant',
  deliverable: 'bundle',
  company: 'Ruiz Lighting Design',
}

const CONTACT = { name: 'Dana Ruiz', email: 'dana@example-eng.com' }

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * This repo deliberately has no jsdom (see CLAUDE.md), so `localStorage` does
 * not exist in the test environment. A ~10-line in-memory stand-in is cheaper
 * and clearer than adding DOM test infrastructure for one Storage API, and it
 * keeps these tests exercising the real module rather than a mocked one.
 */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('submitLead', () => {
  it('sends the configuration context, not just the contact', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deduped: false }))
    vi.stubGlobal('fetch', fetchMock)

    await submitLead(CONTACT, CTX)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/leads$/)
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.email).toBe(CONTACT.email)
    // A lead detached from what they configured is just a name.
    expect(sent.partNumbers).toEqual(CTX.partNumbers)
    expect(sent.configId).toBe('cfg-0001')
    expect(sent.shareUrl).toBe(CTX.shareUrl)
    expect(sent.deliverable).toBe('bundle')
    expect(sent.company).toBe('Ruiz Lighting Design')
  })

  it('remembers the visitor after the server stores the lead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { deduped: false })))

    const outcome = await submitLead(CONTACT, CTX)

    expect(outcome).toEqual({ ok: true, deduped: false })
    expect(getContact()).toEqual(CONTACT)
  })

  it('reports a dedupe as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { deduped: true })))
    const outcome = await submitLead(CONTACT, CTX)
    expect(outcome).toEqual({ ok: true, deduped: true })
  })

  it('does NOT remember the visitor when no store is configured', async () => {
    // The 503 the service returns until the S3 bucket exists. Remembering the
    // contact here would mean this person is never asked again AND was never
    // captured — the exact silent loss this workstream exists to prevent.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(503, { detail: 'Lead capture is not configured' })),
    )

    const outcome = await submitLead(CONTACT, CTX)

    expect(outcome.ok).toBe(false)
    expect(getContact()).toBeNull()
  })

  it('points at a human when the failure is ours', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502, {})))
    const outcome = await submitLead(CONTACT, CTX)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.contactFallback).toBe(true)
    expect(outcome.message).toContain(CONTACT_FALLBACK_EMAIL)
  })

  it('does not offer the fallback address for a validation error', async () => {
    // A 422 is the visitor's to fix. Telling them to email quotes@ because
    // they mistyped their own address sends a fixable form into a mailbox.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { detail: "'nope' is not a valid email address" })),
    )

    const outcome = await submitLead(CONTACT, CTX)

    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.contactFallback).toBe(false)
    expect(outcome.message).toContain('not a valid email')
    expect(getContact()).toBeNull()
  })

  it('survives the service being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const outcome = await submitLead(CONTACT, CTX)

    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.contactFallback).toBe(true)
    expect(outcome.message).toContain(CONTACT_FALLBACK_EMAIL)
    expect(getContact()).toBeNull()
  })
})
