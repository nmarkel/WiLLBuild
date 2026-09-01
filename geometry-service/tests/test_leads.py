"""Server-side lead capture (Phase 0.20, Workstream A).

Until now the download gate wrote name and email to the VISITOR'S OWN
localStorage while the wording implied a submission. Nobody at WiLL could
retrieve a single lead. That is the one dishonesty in the product that costs
money, and it is what this endpoint exists to end.

The rules these tests hold:

  * A lead that returns 200 is DURABLE. If it cannot be stored it must not
    return 200 — no optimistic UI, no "we'll follow up" over a dropped write.
  * An unconfigured store refuses LOUDLY and tells the visitor where to go
    instead. Silence and a spinner are worse than an honest failure.
  * Notification is best-effort and cannot fail a capture that already landed.
  * PII stays out of the logs.
  * Dedupe on email + configId, so a visitor clicking four download cards
    produces one lead rather than four.

The S3 call itself is exercised through an injected fake client. What that
CANNOT prove is that the real bucket exists, is writable, and has the right
policy — that is an authenticated step for Nick/Tyler and is flagged as
needs-human in the runbook rather than pretended away here.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import leadstore
from app.main import app

client = TestClient(app)

GOOD_LEAD = {
    "name": "Dana Ruiz",
    "email": "dana.ruiz@example-eng.com",
    "company": "Ruiz Lighting Design",
    "configId": "7f3a91c2-0000-4000-8000-000000000001",
    "partNumbers": ["WD-GVX-80-30-MV-5W-BK-WHP7NP", "RSAA-4040-20-BK"],
    "shareUrl": "https://build.willbrands.com/studio/design?fixture=gvx-pendant",
    "deliverable": "bundle",
}


class FakeS3:
    """Records puts; answers head_object from what it has recorded."""

    def __init__(self, existing: set[str] | None = None):
        self.puts: list[dict] = []
        self.existing: set[str] = set(existing or ())
        self.fail_with: Exception | None = None

    def put_object(self, **kw):
        if self.fail_with:
            raise self.fail_with
        self.puts.append(kw)
        self.existing.add(kw["Key"])
        return {"ETag": '"fake"'}

    def head_object(self, **kw):
        if kw["Key"] not in self.existing:
            raise leadstore.not_found_error()
        return {"ContentLength": 1}


@pytest.fixture
def s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setenv("LEADS_BUCKET", "will-build-leads-test")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setattr(leadstore, "_client", lambda: fake)
    # Notification off unless a test turns it on, so capture tests measure
    # capture.
    monkeypatch.delenv("LEAD_NOTIFY_TO", raising=False)
    return fake


@pytest.fixture
def unconfigured(monkeypatch):
    monkeypatch.delenv("LEADS_BUCKET", raising=False)
    monkeypatch.delenv("LEAD_NOTIFY_TO", raising=False)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("email", ["", "not-an-email", "a@b", "@example.com", "a b@c.com"])
def test_an_invalid_email_is_refused(s3, email):
    """Validated SERVER-side. The browser check is a courtesy, not a guarantee."""
    r = client.post("/leads", json={**GOOD_LEAD, "email": email})
    assert r.status_code == 422, r.text
    assert not s3.puts, "a lead with an invalid email reached the store"


def test_a_missing_name_is_refused(s3):
    r = client.post("/leads", json={**GOOD_LEAD, "name": "   "})
    assert r.status_code == 422, r.text
    assert not s3.puts


def test_company_is_optional(s3):
    payload = {k: v for k, v in GOOD_LEAD.items() if k != "company"}
    r = client.post("/leads", json=payload)
    assert r.status_code == 200, r.text
    assert len(s3.puts) == 1


# ---------------------------------------------------------------------------
# No durable store configured — refuse loudly
# ---------------------------------------------------------------------------

def test_capture_refuses_when_no_bucket_is_configured(unconfigured):
    """503, not 200. A lead that was not stored was not captured.

    The bucket is an authenticated Nick/Tyler step, so this is the state the
    service ships in until they create it — which is exactly why it must be
    impossible to mistake for success.
    """
    r = client.post("/leads", json=GOOD_LEAD)
    assert r.status_code == 503, r.text


def test_the_refusal_tells_the_visitor_where_to_go(unconfigured):
    """A dead end with no instruction is how a lead is actually lost."""
    r = client.post("/leads", json=GOOD_LEAD)
    assert "quotes@willbrands.com" in r.json()["detail"]


def test_the_refusal_is_visible_in_health(unconfigured):
    """Operators should not need a failed lead to discover the store is off."""
    body = client.get("/health").json()
    assert body["leadCapture"] == "unconfigured"


def test_health_reports_a_configured_store(s3):
    body = client.get("/health").json()
    assert body["leadCapture"] == "ready"


# ---------------------------------------------------------------------------
# Durable capture
# ---------------------------------------------------------------------------

def test_a_lead_is_written_as_one_object(s3):
    r = client.post("/leads", json=GOOD_LEAD)
    assert r.status_code == 200, r.text
    assert len(s3.puts) == 1
    put = s3.puts[0]
    assert put["Bucket"] == "will-build-leads-test"
    assert put["Key"].endswith(".json")
    assert put["ContentType"] == "application/json"


def test_the_stored_payload_carries_the_config_context(s3):
    """A lead detached from what they configured is a name; attached, it is a quote.

    This is the whole reason the endpoint takes a config at all.
    """
    client.post("/leads", json=GOOD_LEAD)
    body = json.loads(s3.puts[0]["Body"])
    assert body["configId"] == GOOD_LEAD["configId"]
    assert body["partNumbers"] == GOOD_LEAD["partNumbers"]
    assert body["shareUrl"] == GOOD_LEAD["shareUrl"]
    assert body["deliverable"] == "bundle"


def test_the_stored_payload_is_shaped_for_a_salesforce_lead(s3):
    """Salesforce is the eventual home; the integration is explicitly NOT built.

    Designing the payload against the standard Lead object now makes that a
    field mapping later instead of a re-capture. Splitting the name here rather
    than at sync time matters because the raw name is preserved alongside — a
    later mapper can disagree with this split without having lost anything.
    """
    client.post("/leads", json=GOOD_LEAD)
    sf = json.loads(s3.puts[0]["Body"])["salesforce"]
    assert sf["FirstName"] == "Dana"
    assert sf["LastName"] == "Ruiz"
    assert sf["Email"] == GOOD_LEAD["email"]
    assert sf["Company"] == "Ruiz Lighting Design"
    assert sf["LeadSource"] == "WiLL Build Configurator"
    assert GOOD_LEAD["partNumbers"][0] in sf["Description"]


def test_a_one_word_name_still_maps(s3):
    """Salesforce requires LastName. A mononym must not produce an empty one."""
    client.post("/leads", json={**GOOD_LEAD, "name": "Prince"})
    sf = json.loads(s3.puts[0]["Body"])["salesforce"]
    assert sf["LastName"] == "Prince"
    assert sf["FirstName"] == ""


def test_a_company_less_lead_still_maps(s3):
    """Company is required by Salesforce and optional in our form."""
    payload = {k: v for k, v in GOOD_LEAD.items() if k != "company"}
    client.post("/leads", json=payload)
    sf = json.loads(s3.puts[0]["Body"])["salesforce"]
    assert sf["Company"], "Salesforce Lead.Company cannot be blank"


def test_the_timestamp_is_iso8601_utc(s3):
    from datetime import datetime

    client.post("/leads", json=GOOD_LEAD)
    body = json.loads(s3.puts[0]["Body"])
    parsed = datetime.fromisoformat(body["capturedAt"])
    assert parsed.tzinfo is not None, "a naive timestamp is ambiguous across regions"


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------

def test_the_same_person_and_config_is_stored_once(s3):
    """A visitor clicking four download cards is one lead, not four."""
    first = client.post("/leads", json=GOOD_LEAD)
    second = client.post("/leads", json={**GOOD_LEAD, "deliverable": "ifc"})
    assert first.status_code == 200 and second.status_code == 200
    assert len(s3.puts) == 1, "a duplicate was written a second time"
    assert second.json()["deduped"] is True
    assert first.json()["deduped"] is False


def test_a_different_config_from_the_same_person_is_a_new_lead(s3):
    """They configured a second product — that is genuinely new sales signal."""
    client.post("/leads", json=GOOD_LEAD)
    client.post("/leads", json={**GOOD_LEAD, "configId": "different-config-0002"})
    assert len(s3.puts) == 2


def test_dedupe_ignores_email_case_and_padding(s3):
    client.post("/leads", json=GOOD_LEAD)
    client.post("/leads", json={**GOOD_LEAD, "email": "  Dana.Ruiz@Example-Eng.com "})
    assert len(s3.puts) == 1


# ---------------------------------------------------------------------------
# Failure handling
# ---------------------------------------------------------------------------

def test_a_failed_write_does_not_report_success(s3):
    """The failure mode this endpoint exists to prevent."""
    s3.fail_with = RuntimeError("bucket policy denies PutObject")
    r = client.post("/leads", json=GOOD_LEAD)
    assert r.status_code == 502, r.text
    assert "quotes@willbrands.com" in r.json()["detail"]


# ---------------------------------------------------------------------------
# PII
# ---------------------------------------------------------------------------

def test_pii_never_reaches_the_logs(s3, caplog):
    """Leads are PII. Logs get shipped, tailed and pasted into tickets."""
    with caplog.at_level(logging.DEBUG):
        assert client.post("/leads", json=GOOD_LEAD).status_code == 200
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert GOOD_LEAD["email"] not in logged
    assert GOOD_LEAD["name"] not in logged
    assert "Ruiz" not in logged


def test_a_failure_is_logged_without_pii(s3, caplog):
    s3.fail_with = RuntimeError("bucket policy denies PutObject")
    with caplog.at_level(logging.DEBUG):
        client.post("/leads", json=GOOD_LEAD)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert logged.strip(), "a failed capture must leave an operator SOMETHING"
    assert GOOD_LEAD["email"] not in logged
    assert GOOD_LEAD["name"] not in logged


# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------

def test_notification_failure_does_not_fail_a_stored_lead(s3, monkeypatch):
    """The lead is already durable; a bounced notification must not undo it."""
    monkeypatch.setenv("LEAD_NOTIFY_TO", "quotes@willbrands.com")
    monkeypatch.setattr(
        leadstore, "_ses_client",
        lambda: (_ for _ in ()).throw(RuntimeError("SES not verified in this account")),
    )
    r = client.post("/leads", json=GOOD_LEAD)
    assert r.status_code == 200, r.text
    assert r.json()["notified"] is False
    assert len(s3.puts) == 1


def test_notification_is_reported_as_skipped_when_unconfigured(s3):
    r = client.post("/leads", json=GOOD_LEAD)
    assert r.status_code == 200
    assert r.json()["notified"] is False
