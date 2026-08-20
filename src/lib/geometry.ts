import type { PoleConfig } from '../types'

export type OutputFormat = 'step' | 'dxf' | 'dwg' | 'ifc' | 'pdf' | 'bundle' | 'herocard' | 'rfa'

export interface GeneratedFile {
  format: string
  filename: string
  url: string
  sizeBytes: number
}

export interface GenerateResponse {
  configHash: string
  files: GeneratedFile[]
  warnings: string[]
}

// ---- Async job contract (POST /jobs, GET /jobs/{jobId}) ----

/** Response from POST /jobs — the job has been accepted (or served from cache). */
export interface JobStartResponse {
  jobId: string
  configHash: string
  status: 'pending' | 'done'
  cached: boolean
}

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

/** Response from GET /jobs/{jobId}. `files` is only populated once status === "done". */
export interface JobStatusResponse {
  jobId: string
  status: JobStatus
  progress: number
  stage: string
  files: GeneratedFile[]
  warnings: string[]
  error: string | null
}

/** Progress snapshot passed to the pollJob onProgress callback. */
export interface JobProgress {
  progress: number
  stage: string
}

export const GEOMETRY_URL: string =
  (import.meta as { env?: { VITE_GEOMETRY_URL?: string } }).env?.VITE_GEOMETRY_URL ?? 'http://localhost:8000'

export class GeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeometryError'
  }
}

/**
 * POST /generate — request one or more output formats for the given config.
 * renderPng may be a base64 data-URL (the `data:...,` prefix is stripped before sending).
 * Throws GeometryError with a user-facing message on any failure.
 */
export async function generateOutputs(
  config: PoleConfig,
  formats: OutputFormat[],
  renderPng?: string,
): Promise<GenerateResponse> {
  const body: Record<string, unknown> = { config, formats }

  if (renderPng !== undefined) {
    body.renderPng = stripRenderPngPrefix(renderPng)
  }

  let response: Response
  try {
    response = await fetch(`${GEOMETRY_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new GeometryError(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  }

  if (!response.ok) {
    if (response.status === 422) {
      const data = await response.json().catch(() => ({})) as { detail?: string }
      throw new GeometryError(data.detail ?? 'The geometry service rejected the request.')
    }
    throw new GeometryError(
      `The geometry service returned an error (${response.status}). Please try again.`,
    )
  }

  return response.json() as Promise<GenerateResponse>
}

/** Strip the `data:...;base64,` prefix from a render PNG if present. */
function stripRenderPngPrefix(renderPng: string): string {
  const commaIdx = renderPng.indexOf(',')
  return commaIdx >= 0 ? renderPng.slice(commaIdx + 1) : renderPng
}

/**
 * POST /jobs — enqueue an async generation job for the given config/formats.
 * Returns immediately with a jobId; poll GET /jobs/{jobId} (see pollJob) for progress.
 * `cached: true` with `status: "done"` means the artifacts already exist and can be
 * fetched right away. Throws GeometryError with a user-facing message on any failure.
 */
export async function startJob(
  config: PoleConfig,
  formats: OutputFormat[],
  renderPng?: string,
  /**
   * Phase 0.17: where each slot's part sits inside `renderPng` (0..1) — the
   * concept card's leader-line callouts point here, so the document labels
   * the same geometry the compositor drew. Absent → the card falls back to a
   * plain label list with no leaders.
   */
  renderAnchors?: Record<string, [number, number]>,
): Promise<JobStartResponse> {
  const body: Record<string, unknown> = { config, formats }
  if (renderPng !== undefined) {
    body.renderPng = stripRenderPngPrefix(renderPng)
  }
  if (renderAnchors && Object.keys(renderAnchors).length > 0) {
    body.renderAnchors = renderAnchors
  }

  let response: Response
  try {
    response = await fetch(`${GEOMETRY_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new GeometryError(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  }

  if (!response.ok) {
    if (response.status === 422) {
      const data = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new GeometryError(data.detail ?? 'The geometry service rejected the request.')
    }
    throw new GeometryError(
      `The geometry service returned an error (${response.status}). Please try again.`,
    )
  }

  return response.json() as Promise<JobStartResponse>
}

/**
 * GET /jobs/{jobId} — fetch the current status of an async job.
 * Throws GeometryError (with an "expired or missing" message on 404) on any failure.
 */
export async function getJob(jobId: string): Promise<JobStatusResponse> {
  let response: Response
  try {
    response = await fetch(`${GEOMETRY_URL}/jobs/${encodeURIComponent(jobId)}`)
  } catch {
    throw new GeometryError(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new GeometryError('That generation job has expired or is no longer available. Please try again.')
    }
    throw new GeometryError(
      `The geometry service returned an error (${response.status}). Please try again.`,
    )
  }

  return response.json() as Promise<JobStatusResponse>
}

/** Options controlling pollJob's cadence and overall budget. */
export interface PollJobOptions {
  /** Milliseconds between polls. Default 800. */
  intervalMs?: number
  /** Overall budget in milliseconds before giving up. Default 180000 (3 min). */
  timeoutMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll GET /jobs/{jobId} until the job finishes.
 * - Calls onProgress({progress, stage}) after each poll while pending/running.
 * - Resolves with the final JobStatusResponse (status === "done", files populated).
 * - Rejects with GeometryError on status === "error", on the overall timeout, or on
 *   the network-failure / non-OK conditions surfaced by getJob.
 */
export async function pollJob(
  jobId: string,
  onProgress?: (p: JobProgress) => void,
  options: PollJobOptions = {},
): Promise<JobStatusResponse> {
  const intervalMs = options.intervalMs ?? 800
  const timeoutMs = options.timeoutMs ?? 180_000
  const deadline = Date.now() + timeoutMs

  // Poll at least once immediately (a cached/done job resolves without waiting).
  for (;;) {
    const job = await getJob(jobId)

    if (job.status === 'done') {
      onProgress?.({ progress: 100, stage: job.stage || 'Done' })
      return job
    }

    if (job.status === 'error') {
      throw new GeometryError(
        job.error ?? 'The geometry service could not generate this file. Please try again.',
      )
    }

    // pending | running
    onProgress?.({ progress: job.progress ?? 0, stage: job.stage || 'Working…' })

    if (Date.now() + intervalMs >= deadline) {
      throw new GeometryError(
        'File generation is taking longer than expected. Please try again in a moment.',
      )
    }

    await sleep(intervalMs)
  }
}

/**
 * GET /health — returns the set of format names whose adapter is available.
 * Returns an empty set when the service is unreachable or returns a non-OK status.
 */
export async function availableFormats(): Promise<Set<string>> {
  try {
    const response = await fetch(`${GEOMETRY_URL}/health`)
    if (!response.ok) return new Set()
    const data = await response.json() as { adapters?: Record<string, boolean> }
    const adapters = data.adapters ?? {}
    return new Set(Object.keys(adapters).filter((k) => adapters[k]))
  } catch {
    return new Set()
  }
}

/**
 * Fetch a generated file and trigger a browser download.
 * File URLs from the server are relative paths — GEOMETRY_URL is prepended.
 * Throws GeometryError with a user-facing message on any failure.
 */
export async function downloadGeneratedFile(file: GeneratedFile): Promise<void> {
  const href = file.url.startsWith('http') ? file.url : `${GEOMETRY_URL}${file.url}`
  let response: Response
  try {
    response = await fetch(href)
  } catch {
    throw new GeometryError(
      "Couldn't reach the file generator — is the geometry service running?",
    )
  }

  if (!response.ok) {
    throw new GeometryError(
      `The file could not be downloaded (HTTP ${response.status}).`,
    )
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
