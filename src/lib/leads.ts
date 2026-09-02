/**
 * Contact gate for meaningful downloads.
 *
 * Phase 0.20 (Workstream A) made this real. It used to write name+email to the
 * VISITOR'S OWN localStorage while the form said "unlock downloads" and the
 * product implied someone would follow up. Nobody at WiLL could retrieve a
 * single lead — the capture existed only on the machine of the person who
 * filled it in.
 *
 * Now the geometry-service is the record of truth (`POST /leads` -> one S3
 * object per lead, with the configuration attached). localStorage keeps only
 * the job it was always good at: remembering this visitor so the form is not
 * shown again. That cache is a CONVENIENCE, never the record — which is why
 * `submitLead` reports failure instead of quietly succeeding into a
 * localStorage write nobody will ever read.
 *
 * The Phase 0 "no localStorage" rule applies to *config state* (which lives in
 * state + URL); remembering a contact is not config.
 */

import { GEOMETRY_URL } from './geometry'

export interface Contact {
  name: string
  email: string
}

/** Everything the server needs to make a lead sales-usable. */
export interface LeadContext {
  configId: string
  partNumbers: string[]
  shareUrl?: string
  deliverable: string
  company?: string
}

export type LeadOutcome =
  | { ok: true; deduped: boolean }
  /**
   * `contactFallback` is true when the service told us it cannot record
   * anything (no store configured, or the write failed). The UI must say so
   * and point at a human — never swallow it, because a silent failure here is
   * exactly the dishonesty this workstream exists to remove.
   */
  | { ok: false; message: string; contactFallback: boolean }

const CONTACT_KEY = 'willbuild-contact'
const LEADS_KEY = 'willbuild-leads'

export const CONTACT_FALLBACK_EMAIL = 'quotes@willbrands.com'

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

/** Remember this visitor so the gate is not shown again. Never the record. */
export function rememberContact(contact: Contact): void {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contact))
  } catch {
    // A visitor with storage disabled simply sees the form again. Not fatal,
    // and not worth failing a download over.
  }
}

/** Local echo of what was sent, for debugging a visitor's own session. */
function logLocally(contact: Contact, ctx: LeadContext): void {
  try {
    const existing = JSON.parse(localStorage.getItem(LEADS_KEY) ?? '[]')
    localStorage.setItem(
      LEADS_KEY,
      JSON.stringify([
        ...existing,
        { ...contact, capturedAt: new Date().toISOString(), configId: ctx.configId, deliverable: ctx.deliverable },
      ]),
    )
  } catch {
    // ignore
  }
}

/**
 * Submit a lead to the service. Resolves with the outcome; never throws.
 *
 * Only remembers the contact locally on success, so a visitor whose lead was
 * refused is asked again next time rather than being silently marked as
 * captured.
 */
export async function submitLead(contact: Contact, ctx: LeadContext): Promise<LeadOutcome> {
  let resp: Response
  try {
    resp = await fetch(`${GEOMETRY_URL}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: contact.name,
        email: contact.email,
        company: ctx.company ?? null,
        configId: ctx.configId,
        partNumbers: ctx.partNumbers,
        shareUrl: ctx.shareUrl ?? null,
        deliverable: ctx.deliverable,
      }),
    })
  } catch {
    return {
      ok: false,
      contactFallback: true,
      message: `We could not reach WiLL to record your details. Please email ${CONTACT_FALLBACK_EMAIL} with your configuration.`,
    }
  }

  if (resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { deduped?: boolean }
    rememberContact(contact)
    logLocally(contact, ctx)
    return { ok: true, deduped: Boolean(body.deduped) }
  }

  const detail = await resp
    .json()
    .then((b: { detail?: string }) => b?.detail)
    .catch(() => undefined)

  // 422 is the visitor's to fix (a bad email). 503/502 are ours, and both mean
  // nothing was recorded — those get the fallback address.
  const contactFallback = resp.status !== 422
  return {
    ok: false,
    contactFallback,
    message:
      detail ??
      (contactFallback
        ? `We could not record your details. Please email ${CONTACT_FALLBACK_EMAIL} with your configuration.`
        : 'Please check the details and try again.'),
  }
}
