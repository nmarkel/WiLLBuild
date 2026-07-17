"""Pydantic models for the geometry-service HTTP contract."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PoleConfig(BaseModel):
    configId: str
    brand: str = "WiLLstudio"
    pole: str
    baseCover: str
    arm: str
    fixture: str
    finish: str
    rev: int


class GenerateRequest(BaseModel):
    config: PoleConfig
    formats: list[Literal["step", "dxf", "dwg", "ifc", "pdf", "bundle", "herocard"]]
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
