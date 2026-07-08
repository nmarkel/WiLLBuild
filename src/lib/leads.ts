/**
 * Contact gate for meaningful downloads (Phase 0.1, Change 4). No backend
 * exists yet, so leads are logged to localStorage as a stopgap — retrievable
 * via `localStorage.getItem('willbuild-leads')`. Note the Phase 0 "no
 * localStorage" rule applies to *config state* (which lives in state + URL);
 * this is a capture log, to be replaced by a real endpoint.
 */

export interface Contact {
  name: string
  email: string
}

export interface Lead extends Contact {
  capturedAt: string
  configId: string
  deliverable: string
}

const CONTACT_KEY = 'willbuild-contact'
const LEADS_KEY = 'willbuild-leads'

export function getContact(): Contact | null {
  try {
    const raw = localStorage.getItem(CONTACT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.name && parsed?.email ? parsed : null
  } catch {
    return null
  }
}

export function saveLead(contact: Contact, configId: string, deliverable: string): void {
  localStorage.setItem(CONTACT_KEY, JSON.stringify(contact))
  const lead: Lead = {
    ...contact,
    capturedAt: new Date().toISOString(),
    configId,
    deliverable,
  }
  const existing: Lead[] = JSON.parse(localStorage.getItem(LEADS_KEY) ?? '[]')
  localStorage.setItem(LEADS_KEY, JSON.stringify([...existing, lead]))
}
