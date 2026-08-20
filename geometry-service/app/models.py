"""Pydantic models for the geometry-service HTTP contract."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class BannerConfig(BaseModel):
    """Mid-shaft banner-arm accessory (Phase 0.8).

    Carried on the config so requests don't 422, but IGNORED by the geometry
    pipeline in this pass — a later message extends the kit/adapters for it.
    """

    armId: str
    count: int
    # Phase 0.11 (Workstream D): the BOTTOM EDGE of the banner above grade —
    # NOT its vertical centre, which is what this meant through 0.10.5. Both
    # banner paths agree on this reference point; see src/types.ts.
    heightFt: float
    # Ordered panel size id (18x36 | 24x48 | 30x60). Absent → the catalog
    # default, which keeps pre-0.11 configs and share links working.
    size: str | None = None


class AccessoryPlacement(BaseModel):
    """Phase 0.10.5: shaft placement for a placeable pole accessory.

    Accepted so a full config round-trips through the service without loss.
    The geometry kit does not consume it yet.
    """

    # Phase 0.11 (D): height to the BOTTOM of the accessory, agreeing with
    # BannerConfig above — the two banner paths must not disagree.
    heightFt: float
    orientation: int = 0
    sides: int | None = None
    size: str | None = None


class PoleConfig(BaseModel):
    configId: str
    brand: str = "WiLLstudio"
    pole: str
    baseCover: str
    arm: str
    fixture: str
    # Base finish.  Still the single-finish field the frozen HTTP contract and
    # pre-0.10.5 share URLs expect; `finishes` overrides it per slot.
    finish: str
    rev: int
    # Phase 0.8: N arms mounted radially around the pole top. 1|2|3|4.
    # Absent/1 → byte-identical to the pre-0.8 single-arm output.
    armCount: int = 1
    # Phase 0.8 banner accessory — accepted but ignored this pass (see BannerConfig).
    banner: BannerConfig | None = None
    # ---- Phase 0.11 -------------------------------------------------------
    # These four fields already rode the wire from the browser (the client
    # POSTs the whole config object), but pydantic silently DROPPED them
    # because the model never declared them.  That is why per-slot finish and
    # ordering selections could not reach a generated file.  Declaring them is
    # the plumbing Workstreams Z1/Z2 and A need; every one is optional, so an
    # older client that omits them produces byte-identical output.
    #
    # Workstream A: per-slot finish overrides, keyed by slot
    # (fixture|arm|pole|baseCover).  Absent slot → the base `finish`.
    finishes: dict[str, str] | None = None
    # Phase 0.12: per-slot SECOND finish, for parts whose sheet carries two
    # finish segments.  TEX is the first — Housing plus Spider Mount & Accent
    # Line, with the accent designation required even on side mounts.  Absent
    # slot → that slot's own finish.  Declared here for exactly the reason the
    # five fields above were: an undeclared field is silently dropped, so the
    # generated PDF/bundle would print a different part number than the browser
    # showed — the 0.10.5 failure mode, not a hypothetical.
    accentFinishes: dict[str, str] | None = None
    # Workstream A: customer-picked #rrggbb for a slot whose finish is
    # `custom-ral`.  Carried into the spec sheet so the quote knows what to
    # match; it does not change geometry.
    finishRal: dict[str, str] | None = None
    # Workstream Z1: per-slot spec-sheet ordering selections, keyed by slot
    # then column key.  Ordering columns hold one code (str); options &
    # accessories columns hold several (list[str]).  These resolve the part
    # number — see app/partnumber.py.
    specOptions: dict[str, dict[str, str | list[str]]] | None = None
    # Phase 0.10.5 viewer/ordering axes accepted so a full config round-trips
    # without loss.  Neither reaches the geometry kit yet.
    armOrientation: int | None = None
    # CR-OPT-11 (Tyler 8/14): placements are INSTANCED — arrays are canonical;
    # single objects accepted for pre-8/14 payload compatibility.
    accessoryPlacements: dict[str, list[AccessoryPlacement] | AccessoryPlacement] | None = None


class GenerateRequest(BaseModel):
    config: PoleConfig
    formats: list[Literal["step", "dxf", "dwg", "ifc", "pdf", "bundle", "herocard", "rfa"]]
    renderPng: str | None = None  # base64-encoded PNG
    # Phase 0.17 (Tyler 8/19): normalized (0..1) position of each slot's part
    # inside renderPng, published by the viewer's compositor. The concept card
    # draws leader-line callouts there. Absent → label list, no leaders.
    # Deliberately NOT in config_hash: it is a property of the supplied render,
    # not of the configuration.
    renderAnchors: dict[str, list[float]] | None = None
    # Phase 0.17 (Tyler 8/20): the live share link for this build; the concept
    # card prints it with a QR so a client opens the exact configurator state.
    # Supplied by the frontend (it owns its own URL) and NOT hashed — it does
    # not change the configuration.
    shareUrl: str | None = None


class FileEntry(BaseModel):
    format: str
    filename: str
    url: str
    sizeBytes: int


class GenerateResponse(BaseModel):
    configHash: str
    files: list[FileEntry]
    warnings: list[str]


class JobSubmitResponse(BaseModel):
    jobId: str
    configHash: str
    status: Literal["pending", "done"]
    cached: bool


class JobStatusResponse(BaseModel):
    jobId: str
    status: Literal["pending", "running", "done", "error"]
    progress: float
    stage: str
    files: list[FileEntry]
    warnings: list[str]
    error: str | None = None
