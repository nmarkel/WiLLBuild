import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateOutputs, availableFormats, GeometryError, GEOMETRY_URL } from './geometry'
import type { PoleConfig } from '../types'

const mockConfig: PoleConfig = {
  configId: 'test-uuid',
  pole: 'alum-pole-20',
  baseCover: 'bc-fluted',
  arm: 'sh1-shepherds-hook',
  fixture: 'gvx-pendant',
  finish: 'matte-black',
  rev: 1,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateOutputs', () => {
  it('parses a successful response', async () => {
    const serverResponse = {
      configHash: 'abc123',
      files: [
        { format: 'step', filename: 'WiLL_abc123.step', url: '/files/WiLL_abc123.step', sizeBytes: 204800 },
        { format: 'dxf', filename: 'WiLL_abc123.dxf', url: '/files/WiLL_abc123.dxf', sizeBytes: 51200 },
      ],
      warnings: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => serverResponse,
    }))

    const result = await generateOutputs(mockConfig, ['step', 'dxf'])
    expect(result.configHash).toBe('abc123')
    expect(result.files).toHaveLength(2)
    expect(result.files[0].filename).toBe('WiLL_abc123.step')
    expect(result.files[0].url).toBe('/files/WiLL_abc123.step')
    expect(result.warnings).toEqual([])
  })

  it('throws GeometryError with user-facing message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow(GeometryError)
    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  })

  it('throws GeometryError with server detail string on 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Unsupported fixture type' }),
    }))

    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow(GeometryError)
    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow('Unsupported fixture type')
  })

  it('throws GeometryError with plain-language message on other non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }))

    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow(GeometryError)
    await expect(generateOutputs(mockConfig, ['step'])).rejects.toThrow('500')
  })

  it('strips the data-URL prefix from renderPng before sending', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: unknown, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body)
      return Promise.resolve({ ok: true, json: async () => ({ configHash: 'x', files: [], warnings: [] }) })
    }))

    await generateOutputs(mockConfig, ['step'], 'data:image/png;base64,iVBORw0KGgo=')
    expect(capturedBody.renderPng).toBe('iVBORw0KGgo=')
  })

  it('passes raw base64 through unchanged when no data-URL prefix', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: unknown, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body)
      return Promise.resolve({ ok: true, json: async () => ({ configHash: 'x', files: [], warnings: [] }) })
    }))

    await generateOutputs(mockConfig, ['step'], 'iVBORw0KGgo=')
    expect(capturedBody.renderPng).toBe('iVBORw0KGgo=')
  })
})

describe('availableFormats', () => {
  it('maps health adapters: true entries become the set, false entries are excluded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', adapters: { step: true, dwg: false, dxf: true, ifc: false } }),
    }))

    const formats = await availableFormats()
    expect(formats).toEqual(new Set(['step', 'dxf']))
  })

  it('returns empty set when service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const formats = await availableFormats()
    expect(formats).toEqual(new Set())
  })

  it('returns empty set when health response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }))

    const formats = await availableFormats()
    expect(formats).toEqual(new Set())
  })
})

describe('GEOMETRY_URL', () => {
  it('is a string', () => {
    expect(typeof GEOMETRY_URL).toBe('string')
  })
})
