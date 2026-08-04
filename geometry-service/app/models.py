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
    heightFt: float


class PartSelections(BaseModel):
    """Phase 0.10: one part's ordering-matrix selections.

    ``codes`` are single-select ordering columns (Design, Voltage, …); ``addOns``
    is the multi-select Options/Accessories field.  These drive the part NUMBER,
    not the geometry — see app/partnumber.py.
    """

    codes: dict[str, str] = {}
    addOns: list[str] = []


class PoleConfig(BaseModel):
    configId: str
    brand: str = "WiLLstudio"
    pole: str
    baseCover: str
    arm: str
    fixture: str
    finish: str
    rev: int
    # Phase 0.8: N arms mounted radially around the pole top. 1|2|3|4.
    # Absent/1 → byte-identical to the pre-0.8 single-arm output.
    armCount: int = 1
    # Phase 0.8 banner accessory — accepted but ignored this pass (see BannerConfig).
    banner: BannerConfig | None = None
    # Phase 0.10 (Workstream 0): per-part ordering selections, keyed by part id.
    # They resolve each component's WiLL part number, which is printed on the
    # spec sheet + concept card.
    partOptions: dict[str, PartSelections] | None = None


class GenerateRequest(BaseModel):
    config: PoleConfig
    formats: list[Literal["step", "dxf", "dwg", "ifc", "pdf", "bundle", "herocard", "rfa"]]
    renderPng: str | None = None  # base64-encoded PNG


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
