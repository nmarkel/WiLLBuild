"""Durable lead storage + notification (Phase 0.20, Workstream A).

**The only module that imports boto3.** Same instinct as the adapter boundary:
one file knows about AWS, everything upstream deals in dicts. That is what lets
`app.leads` be tested without a network and what makes a later move to another
store (or to Salesforce directly) a change in one place.

Storage shape: one S3 object per lead, keyed deterministically on the
configuration and the person, so a visitor clicking four download cards writes
one object instead of four.

Everything is env-gated because the bucket is an authenticated Nick/Tyler step
that has not happened yet:

  LEADS_BUCKET    required; absent => capture refuses loudly (never pretends)
  LEADS_PREFIX    default "leads"
  AWS_REGION      default "us-east-1"
  LEAD_NOTIFY_TO  absent => no notification attempted, and it is REPORTED
  LEAD_NOTIFY_FROM  default: the same address as LEAD_NOTIFY_TO
"""

from __future__ import annotations

import hashlib
import json
import os

_DEFAULT_PREFIX = "leads"
_DEFAULT_REGION = "us-east-1"


class LeadStoreUnconfigured(RuntimeError):
    """No durable store is configured — the caller must NOT report success."""


class LeadStoreFailed(RuntimeError):
    """The store is configured but the write did not land."""


def leads_bucket() -> str | None:
    return os.environ.get("LEADS_BUCKET") or None


def leads_prefix() -> str:
    return os.environ.get("LEADS_PREFIX") or _DEFAULT_PREFIX


def notify_to() -> str | None:
    return os.environ.get("LEAD_NOTIFY_TO") or None


def is_configured() -> bool:
    return leads_bucket() is not None


def _client():
    """The S3 client. Patched wholesale in tests; boto3 is imported lazily so
    an unconfigured deployment never pays for the import."""
    import boto3

    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", _DEFAULT_REGION))


def _ses_client():
    import boto3

    return boto3.client("ses", region_name=os.environ.get("AWS_REGION", _DEFAULT_REGION))


def not_found_error() -> Exception:
    """The exception `head_object` raises for a missing key.

    Exposed so tests can construct the same failure a real client would,
    instead of asserting against a stand-in that behaves differently.
    """
    from botocore.exceptions import ClientError

    return ClientError(
        {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
    )


def _is_not_found(exc: Exception) -> bool:
    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    return str(code) in ("404", "NoSuchKey", "NotFound")


def normalize_email(email: str) -> str:
    """Lower-cased and trimmed — the identity used for dedupe.

    Only case and surrounding whitespace. Deliberately NOT stripping Gmail dots
    or +tags: two addresses that differ that way may be two real people at one
    company, and merging them would silently drop a lead.
    """
    return email.strip().lower()


def lead_key(email: str, config_id: str) -> str:
    """Deterministic S3 key for (person, configuration).

    The email is hashed rather than spelled out: object keys turn up in bucket
    listings, access logs and CloudTrail, none of which need to carry somebody's
    address in the clear. The address itself is inside the object.
    """
    digest = hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()[:16]
    safe_config = "".join(c for c in config_id if c.isalnum() or c in "-_")[:64]
    return f"{leads_prefix()}/{safe_config or 'no-config'}/{digest}.json"


def store_lead(payload: dict) -> tuple[str, bool]:
    """Write one lead. Returns (key, deduped).

    Raises LeadStoreUnconfigured when there is no bucket, and LeadStoreFailed
    when there is one and the write did not land. Both are refusals — neither
    may be reported to a visitor as a successful submission.
    """
    bucket = leads_bucket()
    if bucket is None:
        raise LeadStoreUnconfigured("LEADS_BUCKET is not set")

    key = lead_key(payload["email"], payload.get("configId", ""))
    try:
        client = _client()
    except Exception as exc:  # noqa: BLE001
        raise LeadStoreFailed(f"could not create an S3 client: {exc}") from exc

    # Dedupe by existence. A HeadObject failure that is NOT a 404 (permissions,
    # network) must not be read as "absent" — that would write a duplicate on
    # every retry — so only a genuine not-found proceeds to the put.
    try:
        client.head_object(Bucket=bucket, Key=key)
        return key, True
    except Exception as exc:  # noqa: BLE001
        if not _is_not_found(exc):
            raise LeadStoreFailed(f"could not check for an existing lead: {exc}") from exc

    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload, indent=2, sort_keys=True).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as exc:  # noqa: BLE001
        raise LeadStoreFailed(f"could not write the lead: {exc}") from exc
    return key, False


def notify(payload: dict) -> bool:
    """Best-effort email notification. Returns whether it was sent.

    NEVER raises: by the time this runs the lead is already durable, and an
    unverified SES identity must not turn a captured lead into an error the
    visitor sees. A False return is reported honestly in the response.
    """
    to = notify_to()
    if not to:
        return False
    sender = os.environ.get("LEAD_NOTIFY_FROM") or to
    sf = payload.get("salesforce", {})
    lines = [
        "A new configuration lead came in from the WiLL Build configurator.",
        "",
        f"Name:     {payload.get('name', '')}",
        f"Email:    {payload.get('email', '')}",
        f"Company:  {sf.get('Company', '')}",
        f"Captured: {payload.get('capturedAt', '')}",
        f"Wanted:   {payload.get('deliverable', '')}",
        "",
        "Configured part numbers:",
        *(f"  {n}" for n in payload.get("partNumbers") or ["(none resolved)"]),
        "",
        f"Share link: {payload.get('shareUrl') or '(none)'}",
        f"Config id:  {payload.get('configId', '')}",
    ]
    try:
        _ses_client().send_email(
            Source=sender,
            Destination={"ToAddresses": [a.strip() for a in to.split(",") if a.strip()]},
            Message={
                "Subject": {"Data": "WiLL Build - new configuration lead"},
                "Body": {"Text": {"Data": "\n".join(lines)}},
            },
        )
        return True
    except Exception:  # noqa: BLE001
        return False
