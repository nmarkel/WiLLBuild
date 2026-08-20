"""Tests for the PDF spec-sheet adapter (Task 6 — Phase 0.3).

TDD order: tests written before implementation. Each must fail first.

Covered behaviours
------------------
1. Output is a valid PDF (%PDF magic byte)
2. pypdf can parse the PDF without error
3. Extracted text contains config ID
4. Extracted text contains DISCLAIMER
5. Extracted text contains every part name from the config
6. Extracted text contains finish name AND RAL code
7. Extracted text contains overall height in both mm and ft-in
8. Extracted text contains quote URL
9. With renderPng → page has an image XObject embedded
10. Without renderPng → text contains "Render not supplied"
11. Determinism — two runs with identical input → byte-identical output
12. /generate ["pdf"] integration returns 200 + pdf in files
13. /health lists "pdf" in adapters
"""

from __future__ import annotations

import base64
import io
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import GenContext
from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name

from .conftest import first_base_cover_for

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Tiny valid 1×1 transparent PNG for render tests
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/"
    "HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
)
_TINY_PNG_BYTES = base64.b64decode(_TINY_PNG_B64)


def _cfg(cat: dict, config_id: str | None = None) -> PoleConfig:
    return PoleConfig(
        configId=config_id or "pdf-test-" + str(uuid.uuid4())[:8],
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
) -> GenContext:
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


def _extract_text(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF bytes object using pypdf."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text


def _has_image_xobject(pdf_bytes: bytes) -> bool:
    """Return True if the PDF has at least one image XObject."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        resources = page.get("/Resources")
        if resources is None:
            continue
        xobjects = resources.get("/XObject")
        if xobjects is None:
            continue
        for key in xobjects:
            xobj = xobjects[key]
            if xobj.get("/Subtype") == "/Image":
                return True
    return False


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="session")
def fixed_cfg(cat) -> PoleConfig:
    return _cfg(cat, "pdf-fixed-test-0001")


@pytest.fixture(scope="session")
def pdf_bytes_no_render(cat, fixed_cfg, tmp_path_factory) -> bytes:
    """Generate a PDF without a render PNG."""
    from app.spec_template import render_spec
    out = tmp_path_factory.mktemp("pdf_no_render")
    ctx = _make_ctx(cat, fixed_cfg, out, render_png=None)
    return render_spec(ctx, mode="spec")


@pytest.fixture(scope="session")
def pdf_bytes_with_render(cat, fixed_cfg, tmp_path_factory) -> bytes:
    """Generate a PDF with a render PNG."""
    from app.spec_template import render_spec
    out = tmp_path_factory.mktemp("pdf_with_render")
    ctx = _make_ctx(cat, fixed_cfg, out, render_png=_TINY_PNG_BYTES)
    return render_spec(ctx, mode="spec")


# ---------------------------------------------------------------------------
# Test: basic PDF validity
# ---------------------------------------------------------------------------

class TestPdfMagic:
    def test_output_starts_with_pdf_magic(self, pdf_bytes_no_render: bytes) -> None:
        assert pdf_bytes_no_render[:4] == b"%PDF", (
            "PDF output must start with %PDF magic bytes"
        )

    def test_pypdf_can_parse_without_error(self, pdf_bytes_no_render: bytes) -> None:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes_no_render))
        assert len(reader.pages) >= 1, "PDF must have at least one page"


# ---------------------------------------------------------------------------
# Test: text content
# ---------------------------------------------------------------------------

class TestPdfTextContent:
    def test_contains_config_id(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        assert fixed_cfg.configId in text, (
            f"configId={fixed_cfg.configId!r} not found in PDF text"
        )

    def test_contains_disclaimer(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        # DISCLAIMER is a long string — check a significant substring
        assert DISCLAIMER[:40] in text, (
            f"DISCLAIMER prefix not found in PDF text"
        )

    def test_contains_all_part_names(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        part_map = {p["id"]: p for p in cat["parts"]}
        for slot_field in ("fixture", "arm", "pole", "baseCover"):
            part_id = getattr(fixed_cfg, slot_field)
            part_name = part_map[part_id]["name"]
            assert part_name in text, (
                f"Part name {part_name!r} (slot={slot_field}) not found in PDF text"
            )

    def test_contains_finish_name(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        finish_map = {f["id"]: f for f in cat["finishes"]}
        finish_name = finish_map[fixed_cfg.finish]["name"]
        assert finish_name in text, (
            f"Finish name {finish_name!r} not found in PDF text"
        )

    def test_contains_finish_ral(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        finish_map = {f["id"]: f for f in cat["finishes"]}
        ral = finish_map[fixed_cfg.finish].get("ral", "")
        assert ral, "matte-black finish must have a RAL code in catalog"
        assert ral in text, f"RAL code {ral!r} not found in PDF text"

    def test_dims_are_imperial_only(self, cat, fixed_cfg, tmp_path) -> None:
        """Phase 0.17 (Tyler 8/19): metric is never used with these products
        and customers — the mm column is gone from every generated document."""
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        assert " mm" not in text, "generated documents must not print metric"

    def test_contains_overall_height_ft_in(self, cat, fixed_cfg, tmp_path) -> None:
        """Overall height must appear in ft-in format (e.g. \"20'-0\")."""
        from app.spec_template import render_spec, _mm_to_ft_in
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        # Compute the expected ft-in string from the assembly's overall height
        asm = build_assembly(cat, fixed_cfg)
        expected_ftin = _mm_to_ft_in(asm.dims.overall_height)
        # Normalize curly/straight quotes for PDF extraction variance
        text_normalized = text.replace('"', '"').replace('"', '"').replace(''', "'").replace(''', "'")
        expected_normalized = expected_ftin.replace('"', '"').replace('"', '"').replace(''', "'").replace(''', "'")
        assert expected_normalized in text_normalized, (
            f"Expected ft-in string {expected_ftin!r} not found in PDF text"
        )

    def test_contains_quote_url(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        assert "willbrands.com/pages/request-a-quote" in text, (
            "Quote URL not found in PDF text"
        )


# ---------------------------------------------------------------------------
# Test: image XObject (render PNG)
# ---------------------------------------------------------------------------

class TestPdfImageXObject:
    def test_with_render_png_has_image_xobject(
        self, pdf_bytes_with_render: bytes
    ) -> None:
        assert _has_image_xobject(pdf_bytes_with_render), (
            "PDF with renderPng must embed an image XObject"
        )

    def test_without_render_png_has_placeholder_text(
        self, pdf_bytes_no_render: bytes
    ) -> None:
        text = _extract_text(pdf_bytes_no_render)
        assert "Render not supplied" in text or "render not supplied" in text.lower(), (
            "PDF without renderPng must include 'Render not supplied' placeholder text"
        )

    def test_corrupt_png_fallback_to_placeholder(self, cat, fixed_cfg, tmp_path) -> None:
        """Corrupt PNG bytes should fall back to placeholder without crashing."""
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path, render_png=b"not a png")
        pdf = render_spec(ctx)
        text = _extract_text(pdf)
        # Should produce valid PDF with placeholder text
        assert pdf[:4] == b"%PDF", "Output must be valid PDF"
        assert "Render not supplied" in text or "render not supplied" in text.lower(), (
            "Corrupt PNG should fall back to 'Render not supplied' placeholder"
        )


# ---------------------------------------------------------------------------
# Test: determinism
# ---------------------------------------------------------------------------

class TestPdfDeterminism:
    def test_two_runs_byte_identical(self, cat, tmp_path_factory) -> None:
        """Two calls with identical inputs must produce byte-identical output."""
        from app.spec_template import render_spec
        cfg = PoleConfig(
            configId="pdf-determinism-check-001",
            pole="alum-pole-20",
            baseCover=first_base_cover_for(cat, "alum-pole-20"),
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        out1 = tmp_path_factory.mktemp("det1")
        out2 = tmp_path_factory.mktemp("det2")
        ctx1 = _make_ctx(cat, cfg, out1)
        ctx2 = _make_ctx(cat, cfg, out2)
        pdf1 = render_spec(ctx1, mode="spec")
        pdf2 = render_spec(ctx2, mode="spec")
        assert pdf1 == pdf2, (
            f"Determinism failed: PDF byte lengths differ "
            f"({len(pdf1)} vs {len(pdf2)})"
        )

    def test_concept_card_mode_two_runs_byte_identical(self, cat, tmp_path_factory) -> None:
        """concept-card mode also produces deterministic output."""
        from app.spec_template import render_spec
        cfg = PoleConfig(
            configId="pdf-cc-determinism-001",
            pole="alum-pole-20",
            baseCover=first_base_cover_for(cat, "alum-pole-20"),
            arm="sh1-shepherds-hook",
            fixture="gvx-pendant",
            finish="matte-black",
            rev=1,
        )
        out1 = tmp_path_factory.mktemp("cc1")
        out2 = tmp_path_factory.mktemp("cc2")
        ctx1 = _make_ctx(cat, cfg, out1)
        ctx2 = _make_ctx(cat, cfg, out2)
        pdf1 = render_spec(ctx1, mode="concept-card")
        pdf2 = render_spec(ctx2, mode="concept-card")
        assert pdf1 == pdf2, "concept-card mode not deterministic"


# ---------------------------------------------------------------------------
# Test: concept-card mode title
# ---------------------------------------------------------------------------

class TestPdfModes:
    def test_spec_mode_title_in_text(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx, mode="spec")
        text = _extract_text(pdf)
        # Phase 0.17 (Tyler 8/19): it is a CONFIGURATION CARD, not a spec
        # sheet — it doesn't carry what a submittal spec must; it links to
        # each element's real spec instead.
        assert "Configuration Card" in text, "spec mode must use 'Configuration Card' title"

    def test_concept_card_mode_title_in_text(self, cat, fixed_cfg, tmp_path) -> None:
        from app.spec_template import render_spec
        ctx = _make_ctx(cat, fixed_cfg, tmp_path)
        pdf = render_spec(ctx, mode="concept-card")
        text = _extract_text(pdf)
        assert "Concept Card" in text, "concept-card mode must use 'Concept Card' title"


# ---------------------------------------------------------------------------
# Test: /generate integration
# ---------------------------------------------------------------------------

class TestPdfGenerateIntegration:
    def test_generate_pdf_returns_200_with_pdf_file(self, cat) -> None:
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "pdf-integration-test-001",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["pdf"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, (
            f"Expected 200 for pdf format, got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        assert "files" in body
        pdf_files = [f for f in body["files"] if f["format"] == "pdf"]
        assert len(pdf_files) == 1, f"Expected 1 pdf file, got {pdf_files}"
        assert pdf_files[0]["filename"].endswith(".pdf")

    def test_health_lists_pdf_adapter(self) -> None:
        from app.main import app
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "pdf" in body["adapters"], (
            f"pdf not in health adapters: {body['adapters']}"
        )
