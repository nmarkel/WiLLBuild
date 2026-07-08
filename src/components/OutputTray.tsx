import { useState } from 'react'
import type { Catalog, PoleConfig } from '../types'
import { getContact, saveLead, type Contact } from '../lib/leads'
import { buildSummaryText } from '../lib/summary'
import { useConfigurator } from '../store'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/** Deliverables gallery: what it is, who it's for, available now or coming. */
const PLACEHOLDERS = [
  { title: 'Spec Sheet', format: 'PDF', audience: 'For your submittals' },
  { title: '2D Drawing', format: 'DWG', audience: 'For your drawings' },
  { title: 'Solid CAD', format: 'STEP', audience: 'For WiLL Engineering' },
  { title: 'Photometric', format: 'IES', audience: 'For your lighting calcs' },
]

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

export function OutputTray({ catalog, config }: Props) {
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const deliver = (deliverable: string) => {
    if (deliverable === 'png') void downloadSnapshot(config.configId)
  }

  const requestDownload = (deliverable: string) => {
    // Meaningful downloads require contact info at minimum; full accounts deferred.
    if (getContact()) {
      deliver(deliverable)
    } else {
      setPendingDownload(deliverable)
    }
  }

  const unlock = (contact: Contact) => {
    if (!pendingDownload) return
    saveLead(contact, config.configId, pendingDownload)
    const deliverable = pendingDownload
    setPendingDownload(null)
    deliver(deliverable)
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
        <button className="deliverable" onClick={() => requestDownload('png')}>
          <span className="deliverable-title">Product Render</span>
          <span className="deliverable-format">PNG · current 3D view</span>
          <span className="deliverable-audience">For your client</span>
        </button>
        <button className="deliverable" onClick={copySummary}>
          <span className="deliverable-title">{copied ? 'Copied ✓' : 'Config Summary'}</span>
          <span className="deliverable-format">Text · copies to clipboard</span>
          <span className="deliverable-audience">For WiLL Engineering</span>
        </button>
        {PLACEHOLDERS.map((d) => (
          <button key={d.format} className="deliverable disabled" disabled>
            <span className="deliverable-title">{d.title}</span>
            <span className="deliverable-format">
              {d.format} · <em>coming soon</em>
            </span>
            <span className="deliverable-audience">{d.audience}</span>
          </button>
        ))}
      </div>
      {pendingDownload && <ContactGate onUnlock={unlock} onCancel={() => setPendingDownload(null)} />}
    </div>
  )
}
