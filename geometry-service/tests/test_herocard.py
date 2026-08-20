"""Tests for the HeroCard adapter (Task 3 — Phase 0.4).

TDD order: tests written before implementation. Each must fail first (RED),
then pass after implementation (GREEN).

Covered behaviours
------------------
a) Hero file is produced and ends with '-hero.pdf'
b) PDF bytes contain DISCLAIMER and configId (raw bytes search, latin-1)
c) Determinism — two runs byte-identical
d) config_status returns 'Configurable' for a normal catalog build
e) /generate ["herocard"] integration returns 200 + herocard in files
f) /health lists "herocard" in adapters
g) Hero PDF starts with %PDF magic bytes
"""

from __future__ import annotations

import base64
import io
import uuid
from pathlib import Path

import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name

from .conftest import first_base_cover_for

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/"
    "HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
)
_TINY_PNG_BYTES = base64.b64decode(_TINY_PNG_B64)


def _cfg(cat: dict, config_id: str | None = None) -> PoleConfig:
    return PoleConfig(
        configId=config_id or "hero-test-" + str(uuid.uuid4())[:8],
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


def _make_ctx(
    cat: dict,
    cfg: PoleConfig,
    out_dir: Path,
    render_png: bytes | None = None,
):
    from app.adapters.base import GenContext

    asm = build_assembly(cat, cfg)
    finish_map = {f["id"]: f for f in cat.get("finishes", [])}
    finish_obj = finish_map.get(cfg.finish, {})
    finish_name = finish_obj.get("name", cfg.finish)
    finish_ral = finish_obj.get("ral", "")

    parts_list = []
    part_map = {p["id"]: p for p in cat.get("parts", [])}
    for slot_field, slot_name in [
        ("fixture", "fixture"),
        ("arm", "arm"),
        ("pole", "pole"),
        ("baseCover", "baseCover"),
    ]:
        part_id = getattr(cfg, slot_field)
        part_obj = part_map.get(part_id)
        if part_obj:
            parts_list.append({
                "slot": slot_name,
                "id": part_id,
                "name": part_obj.get("name", part_id),
                "productUrl": part_obj.get("productUrl", ""),
            })

    summary = {
        "finish": finish_name,
        "finish_ral": finish_ral,
        "parts": parts_list,
        "dims": {
            "overall_height_mm": asm.dims.overall_height,
            "pole_height_mm": asm.dims.pole_height,
            "mounting_height_mm": asm.dims.mounting_height,
            "arm_reach_mm": asm.dims.arm_reach,
            "base_diameter_mm": asm.dims.base_diameter,
        },
    }

    return GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=out_dir,
        base_name=base_name(cat, cfg),
        assembly=asm,
        render_png=render_png,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="session")
def fixed_cfg(cat) -> PoleConfig:
    return _cfg(cat, "hero-fixed-test-0001")


# ---------------------------------------------------------------------------
# Test (a): File produced with -hero.pdf suffix
# ---------------------------------------------------------------------------

class TestHeroCardFileProduced:
    def test_herocard_adapter_generate_writes_hero_pdf(self, cat, tmp_path) -> None:
        """HeroCardAdapter.generate must write a file whose name ends with -hero.pdf."""
        from app.adapters.herocard_adapter import HeroCardAdapter

        cfg = _cfg(cat, "hero-file-test-0001")
        ctx = _make_ctx(cat, cfg, tmp_path)
        adapter = HeroCardAdapter()
        out_paths = adapter.generate(ctx)

        assert len(out_paths) == 1, f"Expected 1 output path, got {out_paths}"
        out_path = out_paths[0]
        assert out_path.name.endswith("-hero.pdf"), (
            f"Hero card filename must end with '-hero.pdf', got: {out_path.name!r}"
        )
        assert out_path.exists(), "Hero card file must be written to disk"

    def test_herocard_adapter_available_is_true(self) -> None:
        from app.adapters.herocard_adapter import HeroCardAdapter
        assert HeroCardAdapter().available() is True

    def test_herocard_format_string(self) -> None:
        from app.adapters.herocard_adapter import HeroCardAdapter
        assert HeroCardAdapter.format == "herocard"


# ---------------------------------------------------------------------------
# Test (b): PDF bytes contain DISCLAIMER and configId
# ---------------------------------------------------------------------------

class TestHeroCardContent:
    def test_pdf_magic_bytes(self, cat, tmp_path) -> None:
        """Hero card must start with %PDF."""
        from app.adapters.herocard_adapter import HeroCardAdapter

        cfg = _cfg(cat, "hero-magic-test-0001")
        ctx = _make_ctx(cat, cfg, tmp_path)
        adapter = HeroCardAdapter()
        paths = adapter.generate(ctx)
        pdf_bytes = paths[0].read_bytes()
        assert pdf_bytes[:4] == b"%PDF", "Hero card must start with %PDF magic"

    def test_pdf_contains_disclaimer(self, cat, tmp_path) -> None:
        """DISCLAIMER text must appear in the extracted PDF text."""
        from app.adapters.herocard_adapter import HeroCardAdapter
        from pypdf import PdfReader

        cfg = _cfg(cat, "hero-disc-test-0001")
        ctx = _make_ctx(cat, cfg, tmp_path)
        adapter = HeroCardAdapter()
        paths = adapter.generate(ctx)
        pdf_bytes = paths[0].read_bytes()

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "".join(page.extract_text() or "" for page in reader.pages)
        # DISCLAIMER is a long string — check a significant prefix
        assert DISCLAIMER[:40] in text, (
            f"DISCLAIMER prefix not found in hero card PDF text"
        )

    def test_pdf_contains_config_id(self, cat, tmp_path) -> None:
        """configId must appear in the extracted PDF text."""
        from app.adapters.herocard_adapter import HeroCardAdapter
        from pypdf import PdfReader

        config_id = "hero-cfgid-test-0001"
        cfg = _cfg(cat, config_id)
        ctx = _make_ctx(cat, cfg, tmp_path)
        adapter = HeroCardAdapter()
        paths = adapter.generate(ctx)
        pdf_bytes = paths[0].read_bytes()

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "".join(page.extract_text() or "" for page in reader.pages)
        assert config_id in text, (
            f"configId {config_id!r} not found in hero card PDF text"
        )

    def test_names_itself_a_concept_drawing_like_wills_own_cards(self, cat, tmp_path) -> None:
        """Phase 0.17 (Tyler 8/19): the hero card is rebuilt to WiLL's own
        design-library pattern, so the PAGE calls itself what those cards do —
        "CONCEPT DRAWING / DETAILED APPROVAL DRAWING AT ORDER ENTRY" — and
        carries the assembly title plus contact block. (The generic
        "Concept Card" header band is gone: the hero paints its own field, and
        the PDF metadata /Title still identifies the document.)"""
        from app.adapters.herocard_adapter import HeroCardAdapter
        from pypdf import PdfReader

        cfg = _cfg(cat, "hero-title-test-0001")
        ctx = _make_ctx(cat, cfg, tmp_path)
        adapter = HeroCardAdapter()
        paths = adapter.generate(ctx)
        pdf_bytes = paths[0].read_bytes()

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        assert "CONCEPT DRAWING" in text
        assert "DETAILED APPROVAL DRAWING AT ORDER ENTRY" in text
        assert "ARCHITECTURAL ASSEMBLY" in text
        assert "WiLLBrands.com" in text
        assert reader.metadata.title and "Concept Card" in reader.metadata.title


# ---------------------------------------------------------------------------
# Test (c): Determinism
# ---------------------------------------------------------------------------

class TestHeroCardDeterminism:
    def test_two_runs_byte_identical(self, cat, tmp_path_factory) -> None:
        """Two calls with identical inputs must produce byte-identical hero PDFs."""
        from app.adapters.herocard_adapter import HeroCardAdapter

        cfg = PoleConfig(
            configId="hero-determinism-check-001",
            pole="alum-pole-20",
            baseCover=first_base_cover_for(cat, "alum-pole-20"),
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        out1 = tmp_path_factory.mktemp("hero_det1")
        out2 = tmp_path_factory.mktemp("hero_det2")
        ctx1 = _make_ctx(cat, cfg, out1)
        ctx2 = _make_ctx(cat, cfg, out2)

        adapter = HeroCardAdapter()
        paths1 = adapter.generate(ctx1)
        paths2 = adapter.generate(ctx2)

        pdf1 = paths1[0].read_bytes()
        pdf2 = paths2[0].read_bytes()
        assert pdf1 == pdf2, (
            f"Hero card determinism failed: byte lengths {len(pdf1)} vs {len(pdf2)}"
        )


# ---------------------------------------------------------------------------
# Test (d): config_status returns 'Configurable' for a normal build
# ---------------------------------------------------------------------------

class TestConfigStatus:
    def test_returns_configurable_for_normal_build(self, cat) -> None:
        """config_status must return 'Configurable' when referenceAssemblies is empty."""
        from app.catalog import config_status

        cfg = _cfg(cat, "hero-status-test-0001")
        result = config_status(cat, cfg)
        assert result == "Configurable", (
            f"Expected 'Configurable' (referenceAssemblies empty), got {result!r}"
        )

    def test_returns_standard_when_ref_assembly_matches(self, cat) -> None:
        """config_status returns 'Standard' when config matches a referenceAssembly."""
        from app.catalog import config_status

        bc = first_base_cover_for(cat, "alum-pole-20")
        mock_catalog = {
            "referenceAssemblies": [
                {
                    "pole": "alum-pole-20",
                    "baseCover": bc,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                }
            ]
        }
        cfg = PoleConfig(
            configId="hero-std-test-0001",
            pole="alum-pole-20",
            baseCover=bc,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        result = config_status(mock_catalog, cfg)
        assert result == "Standard", f"Expected 'Standard', got {result!r}"

    def test_returns_configurable_when_ref_assembly_no_match(self, cat) -> None:
        """config_status returns 'Configurable' when no referenceAssembly matches."""
        from app.catalog import config_status

        bc = first_base_cover_for(cat, "alum-pole-20")
        mock_catalog = {
            "referenceAssemblies": [
                {
                    "pole": "other-pole",
                    "baseCover": bc,
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                }
            ]
        }
        cfg = PoleConfig(
            configId="hero-notstd-test-0001",
            pole="alum-pole-20",
            baseCover=bc,
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        result = config_status(mock_catalog, cfg)
        assert result == "Configurable", f"Expected 'Configurable', got {result!r}"


# ---------------------------------------------------------------------------
# Test (e + f): /generate integration and /health
# ---------------------------------------------------------------------------

class TestHeroCardIntegration:
    def test_generate_herocard_returns_200_with_hero_file(self, cat) -> None:
        from app.main import app
        from fastapi.testclient import TestClient

        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "hero-integration-test-001",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["herocard"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, (
            f"Expected 200 for herocard format, got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        assert "files" in body
        hero_files = [f for f in body["files"] if f["format"] == "herocard"]
        assert len(hero_files) == 1, f"Expected 1 herocard file, got {hero_files}"
        assert hero_files[0]["filename"].endswith("-hero.pdf"), (
            f"Expected -hero.pdf suffix, got {hero_files[0]['filename']!r}"
        )

    def test_health_lists_herocard_adapter(self) -> None:
        from app.main import app
        from fastapi.testclient import TestClient

        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "herocard" in body["adapters"], (
            f"herocard not in health adapters: {body['adapters']}"
        )
