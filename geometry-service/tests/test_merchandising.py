"""Server-side merchandising enforcement (Phase 0.20, Workstream B).

Everything the builder UI enforces, a direct API caller could previously walk
straight past: a held part still generated artifacts, the mock ``rfa`` still
answered, and a fabricated option code still reached the part-number resolver.
The UI is a convenience, never the gate.

Three rules, all fail-closed, all pinned here by calling the service DIRECTLY
(TestClient, no UI in the loop):

  1. A part presented as Coming Soon produces no artifacts.
  2. Only the formats the UI actually offers are servable.
  3. Option codes must exist in the part's own catalog ordering table.

Negative controls sit next to each rule on purpose. A gate that refuses
everything passes rule tests and breaks the product, so every "refused" test
has a "still works" twin.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

REPO = Path(__file__).resolve().parents[2]

# A build made entirely of the current cut (Nick 8/24: GVX + TEX), so any
# refusal these tests see comes from the thing under test and not the config.
GOOD_CONFIG = {
    "configId": "b0000000-0000-4000-8000-00000000000b",
    "pole": "alum-pole-20",
    "baseCover": "bc-cl1-small-clamshell",
    "arm": "sh1-shepherds-hook",
    "fixture": "gvx-pendant",
    "finish": "matte-black",
    "rev": 1,
    "specOptions": {
        "fixture": {
            "lumen-output": "80",
            "color-temp": "30",
            "voltage": "MV",
            "distribution": "5W",
        }
    },
}


def _post(path: str, config: dict, formats: list[str]):
    return client.post(path, json={"config": config, "formats": formats})


def _cfg(**over) -> dict:
    out = json.loads(json.dumps(GOOD_CONFIG))
    out.update(over)
    return out


# ---------------------------------------------------------------------------
# Rule 1 — held parts produce no artifacts
# ---------------------------------------------------------------------------

# Each held part below is paired with a socket-VALID partner, so the only thing
# wrong with the config is the hold. Pair them badly and validate_config refuses
# first on a socket mismatch, and the test passes while proving nothing.
@pytest.mark.parametrize("part_id", ["drx-post-top", "willstudio-dwx-flood-spot"])
def test_a_held_fixture_produces_no_artifacts(part_id):
    """The editorial hold (Nick 8/24: the cut is GVX + TEX) binds the API too.

    Both of these have real CAD and would generate happily — the hold is a
    merchandising decision, so only a merchandising gate can express it. Both
    mount a tenon, so `direct-mount` (configurable, pseudo) carries them.
    """
    r = _post("/generate", _cfg(arm="direct-mount", fixture=part_id, specOptions={}), ["pdf"])
    assert r.status_code == 422, r.text
    assert "coming soon" in r.json()["detail"].lower()


@pytest.mark.parametrize(
    "arm_id",
    ["willstudio-cr2-decorative-crossarm",
     "aluminum-decorative-bullhorn-brackets-round-pole-mount"],
)
def test_a_held_arm_produces_no_artifacts(arm_id):
    """A hold anywhere in the assembly refuses the whole build, not just its slot.

    TEX rides on both of these arms and is itself in the cut, so the arm is the
    only held component in the config.
    """
    r = _post("/generate", _cfg(arm=arm_id, fixture="tex-post-top", specOptions={}), ["pdf"])
    assert r.status_code == 422, r.text
    assert "coming soon" in r.json()["detail"].lower()


def test_a_doubly_held_config_names_both_parts():
    """MVX can only be reached through a held arm — its sole host is `upsweep`.

    That makes it the one case where both slots are held, and the refusal
    should name both rather than stopping at the first: a caller fixing one
    part at a time would otherwise need two round trips to learn the same
    thing.
    """
    r = _post("/generate", _cfg(arm="upsweep", fixture="mvx-coach", specOptions={}), ["pdf"])
    assert r.status_code == 422, r.text
    detail = r.json()["detail"].lower()
    assert "coming soon" in detail
    assert "upsweep" in detail and "mvx-coach" in detail


def test_the_current_cut_still_generates():
    """Negative control for rule 1: a gate that refuses everything is not a gate."""
    r = _post("/generate", GOOD_CONFIG, ["pdf"])
    assert r.status_code == 200, r.text


def test_a_pseudo_part_is_not_treated_as_held():
    """`direct-mount` has no CAD and never will — it is a configuration concept.

    The frontend rule skips pseudo-parts explicitly; if the server did not, the
    entire tenon-fixture family would become ungeneratable.
    """
    r = _post("/generate", _cfg(arm="direct-mount", fixture="tex-post-top", specOptions={
        "fixture": {"lumen-output": "80", "color-temp": "30", "voltage": "MV",
                    "distribution": "5W", "mounting": "3T", "finish-color-accent": "BK"}
    }), ["pdf"])
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Rule 2 — only UI-offered formats are servable
# ---------------------------------------------------------------------------

def test_the_mock_rfa_is_unreachable():
    """The mock RFA reports available and does not open in Revit.

    It is the sharpest case for this rule: /health advertised it, so a caller
    reading the contract would reasonably request it and get a file that fails
    in the one program it names.
    """
    r = _post("/generate", GOOD_CONFIG, ["rfa"])
    assert r.status_code == 422, r.text
    assert "rfa" in r.json()["detail"].lower()


def test_a_registered_but_unoffered_format_is_refused():
    """`step` has a working adapter and no UI card. Registered != merchandised.

    The STEP a customer is meant to receive ships inside the bundle, which is
    the card the UI actually offers.
    """
    r = _post("/generate", GOOD_CONFIG, ["step"])
    assert r.status_code == 422, r.text


def test_an_unoffered_format_is_refused_even_alongside_an_offered_one():
    """Fail the whole request — no silent partial fulfilment."""
    r = _post("/generate", GOOD_CONFIG, ["pdf", "rfa"])
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("fmt", ["pdf", "dxf", "ifc", "herocard", "bundle"])
def test_every_ui_offered_format_is_still_servable(fmt):
    """Negative control for rule 2, one card at a time."""
    r = _post("/generate", GOOD_CONFIG, [fmt])
    assert r.status_code == 200, r.text


def test_health_does_not_advertise_an_unservable_format():
    """/health is the contract a direct caller reads.

    Advertising `rfa: true` while /generate refuses it would just move the
    dishonesty from the artifact to the handshake.
    """
    adapters = client.get("/health").json()["adapters"]
    assert "rfa" not in adapters
    assert "step" not in adapters
    assert "pdf" in adapters


def test_servable_formats_match_the_builder_cards():
    """The two lists live in different languages; pin them to each other.

    `DELIVERABLE_DEFS` (OutputTray.tsx) is what a visitor can click. If someone
    adds a card without opening the allowlist the new card 422s in production,
    and if someone opens the allowlist without a card the format is reachable
    but unmerchandised — this fails on both.
    """
    from app.merchandising import SERVABLE_FORMATS

    tsx = (REPO / "src" / "components" / "OutputTray.tsx").read_text()
    block = tsx.split("DELIVERABLE_DEFS: DeliverableDef[] = [", 1)[1].split("\n]", 1)[0]
    ui_formats = set(re.findall(r"^\s*format: '([a-z]+)'", block, re.MULTILINE))

    assert ui_formats, "could not parse DELIVERABLE_DEFS — update this test with the source"
    # dwg is the DXF card's documented alternative (it ships only when the ODA
    # binary is present), so it is allowed without a card of its own.
    assert SERVABLE_FORMATS - {"dwg"} == ui_formats


# ---------------------------------------------------------------------------
# Rule 3 — option codes validated against the catalog
# ---------------------------------------------------------------------------

def test_a_fabricated_option_code_is_refused():
    """The code reaches the part number, so an invented one prints a fake SKU."""
    bad = _cfg()
    bad["specOptions"] = {"fixture": {**GOOD_CONFIG["specOptions"]["fixture"],
                                      "distribution": "9Z"}}
    r = _post("/generate", bad, ["pdf"])
    assert r.status_code == 422, r.text
    assert "9Z" in r.json()["detail"]


def test_an_option_code_from_the_wrong_part_is_refused():
    """`3T` is a real code — on TEX's mounting column, which GVX does not have."""
    bad = _cfg()
    bad["specOptions"] = {"fixture": {**GOOD_CONFIG["specOptions"]["fixture"],
                                      "mounting": "3T"}}
    r = _post("/generate", bad, ["pdf"])
    assert r.status_code == 422, r.text


def test_a_valid_option_code_passes():
    """Negative control for rule 3."""
    r = _post("/generate", GOOD_CONFIG, ["pdf"])
    assert r.status_code == 200, r.text


def test_multi_select_option_codes_are_validated_elementwise():
    """Accessory columns take a LIST; one bad entry must sink the request."""
    bad = _cfg()
    bad["specOptions"] = {"fixture": {**GOOD_CONFIG["specOptions"]["fixture"],
                                      "options": ["BPCX", "NOT-A-CODE"]}}
    r = _post("/generate", bad, ["pdf"])
    assert r.status_code == 422, r.text
    assert "NOT-A-CODE" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Both entry points, same gate
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("route", ["/generate", "/jobs"])
def test_the_async_route_refuses_identically(route):
    """/jobs validates before scheduling, or the gate is one route wide."""
    assert _post(route, _cfg(fixture="drx-post-top", specOptions={}), ["pdf"]).status_code == 422
    assert _post(route, GOOD_CONFIG, ["rfa"]).status_code == 422
