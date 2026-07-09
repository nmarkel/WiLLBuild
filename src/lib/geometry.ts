import type { PoleConfig } from '../types'

export type OutputFormat = 'step' | 'dxf' | 'dwg' | 'ifc' | 'pdf' | 'bundle'

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
    // Strip the data:...;base64, prefix if present
    const commaIdx = renderPng.indexOf(',')
    body.renderPng = commaIdx >= 0 ? renderPng.slice(commaIdx + 1) : renderPng
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
  a.click()
  URL.revokeObjectURL(url)
}
