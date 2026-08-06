"""Tests for the bundle adapter — Task 7 (Phase 0.3).

TDD order: tests written before implementation.  Run these first to confirm
they all fail, then implement app/adapters/bundle_adapter.py.

Bundle zip contains:
  <base_name>.step   — STEP solid (via REGISTRY["step"])
  render.png         — render image (only when ctx.render_png is not None)
  config.json        — exact PoleConfig as sent, canonical JSON
  summary.txt        — human-readable parts + finish + dims
  README.txt         — DISCLAIMER + configId + rev + quote URL
  <base_name>.pdf    — PDF spec-sheet (via REGISTRY["pdf"])

Determinism: every ZipInfo date_time=(1980,1,1,0,0,0), fixed entry order,
ZIP_DEFLATED → two runs produce byte-identical archives.
"""

from __future__ import annotations

import json
import uuid
import zipfile
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

def _default_cfg(cat: dict, config_id: str | None = None) -> PoleConfig:
    return PoleConfig(
        configId=config_id or str(uuid.uuid4()),
        pole="alum-pole-20",
        baseCover=first_base_cover_for(cat, "alum-pole-20"),
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    )


# Tiny valid 1×1 transparent PNG (bytes)
_TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082"
)


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="module")
def default_cfg(cat) -> PoleConfig:
    return _default_cfg(cat, "bundle-test-abc12345")


@pytest.fixture(scope="module")
def built_assembly(cat, default_cfg):
    return build_assembly(cat, default_cfg)


# ---------------------------------------------------------------------------
# Import the adapter under test — fails until implementation exists
# ---------------------------------------------------------------------------

from app.adapters.bundle_adapter import BundleAdapter  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to build GenContext
# ---------------------------------------------------------------------------

def _make_ctx(tmp_path: Path, cat: dict, cfg: PoleConfig, assembly, render_png=None, summary=None):
    from app.adapters.base import GenContext
    _summary = summary if summary is not None else {
        "parts": [
            {"slot": "fixture", "id": cfg.fixture, "name": "GVX Pendant", "productUrl": ""},
            {"slot": "arm", "id": cfg.arm, "name": "Shepherds Hook", "productUrl": ""},
            {"slot": "pole", "id": cfg.pole, "name": "Alum Pole 20ft", "productUrl": ""},
            {"slot": "baseCover", "id": cfg.baseCover, "name": "Small Clamshell Cast Base Cover", "productUrl": ""},
        ],
        "finish": "Matte Black",
        "finish_ral": "RAL 9005",
        "dims": {
            "overall_height_mm": 6200.0,
            "pole_height_mm": 6096.0,
            "mounting_height_mm": 6000.0,
            "arm_reach_mm": 610.0,
            "base_diameter_mm": 152.0,
        },
    }
    return GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=tmp_path,
        base_name=base_name(cat, cfg),
        assembly=assembly,
        render_png=render_png,
        summary=_summary,
    )


# ---------------------------------------------------------------------------
# Test: bundle adapter basic properties
# ---------------------------------------------------------------------------

class TestBundleAdapterBasics:
    def test_format_is_bundle(self):
        """BundleAdapter.format must be 'bundle'."""
        assert BundleAdapter().format == "bundle"

    def test_available_returns_true(self):
        """BundleAdapter is always available (only stdlib + already-registered adapters needed)."""
        assert BundleAdapter().available() is True

    def test_in_registry(self):
        """REGISTRY must contain a 'bundle' key after importing adapters."""
        from app.adapters import REGISTRY
        assert "bundle" in REGISTRY


# ---------------------------------------------------------------------------
# Test: generate returns a single zip path
# ---------------------------------------------------------------------------

class TestBundleGenerateReturnsPath:
    def test_generate_returns_one_path(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert len(paths) == 1

    def test_generate_path_has_zip_extension(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert paths[0].suffix == ".zip"

    def test_generate_path_ends_with_bundle(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert paths[0].name.endswith("_bundle.zip")

    def test_generate_zip_filename_matches_base_name(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        bn = base_name(cat, default_cfg)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert paths[0].name == f"{bn}_bundle.zip"

    def test_generated_file_exists(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert paths[0].exists()

    def test_generated_file_is_valid_zip(self, tmp_path, cat, default_cfg, built_assembly):
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        assert zipfile.is_zipfile(paths[0])


# ---------------------------------------------------------------------------
# Test: zip contents (without render_png)
# ---------------------------------------------------------------------------

class TestBundleContentsNoRender:
    @pytest.fixture(scope="class")
    @classmethod
    def bundle_path(cls, tmp_path_factory, cat, default_cfg, built_assembly):
        out = tmp_path_factory.mktemp("bundle_no_render")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly, render_png=None)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        return paths[0]

    def test_contains_step_file(self, bundle_path, cat, default_cfg):
        bn = base_name(cat, default_cfg)
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert f"{bn}.step" in names

    def test_contains_pdf_file(self, bundle_path, cat, default_cfg):
        bn = base_name(cat, default_cfg)
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert f"{bn}.pdf" in names

    def test_contains_config_json(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert "config.json" in names

    def test_contains_summary_txt(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert "summary.txt" in names

    def test_contains_readme_txt(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert "README.txt" in names

    def test_does_not_contain_render_png_when_none(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert "render.png" not in names

    def test_exact_entry_count_without_render(self, bundle_path, cat, default_cfg):
        """Without render_png: step + pdf + config.json + summary.txt + README.txt = 5 entries."""
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert len(names) == 5, f"Expected 5 entries, got {len(names)}: {names}"


# ---------------------------------------------------------------------------
# Test: zip contents (with render_png)
# ---------------------------------------------------------------------------

class TestBundleContentsWithRender:
    @pytest.fixture(scope="class")
    @classmethod
    def bundle_path(cls, tmp_path_factory, cat, default_cfg, built_assembly):
        out = tmp_path_factory.mktemp("bundle_with_render")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly, render_png=_TINY_PNG)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        return paths[0]

    def test_contains_render_png_when_provided(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert "render.png" in names

    def test_render_png_bytes_match(self, bundle_path):
        with zipfile.ZipFile(bundle_path) as zf:
            data = zf.read("render.png")
        assert data == _TINY_PNG

    def test_exact_entry_count_with_render(self, bundle_path, cat, default_cfg):
        """With render_png: step + pdf + render.png + config.json + summary.txt + README.txt = 6 entries."""
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
        assert len(names) == 6, f"Expected 6 entries, got {len(names)}: {names}"


# ---------------------------------------------------------------------------
# Test: config.json round-trips to sent config
# ---------------------------------------------------------------------------

class TestBundleConfigJson:
    @pytest.fixture(scope="class")
    @classmethod
    def config_json_data(cls, tmp_path_factory, cat, default_cfg, built_assembly):
        out = tmp_path_factory.mktemp("bundle_cfg_json")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        with zipfile.ZipFile(paths[0]) as zf:
            return json.loads(zf.read("config.json"))

    def test_config_json_has_config_id(self, config_json_data, default_cfg):
        assert config_json_data["configId"] == default_cfg.configId

    def test_config_json_has_pole(self, config_json_data, default_cfg):
        assert config_json_data["pole"] == default_cfg.pole

    def test_config_json_has_fixture(self, config_json_data, default_cfg):
        assert config_json_data["fixture"] == default_cfg.fixture

    def test_config_json_has_arm(self, config_json_data, default_cfg):
        assert config_json_data["arm"] == default_cfg.arm

    def test_config_json_has_base_cover(self, config_json_data, default_cfg):
        assert config_json_data["baseCover"] == default_cfg.baseCover

    def test_config_json_has_finish(self, config_json_data, default_cfg):
        assert config_json_data["finish"] == default_cfg.finish

    def test_config_json_has_rev(self, config_json_data, default_cfg):
        assert config_json_data["rev"] == default_cfg.rev

    def test_config_json_round_trips_to_model(self, config_json_data):
        """JSON in the zip must deserialise back to a valid PoleConfig."""
        cfg = PoleConfig(**config_json_data)
        assert isinstance(cfg, PoleConfig)

    def test_config_json_is_valid_json(self, tmp_path, cat, default_cfg, built_assembly):
        """config.json must be valid JSON (not corrupt)."""
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        with zipfile.ZipFile(paths[0]) as zf:
            raw = zf.read("config.json")
        parsed = json.loads(raw)
        assert isinstance(parsed, dict)


# ---------------------------------------------------------------------------
# Test: README.txt contains DISCLAIMER and key metadata
# ---------------------------------------------------------------------------

class TestBundleReadme:
    @pytest.fixture(scope="class")
    @classmethod
    def readme_text(cls, tmp_path_factory, cat, default_cfg, built_assembly):
        out = tmp_path_factory.mktemp("bundle_readme")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        with zipfile.ZipFile(paths[0]) as zf:
            return zf.read("README.txt").decode("utf-8")

    def test_readme_contains_disclaimer(self, readme_text):
        assert DISCLAIMER in readme_text

    def test_readme_contains_config_id(self, readme_text, default_cfg):
        assert default_cfg.configId in readme_text

    def test_readme_contains_rev(self, readme_text, default_cfg):
        assert str(default_cfg.rev) in readme_text

    def test_readme_contains_quote_url(self, readme_text):
        assert "willbrands.com" in readme_text


# ---------------------------------------------------------------------------
# Test: summary.txt is human-readable
# ---------------------------------------------------------------------------

class TestBundleSummaryTxt:
    @pytest.fixture(scope="class")
    @classmethod
    def summary_text(cls, tmp_path_factory, cat, default_cfg, built_assembly):
        out = tmp_path_factory.mktemp("bundle_summary")
        ctx = _make_ctx(out, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        with zipfile.ZipFile(paths[0]) as zf:
            return zf.read("summary.txt").decode("utf-8")

    def test_summary_contains_finish(self, summary_text):
        """summary.txt must mention the finish."""
        assert "Matte Black" in summary_text or "matte" in summary_text.lower()

    def test_summary_contains_part_name(self, summary_text):
        """summary.txt must mention at least one part name."""
        # one of our fake part names from the fixture should appear
        assert any(name in summary_text for name in ["GVX", "Pendant", "Pole", "Hook", "Base"])

    def test_summary_not_empty(self, summary_text):
        assert len(summary_text.strip()) > 0


# ---------------------------------------------------------------------------
# Test: ZipInfo determinism — fixed date_time=(1980,1,1,0,0,0)
# ---------------------------------------------------------------------------

class TestBundleZipInfoDates:
    def test_all_entries_have_fixed_date_time(self, tmp_path, cat, default_cfg, built_assembly):
        """Every ZipInfo entry must have date_time=(1980,1,1,0,0,0) for determinism."""
        ctx = _make_ctx(tmp_path, cat, default_cfg, built_assembly)
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)
        with zipfile.ZipFile(paths[0]) as zf:
            for info in zf.infolist():
                assert info.date_time == (1980, 1, 1, 0, 0, 0), (
                    f"Entry {info.filename!r} has date_time {info.date_time} (expected 1980-01-01 00:00:00)"
                )


# ---------------------------------------------------------------------------
# Test: full byte-level determinism across two runs
# ---------------------------------------------------------------------------

class TestBundleDeterminism:
    def test_two_runs_produce_identical_bytes(self, tmp_path_factory, cat, default_cfg, built_assembly):
        """Generate the bundle twice; byte-compare the zip files."""
        adapter = BundleAdapter()

        out1 = tmp_path_factory.mktemp("det_a")
        ctx1 = _make_ctx(out1, cat, default_cfg, built_assembly)
        paths1 = adapter.generate(ctx1)

        out2 = tmp_path_factory.mktemp("det_b")
        ctx2 = _make_ctx(out2, cat, default_cfg, built_assembly)
        paths2 = adapter.generate(ctx2)

        bytes1 = paths1[0].read_bytes()
        bytes2 = paths2[0].read_bytes()
        assert bytes1 == bytes2, (
            f"Bundle is not byte-deterministic: "
            f"run1={len(bytes1)} bytes, run2={len(bytes2)} bytes"
        )


# ---------------------------------------------------------------------------
# Test: /generate integration — bundle format
# ---------------------------------------------------------------------------

class TestBundleIntegration:
    def test_generate_bundle_returns_200(self, cat):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "bundle-integ-test-1234",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["bundle"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200

    def test_generate_bundle_files_list_has_zip(self, cat):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "bundle-integ-test-5678",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["bundle"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        filenames = [f["filename"] for f in body["files"]]
        assert any(fn.endswith("_bundle.zip") for fn in filenames), (
            f"No bundle.zip in files list: {filenames}"
        )

    def test_generate_bundle_format_label_is_bundle(self, cat):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "bundle-integ-test-9999",
                    "pole": "alum-pole-20",
                    "baseCover": first_base_cover_for(cat, "alum-pole-20"),
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["bundle"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        formats = [f["format"] for f in body["files"]]
        assert "bundle" in formats

    def test_health_reports_bundle_adapter(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["adapters"].get("bundle") is True


# ---------------------------------------------------------------------------
# Test: bundle regenerates PDF when not produced in the same request
# ---------------------------------------------------------------------------

class TestBundlePerRequestArtifacts:
    """Verify the bundle does not embed stale on-disk PDFs from previous requests.

    If a PDF exists on disk from request A (with render_png=bytes_A), a
    subsequent bundle request B (with render_png=bytes_B) must embed a freshly
    generated PDF (reflecting bytes_B), NOT the stale on-disk bytes_A PDF.

    We verify this by:
      1. Pre-creating a PDF on disk using ctx_a (with a different render_png).
      2. Calling the bundle adapter with ctx_b (render_png=_TINY_PNG) and
         produced={} (empty — the PDF was NOT produced this request).
      3. Asserting the bundle uses a freshly generated PDF (different bytes
         from the pre-created one, since render_png differs).
    """

    def test_bundle_regenerates_pdf_when_not_produced_this_request(
        self, tmp_path, cat, default_cfg, built_assembly
    ):
        """Bundle must call the PDF adapter (not reuse disk file) when pdf not in ctx.produced.

        Verification: write a sentinel byte sequence at the start of the on-disk PDF
        before calling the bundle.  If the bundle reuses the disk file the embedded
        PDF will start with the sentinel; if it regenerates, the embedded PDF will
        start with %PDF (a valid PDF header), not the sentinel.
        """
        from app.adapters.base import GenContext

        bn = base_name(cat, default_cfg)
        pdf_path = tmp_path / f"{bn}.pdf"

        # --- Write a deliberately invalid "stale" PDF to disk with a sentinel header ---
        sentinel = b"STALE_SENTINEL_SHOULD_NOT_APPEAR_IN_BUNDLE"
        pdf_path.write_bytes(sentinel + b"\x00" * 100)

        summary = {
            "parts": [
                {"slot": "fixture", "id": default_cfg.fixture, "name": "GVX Pendant", "productUrl": ""},
                {"slot": "arm", "id": default_cfg.arm, "name": "Shepherds Hook", "productUrl": ""},
                {"slot": "pole", "id": default_cfg.pole, "name": "Alum Pole 20ft", "productUrl": ""},
                {"slot": "baseCover", "id": default_cfg.baseCover, "name": "Fluted Base Cover", "productUrl": ""},
            ],
            "finish": "Matte Black",
            "finish_ral": "RAL 9005",
            "dims": {
                "overall_height_mm": 6200.0,
                "pole_height_mm": 6096.0,
                "mounting_height_mm": 6000.0,
                "arm_reach_mm": 610.0,
                "base_diameter_mm": 152.0,
            },
        }

        # Generate bundle with produced={} — PDF was NOT produced this request.
        # The bundle adapter must regenerate the PDF (calling pdf_adapter.generate)
        # rather than reading the stale sentinel bytes from disk.
        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=bn,
            assembly=built_assembly,
            render_png=None,
            summary=summary,
            produced={},  # PDF not produced this request
        )
        adapter = BundleAdapter()
        paths = adapter.generate(ctx)

        # Extract the PDF from the bundle and verify it is a real PDF (not sentinel)
        with zipfile.ZipFile(paths[0]) as zf:
            bundled_pdf_bytes = zf.read(f"{bn}.pdf")

        assert not bundled_pdf_bytes.startswith(sentinel[:20]), (
            "Bundle embedded the stale sentinel bytes rather than regenerating the PDF. "
            "bundle_adapter must call the pdf adapter when 'pdf' is not in ctx.produced."
        )
        assert bundled_pdf_bytes[:4] == b"%PDF", (
            f"Bundled PDF does not start with %PDF magic: {bundled_pdf_bytes[:20]!r}"
        )

    def test_bundle_reuses_pdf_when_produced_this_request(
        self, tmp_path, cat, default_cfg, built_assembly
    ):
        """When the PDF was produced in THIS request (ctx.produced has it), reuse it."""
        from app.adapters.base import GenContext
        from app.adapters.pdf_adapter import PdfAdapter

        bn = base_name(cat, default_cfg)
        summary = {
            "parts": [],
            "finish": "Matte Black",
            "finish_ral": "",
            "dims": {
                "overall_height_mm": 6200.0,
                "pole_height_mm": 6096.0,
                "mounting_height_mm": 6000.0,
                "arm_reach_mm": 610.0,
                "base_diameter_mm": 152.0,
            },
        }

        ctx = GenContext(
            catalog=cat,
            cfg=default_cfg,
            out_dir=tmp_path,
            base_name=bn,
            assembly=built_assembly,
            render_png=None,
            summary=summary,
            produced={},
        )

        # Generate PDF first (simulating main.py dispatch before bundle)
        pdf_adapter = PdfAdapter()
        pdf_paths = pdf_adapter.generate(ctx)
        ctx.produced["pdf"] = pdf_paths

        pdf_mtime_before = pdf_paths[0].stat().st_mtime

        # Generate bundle — should reuse the already-produced PDF
        adapter = BundleAdapter()
        adapter.generate(ctx)

        # PDF on disk must NOT have been overwritten (mtime unchanged)
        pdf_mtime_after = pdf_paths[0].stat().st_mtime
        assert pdf_mtime_after == pdf_mtime_before, (
            "Bundle adapter regenerated the PDF even though it was already in ctx.produced"
        )
