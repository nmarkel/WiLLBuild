"""APS (Autodesk Platform Services) Design Automation client.

Defines:
  - ApsClient Protocol: submit(config_hash, params) -> bytes
  - MockApsClient: deterministic placeholder bytes; no network calls
  - RealApsClient: outlines OAuth→workitem→poll→download; import-safe but
    NOT called in tests (no creds available)
  - get_aps_client(): returns (client, is_mock) based on env vars

Boundary rule: httpx is imported ONLY here, inside app/adapters/.
"""

from __future__ import annotations

import json
import os
from typing import Protocol, runtime_checkable

from app.naming import DISCLAIMER


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class ApsClient(Protocol):
    """Minimal interface for an APS Design Automation client."""

    def submit(self, config_hash: str, params: dict) -> bytes:
        """Submit a workitem for the given config and return the .rfa bytes."""
        ...


# ---------------------------------------------------------------------------
# Mock client
# ---------------------------------------------------------------------------

class MockApsClient:
    """Deterministic placeholder APS client — no network, no credentials.

    Produces a documented placeholder container structured so that the real
    Design Automation client can drop in behind the same ApsClient interface
    once credentials exist.

    The output is byte-identical across runs for the same inputs because:
    - JSON uses sort_keys=True, indent=2 — no randomness
    - No wall-clock timestamps are included
    """

    def submit(self, config_hash: str, params: dict) -> bytes:
        """Return a deterministic ASCII payload documenting the mock contract."""
        manifest = {
            "configHash": config_hash,
            "disclaimer": DISCLAIMER,
            "note": (
                "Mock APS output - real Design Automation .rfa pending Autodesk developer account"
            ),
            "params": dict(sorted(params.items())),
        }
        header = "WiLL-RFA-MOCK v1"
        body = json.dumps(manifest, sort_keys=True, indent=2)
        return f"{header}\n{body}".encode("ascii")


# ---------------------------------------------------------------------------
# Real client (outline — guarded, never called without creds)
# ---------------------------------------------------------------------------

class RealApsClient:
    """APS Design Automation client — outlines the real OAuth→workitem→poll→download flow.

    NEVER called in tests (requires real Autodesk developer credentials).
    Import-safe: httpx is imported lazily inside submit() so a missing package
    cannot crash module load.

    Environment variables required:
      APS_CLIENT_ID      — Autodesk application client ID
      APS_CLIENT_SECRET  — Autodesk application client secret
      APS_ACTIVITY_ID    — Design Automation activity ID (e.g. "WiLLBuild.CreateRfa+prod")
    """

    def __init__(self) -> None:
        self.client_id = os.environ.get("APS_CLIENT_ID", "")
        self.client_secret = os.environ.get("APS_CLIENT_SECRET", "")
        self.activity_id = os.environ.get("APS_ACTIVITY_ID", "")

    def submit(self, config_hash: str, params: dict) -> bytes:
        """Full APS Design Automation flow — outlined; requires real credentials.

        Steps (not implemented — pending Autodesk developer account):
          1. POST /authentication/v2/token → bearer token (2-legged OAuth)
          2. POST /oss/v2/buckets/{bucket}/objects/{key} — upload params JSON
          3. POST /da/us-east/v3/workitems — create workitem referencing activity
          4. GET  /da/us-east/v3/workitems/{id} → poll until status in
             {"success", "failed", "cancelled", "timedout"}
          5. Fetch the output .rfa from the signed output URL
          6. Return raw bytes of the .rfa
        """
        # Guard: this should only be called with real credentials.
        if not self.client_id or not self.client_secret:
            raise RuntimeError(
                "RealApsClient.submit called without APS_CLIENT_ID / APS_CLIENT_SECRET"
            )

        # Lazy import so a missing httpx package can't crash module load.
        try:
            import httpx  # noqa: F401 — used in the real implementation below
        except ImportError as exc:
            raise RuntimeError("httpx is required for RealApsClient: pip install httpx") from exc

        # ---- Step 1: 2-legged OAuth ----
        # token_resp = httpx.post(
        #     "https://developer.api.autodesk.com/authentication/v2/token",
        #     data={
        #         "client_id": self.client_id,
        #         "client_secret": self.client_secret,
        #         "grant_type": "client_credentials",
        #         "scope": "data:read data:write code:all",
        #     },
        # )
        # token_resp.raise_for_status()
        # bearer = token_resp.json()["access_token"]
        # headers = {"Authorization": f"Bearer {bearer}"}

        # ---- Step 2: Upload params ----
        # (Upload params JSON as workitem input to OSS bucket or signed URL)

        # ---- Step 3: Create workitem ----
        # wi_resp = httpx.post(
        #     "https://developer.api.autodesk.com/da/us-east/v3/workitems",
        #     headers=headers,
        #     json={
        #         "activityId": self.activity_id,
        #         "arguments": {
        #             "params": {"verb": "get", "url": "<signed-params-url>"},
        #             "result": {"verb": "put", "url": "<signed-output-url>"},
        #         },
        #     },
        # )
        # wi_resp.raise_for_status()
        # workitem_id = wi_resp.json()["id"]

        # ---- Step 4: Poll until complete ----
        # import time
        # for _ in range(60):
        #     status_resp = httpx.get(
        #         f"https://developer.api.autodesk.com/da/us-east/v3/workitems/{workitem_id}",
        #         headers=headers,
        #     )
        #     status_resp.raise_for_status()
        #     status = status_resp.json()["status"]
        #     if status == "success":
        #         break
        #     elif status in {"failed", "cancelled", "timedout"}:
        #         raise RuntimeError(f"APS workitem {workitem_id} ended with status: {status}")
        #     time.sleep(5)
        # else:
        #     raise RuntimeError(f"APS workitem {workitem_id} timed out after polling")

        # ---- Step 5: Download .rfa output ----
        # output_url = status_resp.json()["outputArguments"]["result"]["url"]
        # rfa_resp = httpx.get(output_url)
        # rfa_resp.raise_for_status()
        # return rfa_resp.content

        raise NotImplementedError(
            "RealApsClient.submit is not yet implemented — "
            "pending Autodesk developer account and APS activity setup"
        )


# ---------------------------------------------------------------------------
# Selector
# ---------------------------------------------------------------------------

def get_aps_client() -> tuple[ApsClient, bool]:
    """Return (client, is_mock).

    Returns RealApsClient iff BOTH APS_CLIENT_ID and APS_CLIENT_SECRET are
    set in the environment; otherwise returns MockApsClient.
    """
    client_id = os.environ.get("APS_CLIENT_ID", "")
    client_secret = os.environ.get("APS_CLIENT_SECRET", "")
    if client_id and client_secret:
        return RealApsClient(), False
    return MockApsClient(), True
