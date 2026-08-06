import { useState, useEffect, useCallback, useRef } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { getContact, saveLead, type Contact } from '../lib/leads'
import { buildSummaryText } from '../lib/summary'
import { useConfigurator } from '../store'
import {
  availableFormats,
  startJob,
  pollJob,
  downloadGeneratedFile,
  GeometryError,
  type OutputFormat,
} from '../lib/geometry'
import './output-tray.css'

interface Props {
  catalog: Catalog
  config: PoleConfig
  /** Restrict which geometry-service formats are offered. Defaults to the full set. */
  formats?: OutputFormat[]
  /** Whether to show the PNG snapshot card. Defaults to true. Set to false for photo-card mode. */
  showPngCard?: boolean
}

// ---- Card state machine ----

type CardPhase = 'idle' | 'working' | 'done' | 'error'

interface CardState {
  phase: CardPhase
  error?: string
  /** 0..100 while working (from the job poll). */
  progress?: number
  /** Human-readable stage label while working. */
  stage?: string
}

// ---- Deliverable definitions ----

interface DeliverableDef {
  /** The format key sent to the geometry service (or null for always-disabled). */
  format: OutputFormat | null
  title: string
  /** Static format label — may be overridden at render time based on available formats. */
  formatLabel: string
  audience: string
  /** Pass renderPng to generateOutputs for these formats. */
  includeRender?: boolean
  /** Always disabled, regardless of service availability. */
  alwaysDisabled?: boolean
}

const DELIVERABLE_DEFS: DeliverableDef[] = [
  {
    format: 'herocard',
    title: 'Concept Card',
    formatLabel: 'PDF · hero card',
    audience: 'For your client',
    includeRender: true,
  },
  {
    format: 'pdf',
    title: 'Spec Sheet',
    formatLabel: 'PDF · full spec',
    audience: 'For your submittals',
    includeRender: true,
  },
  {
    format: 'dxf',
    title: '2D Drawing',
    formatLabel: 'DXF', // may be augmented at render time
    audience: 'For your drawings',
  },
  {
    format: 'rfa',
    title: 'Revit Family',
    formatLabel: 'RFA · Revit family',
    audience: 'For your Revit model',
    includeRender: false,
  },
  {
    format: 'step',
    title: 'STEP',
    formatLabel: 'STEP · exact geometry',
    audience: 'For WiLL Engineering',
  },
  {
    format: 'ifc',
    title: 'Revit Model',
    formatLabel: 'IFC · BIM-ready',
    audience: 'For open BIM / import',
  },
  {
    format: 'bundle',
    title: 'Handoff Package',
    formatLabel: 'ZIP · STEP + render + spec + config',
    audience: 'For your project record',
    includeRender: true,
  },
  {
    format: null,
    title: 'Photometric',
    formatLabel: 'IES · coming soon',
    audience: 'For your lighting calcs',
    alwaysDisabled: true,
  },
]

// ---- Helpers ----

async function downloadSnapshot(configId: string) {
  const { snapshot } = useConfigurator.getState()
  const blob = snapshot ? await snapshot() : null
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `will-config-${configId.slice(0, 8)}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Convert a Blob to a base64 data-URL for sending as renderPng. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read snapshot blob'))
    reader.readAsDataURL(blob)
  })
}

// ---- ContactGate ----

function ContactGate({ onUnlock, onCancel }: { onUnlock: (c: Contact) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const valid = name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email)

  return (
    <div className="gate-backdrop" onClick={onCancel}>
      <div className="gate" onClick={(e) => e.stopPropagation()}>
        <h3>Almost there</h3>
        <p>Leave your contact info to unlock downloads.</p>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          type="email"
          placeholder="Work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="gate-actions">
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onUnlock({ name: name.trim(), email: email.trim() })}
          >
            Unlock Download
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- DeliverableCard ----

interface DeliverableCardProps {
  def: DeliverableDef
  available: boolean
  state: CardState
  availFormats: Set<string>
  /** Effective format to request — may differ from def.format (e.g. dwg replaces dxf). */
  requestFormat: OutputFormat | null
  onRequest: (format: OutputFormat) => void
}

function DeliverableCard({ def, available, state, availFormats, requestFormat, onRequest }: DeliverableCardProps) {
  const disabled = def.alwaysDisabled || !available || state.phase === 'working'

  // Build the format label — 2D Drawing shows DWG when the service provides it, DXF otherwise.
  let formatLabel = def.formatLabel
  if (def.format === 'dxf') {
    formatLabel = availFormats.has('dwg') ? 'DWG' : 'DXF · DWG on request'
  }

  // Derive display state
  const isWorking = state.phase === 'working'
  const isDone = state.phase === 'done'
  const hasError = state.phase === 'error'

  const classNames = [
    'deliverable',
    disabled ? 'disabled' : '',
    isWorking ? 'working' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classNames}
      disabled={disabled}
      onClick={() => {
        if (requestFormat && available && !def.alwaysDisabled) {
          onRequest(requestFormat)
        }
      }}
    >
      <span className="deliverable-title">
        {isDone ? `${def.title} ✓` : isWorking ? 'Generating…' : def.title}
      </span>
      <span className="deliverable-format">
        {formatLabel}
        {!available && !def.alwaysDisabled && <em> · coming soon</em>}
        {def.alwaysDisabled && <em> coming soon</em>}
      </span>
      <span className="deliverable-audience">{def.audience}</span>
      {isWorking && (
        <span className="deliverable-spinner" aria-label="Generating">
          <span />
          <span />
          <span />
        </span>
      )}
      {isWorking && (
        <span
          className="deliverable-progress"
          role="progressbar"
          aria-valuenow={typeof state.progress === 'number' ? Math.round(state.progress) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="deliverable-progress-track">
            <span
              className="deliverable-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, state.progress ?? 0))}%` }}
            />
          </span>
          <span className="deliverable-progress-label">
            {state.stage ? `${state.stage}` : 'Working…'}
            {typeof state.progress === 'number' ? ` · ${Math.round(state.progress)}%` : ''}
          </span>
        </span>
      )}
      {hasError && state.error && (
        <span className="deliverable-error">{state.error}</span>
      )}
    </button>
  )
}

// ---- OutputTray ----

export function OutputTray({ catalog, config, formats: allowedFormats, showPngCard = true }: Props) {
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [availFormats, setAvailFormats] = useState<Set<string>>(new Set())
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const timeoutIdsRef = useRef<NodeJS.Timeout[]>([])

  // Load available formats on mount
  useEffect(() => {
    let cancelled = false
    availableFormats()
      .then((formats) => {
        if (!cancelled) setAvailFormats(formats)
      })
      .catch(() => {
        if (!cancelled) setAvailFormats(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Clean up timers on unmount
  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current
    return () => {
      timeoutIds.forEach((id) => clearTimeout(id))
    }
  }, [])

  const setCardState = useCallback((format: string, state: CardState) => {
    setCardStates((prev) => ({ ...prev, [format]: state }))
  }, [])

  const getCardState = (format: string): CardState =>
    cardStates[format] ?? { phase: 'idle' }

  /** Carry out the async generate + download sequence (startJob → poll → download). */
  const runDelivery = useCallback(
    async (format: OutputFormat, def: DeliverableDef) => {
      setCardState(format, { phase: 'working', progress: 0, stage: 'Starting…' })
      try {
        // Gather render PNG if needed
        let renderPng: string | undefined
        if (def.includeRender) {
          const { snapshot } = useConfigurator.getState()
          const blob = snapshot ? await snapshot() : null
          if (blob) {
            renderPng = await blobToDataUrl(blob)
          }
        }

        // Enqueue the job, then poll for progress until it finishes.
        const start = await startJob(config, [format], renderPng)
        const response = await pollJob(start.jobId, ({ progress, stage }) => {
          setCardState(format, { phase: 'working', progress, stage })
        })

        // Accumulate any new warnings
        if (response.warnings.length > 0) {
          setWarnings((prev) => {
            const combined = new Set([...prev, ...response.warnings])
            return [...combined]
          })
        }

        // Treat an empty file list as a failure — the job finished but
        // no adapter produced output (adapter error surfaced only in warnings).
        if (response.files.length === 0) {
          const detail =
            response.warnings.length > 0
              ? response.warnings.join(' ')
              : "The service couldn't generate this file."
          throw new GeometryError(detail)
        }

        // Download each returned file
        for (const file of response.files) {
          await downloadGeneratedFile(file)
        }

        setCardState(format, { phase: 'done' })
        // Revert to idle after 2 seconds
        const timeoutId = setTimeout(() => {
          setCardState(format, { phase: 'idle' })
        }, 2000)
        timeoutIdsRef.current.push(timeoutId)
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred. Please try again.'
        setCardState(format, { phase: 'error', error: message })
      }
    },
    [config, setCardState],
  )

  /** Entry point for a deliverable card click — goes through the contact gate. */
  const requestDelivery = useCallback(
    (format: OutputFormat) => {
      const def = DELIVERABLE_DEFS.find((d) => d.format === format)
      if (!def) return

      // Reset error so the user can retry
      if (getCardState(format).phase === 'error') {
        setCardState(format, { phase: 'idle' })
        return
      }

      if (getContact()) {
        void runDelivery(format, def)
      } else {
        setPendingDownload(format)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runDelivery, setCardState, cardStates],
  )

  const unlock = (contact: Contact) => {
    if (!pendingDownload) return
    saveLead(contact, config.configId, pendingDownload)
    const format = pendingDownload as OutputFormat
    setPendingDownload(null)
    const def = DELIVERABLE_DEFS.find((d) => d.format === format)
    if (def) void runDelivery(format, def)
  }

  const copySummary = async () => {
    await navigator.clipboard.writeText(buildSummaryText(catalog, config))
    setCopied(true)
    const timeoutId = setTimeout(() => setCopied(false), 1600)
    timeoutIdsRef.current.push(timeoutId)
  }

  return (
    <div className="output-tray">
      <h2>Downloads</h2>
      <div className="deliverables">
        {/* ---- Always-live cards ---- */}
        {showPngCard && (
          <button className="deliverable" onClick={() => void downloadSnapshot(config.configId)}>
            <span className="deliverable-title">Product Render</span>
            <span className="deliverable-format">PNG · current view</span>
            <span className="deliverable-audience">For your client</span>
          </button>
        )}
        {/* Phase 0.10 (Workstream 0): the summary now leads with the part
            numbers — the artifact a designer pastes into their spec. */}
        <button className="deliverable" onClick={() => void copySummary()}>
          <span className="deliverable-title">{copied ? 'Copied ✓' : 'Part Numbers + Config'}</span>
          <span className="deliverable-format">Text · copies to clipboard</span>
          <span className="deliverable-audience">For the project spec</span>
        </button>

        {/* ---- Geometry-service deliverables ---- */}
        {DELIVERABLE_DEFS.filter(
          (def) => !allowedFormats || (def.format !== null && allowedFormats.includes(def.format)),
        ).map((def) => {
          // For the 2D Drawing card: request dwg when available, dxf otherwise.
          const requestFormat: OutputFormat | null =
            def.format === 'dxf' && availFormats.has('dwg') ? 'dwg' : def.format
          const cardKey = requestFormat ?? 'ies'
          const available =
            requestFormat !== null && !def.alwaysDisabled && availFormats.has(requestFormat)
          return (
            <DeliverableCard
              key={cardKey}
              def={def}
              available={available}
              state={getCardState(cardKey)}
              availFormats={availFormats}
              requestFormat={requestFormat}
              onRequest={requestDelivery}
            />
          )
        })}
      </div>

      {/* Warnings from the geometry service (e.g. DWG adapter missing) */}
      {warnings.length > 0 && (
        <p className="tray-warnings">{warnings.join(' · ')}</p>
      )}

      {pendingDownload && <ContactGate onUnlock={unlock} onCancel={() => setPendingDownload(null)} />}
    </div>
  )
}
