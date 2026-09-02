"""Lead capture domain logic (Phase 0.20, Workstream A).

Validation, the Salesforce-shaped payload, and the PII-safe log line. No AWS
here — storage lives behind `app.leadstore`, which is the only module that
imports boto3.

On Salesforce: WiLL runs it, with the standard Lead object, and that is the
eventual home. The integration is explicitly NOT built this phase. What IS done
is shaping the stored payload against Lead's own fields, so a later sync is a
mapping rather than a re-capture — the raw `name` is preserved alongside the
split, so a future mapper can disagree with the split without having lost the
original.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Deliberately conservative: one @, no spaces, and a dot-something TLD. It is
# not RFC 5322 (nothing short of a parser is) and it is not trying to be — its
# job is to reject the typos and the junk, not to adjudicate exotic addresses.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")

LEAD_SOURCE = "WiLL Build Configurator"

# Salesforce requires Lead.Company. Our form does not, because demanding it
# costs more leads than it gains — so an unstated company is recorded as
# unstated rather than invented or left blank for the sync to choke on.
_COMPANY_FALLBACK = "(not provided)"

CONTACT_FALLBACK = "quotes@willbrands.com"


class LeadInvalid(ValueError):
    """The submission is not usable as a lead."""


def _split_name(name: str) -> tuple[str, str]:
    """(FirstName, LastName). Salesforce requires LastName and not FirstName.

    A mononym therefore becomes the LAST name, never the first — the opposite
    would produce a Lead with an empty required field.
    """
    parts = name.split()
    if len(parts) == 1:
        return "", parts[0]
    return " ".join(parts[:-1]), parts[-1]


def email_fingerprint(email: str) -> str:
    """A short, stable, non-reversible handle for logs and metrics."""
    from .leadstore import normalize_email

    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()[:12]


def build_payload(
    *,
    name: str,
    email: str,
    company: str | None,
    config_id: str,
    part_numbers: list[str] | None,
    share_url: str | None,
    deliverable: str | None,
    consent: str | None = None,
    captured_at: datetime | None = None,
) -> dict:
    """Validate and shape one lead. Raises LeadInvalid."""
    name = (name or "").strip()
    email = (email or "").strip()
    if not name:
        raise LeadInvalid("name is required")
    if not _EMAIL.match(email):
        raise LeadInvalid(f"{email!r} is not a valid email address")

    first, last = _split_name(name)
    numbers = [n for n in (part_numbers or []) if n]
    company_value = (company or "").strip()
    when = (captured_at or datetime.now(timezone.utc)).astimezone(timezone.utc)

    description = "\n".join(
        [
            "Configured in the WiLL Build 3D configurator.",
            "",
            "Part numbers:",
            *(f"  {n}" for n in numbers or ["(none resolved)"]),
            "",
            f"Requested deliverable: {deliverable or '(not stated)'}",
            f"Share link: {share_url or '(none)'}",
            f"Config id: {config_id}",
        ]
    )

    return {
        # --- what the visitor told us ---
        "name": name,
        "email": email,
        "company": company_value or None,
        # --- what they configured (the part that makes it sales-usable) ---
        "configId": config_id,
        "partNumbers": numbers,
        "shareUrl": share_url or None,
        "deliverable": deliverable or None,
        # --- provenance ---
        "capturedAt": when.isoformat(),
        "source": LEAD_SOURCE,
        "consent": consent
        or "Submitted the download form; told that WiLL would follow up about this configuration.",
        "schema": 1,
        # --- ready to map, not yet mapped ---
        "salesforce": {
            "FirstName": first,
            "LastName": last,
            "Email": email,
            "Company": company_value or _COMPANY_FALLBACK,
            "LeadSource": LEAD_SOURCE,
            "Description": description,
        },
    }


def log_capture(event: str, *, config_id: str, email: str, extra: str = "") -> None:
    """Log a capture WITHOUT PII.

    Leads are personal data and logs get shipped, tailed and pasted into
    tickets. An operator needs to know that a capture happened, for which
    configuration, and whether it worked — none of which requires the person's
    name or address. The fingerprint is enough to correlate two events about
    the same person without identifying them.
    """
    logger.info(
        "lead %s config=%s who=%s%s",
        event,
        config_id or "(none)",
        email_fingerprint(email) if email else "(none)",
        f" {extra}" if extra else "",
    )
