import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  generateOutputs,
  availableFormats,
  startJob,
  getJob,
  pollJob,
  GeometryError,
  GEOMETRY_URL,
  type GeneratedFile,
} from './geometry'
import type { PoleConfig } from '../types'

const mockConfig: PoleConfig = {
  configId: 'test-uuid',
  brand: 'WiLLstudio',
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

  it('returns an empty files array when the service returns files: []', async () => {
    // The empty-files guard lives in the component (runDelivery), not in generateOutputs itself.
    // This test verifies that generateOutputs faithfully surfaces files: [] so the component
    // can detect the silent failure and throw.
    const serverResponse = {
      configHash: 'abc123',
      files: [],
      warnings: ['DWG adapter unavailable'],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => serverResponse,
    }))

    const result = await generateOutputs(mockConfig, ['dwg'])
    expect(result.files).toHaveLength(0)
    expect(result.warnings).toEqual(['DWG adapter unavailable'])
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

describe('downloadGeneratedFile', () => {
  it('throws GeometryError with network message on fetch failure', async () => {
    const { downloadGeneratedFile } = await import('./geometry')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(
      downloadGeneratedFile({
        format: 'step',
        filename: 'test.step',
        url: '/files/test.step',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(GeometryError)
    await expect(
      downloadGeneratedFile({
        format: 'step',
        filename: 'test.step',
        url: '/files/test.step',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Couldn't reach the file generator — is the geometry service running?")
  })

  it('throws GeometryError with HTTP status on non-ok response', async () => {
    const { downloadGeneratedFile } = await import('./geometry')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }))

    await expect(
      downloadGeneratedFile({
        format: 'step',
        filename: 'test.step',
        url: '/files/test.step',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(GeometryError)
    await expect(
      downloadGeneratedFile({
        format: 'step',
        filename: 'test.step',
        url: '/files/test.step',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow('404')
  })
})

const sampleFiles: GeneratedFile[] = [
  { format: 'step', filename: 'WiLL_abc.step', url: '/files/WiLL_abc.step', sizeBytes: 2048 },
]

function jobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    status: 'pending',
    progress: 0,
    stage: 'Queued',
    files: [],
    warnings: [],
    error: null,
    ...overrides,
  }
}

describe('startJob', () => {
  it('POSTs to /jobs and returns the job start response', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, opts: { body: string }) => {
      capturedUrl = url
      capturedBody = JSON.parse(opts.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ jobId: 'job-1', configHash: 'abc123', status: 'pending', cached: false }),
      })
    }))

    const result = await startJob(mockConfig, ['step', 'dxf'])
    expect(capturedUrl).toBe(`${GEOMETRY_URL}/jobs`)
    expect(capturedBody.formats).toEqual(['step', 'dxf'])
    expect((capturedBody.config as PoleConfig).configId).toBe('test-uuid')
    expect(result.jobId).toBe('job-1')
    expect(result.status).toBe('pending')
    expect(result.cached).toBe(false)
  })

  it('strips the data-URL prefix from renderPng before sending', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: unknown, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ jobId: 'j', configHash: 'x', status: 'pending', cached: false }),
      })
    }))

    await startJob(mockConfig, ['herocard'], 'data:image/png;base64,iVBORw0KGgo=')
    expect(capturedBody.renderPng).toBe('iVBORw0KGgo=')
  })

  it('returns status "done" with cached:true when the artifacts already exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: 'job-1', configHash: 'abc', status: 'done', cached: true }),
    }))

    const result = await startJob(mockConfig, ['step'])
    expect(result.status).toBe('done')
    expect(result.cached).toBe(true)
  })

  it('throws GeometryError with server detail on 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Unsupported fixture type' }),
    }))

    await expect(startJob(mockConfig, ['step'])).rejects.toThrow(GeometryError)
    await expect(startJob(mockConfig, ['step'])).rejects.toThrow('Unsupported fixture type')
  })

  it('throws GeometryError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(startJob(mockConfig, ['step'])).rejects.toThrow(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  })
})

describe('getJob', () => {
  it('GETs /jobs/{jobId} and returns the status response', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return Promise.resolve({ ok: true, json: async () => jobStatus({ status: 'running', progress: 42 }) })
    }))

    const result = await getJob('job-1')
    expect(capturedUrl).toBe(`${GEOMETRY_URL}/jobs/job-1`)
    expect(result.status).toBe('running')
    expect(result.progress).toBe(42)
  })

  it('throws GeometryError with an expired message on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(getJob('nope')).rejects.toThrow(GeometryError)
    await expect(getJob('nope')).rejects.toThrow(/expired|no longer available/i)
  })

  it('throws GeometryError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getJob('job-1')).rejects.toThrow(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  })
})

describe('pollJob', () => {
  it('polls pending → running → done and resolves with the files', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => jobStatus({ status: 'running', progress: 10, stage: 'Meshing' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => jobStatus({ status: 'running', progress: 60, stage: 'Exporting' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => jobStatus({ status: 'done', progress: 100, stage: 'Done', files: sampleFiles, warnings: ['note'] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const progress: number[] = []
    const result = await pollJob('job-1', (p) => progress.push(p.progress), { intervalMs: 1 })

    expect(result.status).toBe('done')
    expect(result.files).toEqual(sampleFiles)
    expect(result.warnings).toEqual(['note'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // onProgress fired for the two pending polls plus the final 100.
    expect(progress).toContain(100)
    expect(progress.length).toBeGreaterThanOrEqual(2)
  })

  it('resolves immediately for a cached/done job on the first poll', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jobStatus({ status: 'done', progress: 100, files: sampleFiles }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pollJob('job-1', undefined, { intervalMs: 1 })
    expect(result.status).toBe('done')
    expect(result.files).toEqual(sampleFiles)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects with GeometryError carrying the server error message on status "error"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jobStatus({ status: 'error', error: 'Adapter blew up' }),
    }))

    await expect(pollJob('job-1', undefined, { intervalMs: 1 })).rejects.toThrow(GeometryError)
    await expect(pollJob('job-1', undefined, { intervalMs: 1 })).rejects.toThrow('Adapter blew up')
  })

  it('rejects with GeometryError when the poll request fails at the network level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(pollJob('job-1', undefined, { intervalMs: 1 })).rejects.toThrow(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  })

  it('rejects with a GeometryError timeout message when the job never finishes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jobStatus({ status: 'pending', progress: 5 }),
    }))

    await expect(
      pollJob('job-1', undefined, { intervalMs: 5, timeoutMs: 20 }),
    ).rejects.toThrow(/taking longer than expected/i)
  })
})

describe('GEOMETRY_URL', () => {
  it('is a string', () => {
    expect(typeof GEOMETRY_URL).toBe('string')
  })
})
