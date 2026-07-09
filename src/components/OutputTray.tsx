import { useState, useEffect, useCallback } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { getContact, saveLead, type Contact } from '../lib/leads'
import { buildSummaryText } from '../lib/summary'
import { useConfigurator } from '../store'
import {
  availableFormats,
  generateOutputs,
  downloadGeneratedFile,
  type OutputFormat,
} from '../lib/geometry'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

// ---- Card state machine ----

type CardPhase = 'idle' | 'working' | 'done' | 'error'

interface CardState {
  phase: CardPhase
  error?: string
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
    format: 'step',
    title: 'Solid CAD',
    formatLabel: 'STEP · exact geometry',
    audience: 'For WiLL Engineering',
  },
  {
    format: 'ifc',
    title: 'Revit Model',
    formatLabel: 'IFC · BIM-ready',
    audience: 'For your BIM workflow',
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

/** Fallback when no SnapshotRig is registered: raw grab of the visible canvas. */
function grabRawCanvas(): Promise<Blob | null> {
  const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
  if (!canvas) return Promise.resolve(null)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

async function downloadSnapshot(configId: string) {
  const { snapshot } = useConfigurator.getState()
  const blob = snapshot ? await snapshot() : await grabRawCanvas()
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `will-config-${configId.slice(0, 8)}.png`
  a.click()
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
  onRequest: (format: OutputFormat) => void
}

function DeliverableCard({ def, available, state, availFormats, onRequest }: DeliverableCardProps) {
  const disabled = def.alwaysDisabled || !available || state.phase === 'working'

  // Build the format label — 2D Drawing mentions DWG when the service provides it.
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
        if (def.format && available && !def.alwaysDisabled) {
          onRequest(def.format)
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
      {hasError && state.error && (
        <span className="deliverable-error">{state.error}</span>
      )}
    </button>
  )
}

// ---- OutputTray ----

export function OutputTray({ catalog, config }: Props) {
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [availFormats, setAvailFormats] = useState<Set<string>>(new Set())
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({})
  const [warnings, setWarnings] = useState<string[]>([])

  // Load available formats on mount
  useEffect(() => {
    availableFormats()
      .then(setAvailFormats)
      .catch(() => setAvailFormats(new Set()))
  }, [])

  const setCardState = useCallback((format: string, state: CardState) => {
    setCardStates((prev) => ({ ...prev, [format]: state }))
  }, [])

  const getCardState = (format: string): CardState =>
    cardStates[format] ?? { phase: 'idle' }

  /** Carry out the actual generate + download sequence. */
  const runDelivery = useCallback(
    async (format: OutputFormat, def: DeliverableDef) => {
      setCardState(format, { phase: 'working' })
      try {
        // Gather render PNG if needed
        let renderPng: string | undefined
        if (def.includeRender) {
          const { snapshot } = useConfigurator.getState()
          const blob = snapshot ? await snapshot() : await grabRawCanvas()
          if (blob) {
            renderPng = await blobToDataUrl(blob)
          }
        }

        const response = await generateOutputs(config, [format], renderPng)

        // Accumulate any new warnings
        if (response.warnings.length > 0) {
          setWarnings((prev) => {
            const combined = new Set([...prev, ...response.warnings])
            return [...combined]
          })
        }

        // Download each returned file
        for (const file of response.files) {
          await downloadGeneratedFile(file)
        }

        setCardState(format, { phase: 'done' })
        // Revert to idle after 2 seconds
        setTimeout(() => {
          setCardState(format, { phase: 'idle' })
        }, 2000)
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
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="output-tray">
      <h2>Downloads</h2>
      <div className="deliverables">
        {/* ---- Always-live cards ---- */}
        <button className="deliverable" onClick={() => void downloadSnapshot(config.configId)}>
          <span className="deliverable-title">Product Render</span>
          <span className="deliverable-format">PNG · current 3D view</span>
          <span className="deliverable-audience">For your client</span>
        </button>
        <button className="deliverable" onClick={() => void copySummary()}>
          <span className="deliverable-title">{copied ? 'Copied ✓' : 'Config Summary'}</span>
          <span className="deliverable-format">Text · copies to clipboard</span>
          <span className="deliverable-audience">For WiLL Engineering</span>
        </button>

        {/* ---- Geometry-service deliverables ---- */}
        {DELIVERABLE_DEFS.map((def) => {
          const format = def.format
          const available = format !== null && !def.alwaysDisabled && availFormats.has(format)
          return (
            <DeliverableCard
              key={format ?? 'ies'}
              def={def}
              available={available}
              state={getCardState(format ?? 'ies')}
              availFormats={availFormats}
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
