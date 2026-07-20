"""Phase 0.4 integration slice — herocard + rfa across representative WiLLstudio configs.

Scope
-----
Covers determinism + labeling for the two NEW Phase 0.4 formats (herocard, rfa) across
~4 representative WiLLstudio configs that vary fixture/arm/pole/finish.

The full 561-combo STEP/DXF/IFC matrix is NOT required here: herocard and rfa don't
touch those geometry paths (build123d/ezdxf/ifcopenshell) — they go through
herocard_adapter.py (fpdf2) and rfa_adapter.py (mock APS JSON), respectively.

For each config + format we assert:
  (a) the file is produced
  (b) it carries DISCLAIMER + config ID (or configHash)
  (c) generating twice is byte-identical
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import DISCLAIMER, base_name, config_hash

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Four representative WiLLstudio configs (vary fixture / arm / pole / finish)
# ---------------------------------------------------------------------------

REPRESENTATIVE_CONFIGS = [
    PoleConfig(
        configId="p04-integ-config-A",
        brand="WiLLstudio",
        pole="alum-pole-20",
        baseCover="bc-fluted",
        arm="sh1-shepherds-hook",
        fixture="gvx-pendant",
        finish="matte-black",
        rev=1,
    ),
    PoleConfig(
        configId="p04-integ-config-B",
        brand="WiLLstudio",
        pole="alum-pole-16",
        baseCover="bc-round",
        arm="pa1-pendant-arm",
        fixture="gvx-pendant",
        finish="statuary-bronze",
        rev=1,
    ),
    PoleConfig(
        configId="p04-integ-config-C",
        brand="WiLLstudio",
        pole="alum-pole-14",
        baseCover="bc-fluted",
        arm="upsweep",
        fixture="mvx-coach",
        finish="forest-green",
        rev=1,
    ),
    PoleConfig(
        configId="p04-integ-config-D",
        brand="WiLLstudio",
        pole="alum-pole-12",
        baseCover="bc-round",
        arm="direct-mount",
        fixture="drx-post-top",
        finish="gloss-white",
        rev=1,
    ),
]


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


def _make_ctx(cat: dict, cfg: PoleConfig, out_dir: Path):
    """Build a GenContext for adapter.generate() calls."""
    from app.adapters.base import GenContext

    asm = build_assembly(cat, cfg)
    finish_map = {f["id"]: f for f in cat.get("finishes", [])}
    finish_obj = finish_map.get(cfg.finish, {})
    finish_name = finish_obj.get("name", cfg.finish)
    finish_ral = finish_obj.get("ral", "")

    part_map = {p["id"]: p for p in cat.get("parts", [])}
    parts_list = []
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
        render_png=None,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Helper: resolve a config against the catalog; fail loudly on any missing ID
# ---------------------------------------------------------------------------

def _resolve_config(cat: dict, cfg: PoleConfig) -> PoleConfig:
    """Return cfg after asserting all its part/finish IDs exist in the catalog.

    A bad ID is a test-authoring mistake — fail loudly instead of silently
    skipping so that typos are caught immediately.
    """
    part_ids = {p["id"] for p in cat.get("parts", [])}
    for slot in ("pole", "baseCover", "arm", "fixture"):
        part_id = getattr(cfg, slot)
        if part_id not in part_ids:
            pytest.fail(
                f"Config {cfg.configId!r}: part ID {part_id!r} (slot={slot!r}) "
                f"not found in catalog — fix the test config, not the catalog."
            )
    finish_ids = {f["id"] for f in cat.get("finishes", [])}
    if cfg.finish not in finish_ids:
        pytest.fail(
            f"Config {cfg.configId!r}: finish ID {cfg.finish!r} "
            f"not found in catalog — fix the test config, not the catalog."
        )
    return cfg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestP04HeroCardSlice:
    """Herocard format: file produced + DISCLAIMER + configId + determinism."""

    @pytest.mark.parametrize("cfg_template", REPRESENTATIVE_CONFIGS, ids=lambda c: c.configId)
    def test_herocard_produced_with_label(self, cat, tmp_path_factory, cfg_template):
        """(a+b) herocard file produced; contains DISCLAIMER and configId."""
        from app.adapters.herocard_adapter import HeroCardAdapter
        from pypdf import PdfReader

        cfg = _resolve_config(cat, cfg_template)
        out_dir = tmp_path_factory.mktemp(f"herocard_{cfg.configId}")
        ctx = _make_ctx(cat, cfg, out_dir)
        adapter = HeroCardAdapter()
        paths = adapter.generate(ctx)

        assert len(paths) == 1, f"Expected 1 herocard output, got {len(paths)}"
        path = paths[0]

        # (a) file produced
        assert path.exists(), "herocard file not written to disk"
        assert path.name.endswith("-hero.pdf"), f"Expected -hero.pdf suffix, got {path.name!r}"

        # (b) DISCLAIMER + configId in PDF text
        pdf_bytes = path.read_bytes()
        assert pdf_bytes[:4] == b"%PDF", "herocard must start with %PDF"

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "".join(page.extract_text() or "" for page in reader.pages)
        assert DISCLAIMER[:40] in text, f"DISCLAIMER not found in herocard for {cfg.configId}"
        assert cfg.configId in text, f"configId {cfg.configId!r} not found in herocard"

    @pytest.mark.parametrize("cfg_template", REPRESENTATIVE_CONFIGS[:2], ids=lambda c: c.configId)
    def test_herocard_determinism(self, cat, tmp_path_factory, cfg_template):
        """(c) Two herocard runs with identical inputs produce byte-identical output."""
        from app.adapters.herocard_adapter import HeroCardAdapter

        cfg = _resolve_config(cat, cfg_template)
        out1 = tmp_path_factory.mktemp(f"hc_det1_{cfg.configId}")
        out2 = tmp_path_factory.mktemp(f"hc_det2_{cfg.configId}")
        ctx1 = _make_ctx(cat, cfg, out1)
        ctx2 = _make_ctx(cat, cfg, out2)

        adapter = HeroCardAdapter()
        b1 = adapter.generate(ctx1)[0].read_bytes()
        b2 = adapter.generate(ctx2)[0].read_bytes()

        assert b1 == b2, (
            f"herocard determinism failed for {cfg.configId}: "
            f"byte lengths {len(b1)} vs {len(b2)}"
        )


class TestP04RfaSlice:
    """RFA format: file produced + DISCLAIMER + configId/hash + determinism."""

    @pytest.mark.parametrize("cfg_template", REPRESENTATIVE_CONFIGS, ids=lambda c: c.configId)
    def test_rfa_produced_with_label(self, cat, tmp_path_factory, cfg_template, monkeypatch):
        """(a+b) .rfa file produced; contains DISCLAIMER, configId, and configHash."""
        from app.adapters.rfa_adapter import RfaAdapter

        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)

        cfg = _resolve_config(cat, cfg_template)
        out_dir = tmp_path_factory.mktemp(f"rfa_{cfg.configId}")
        ctx = _make_ctx(cat, cfg, out_dir)
        adapter = RfaAdapter()
        paths = adapter.generate(ctx)

        assert len(paths) == 1, f"Expected 1 .rfa output, got {len(paths)}"
        path = paths[0]

        # (a) file produced
        assert path.exists(), ".rfa file not written to disk"
        assert path.name.endswith(".rfa"), f"Expected .rfa suffix, got {path.name!r}"

        # (b) parse mock payload
        text = path.read_bytes().decode("ascii")
        lines = text.split("\n", 1)
        assert lines[0] == "WiLL-RFA-MOCK v1", f"Unexpected header: {lines[0]!r}"
        manifest = json.loads(lines[1])

        # DISCLAIMER
        assert manifest.get("disclaimer") == DISCLAIMER, "DISCLAIMER missing from rfa manifest"
        # configId encoded in family_name
        assert cfg.configId in manifest["params"]["family_name"], (
            f"configId {cfg.configId!r} not in rfa family_name"
        )
        # configHash
        assert manifest.get("configHash") == config_hash(cfg), (
            f"configHash mismatch for {cfg.configId}"
        )
        # mock note
        assert "mock" in manifest.get("note", "").lower(), "mock note missing from rfa"

    @pytest.mark.parametrize("cfg_template", REPRESENTATIVE_CONFIGS[:2], ids=lambda c: c.configId)
    def test_rfa_determinism(self, cat, tmp_path_factory, cfg_template, monkeypatch):
        """(c) Two .rfa runs with identical inputs produce byte-identical output."""
        from app.adapters.rfa_adapter import RfaAdapter

        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)

        cfg = _resolve_config(cat, cfg_template)
        asm = build_assembly(cat, cfg)
        from app.adapters.base import GenContext

        def _ctx(out_dir):
            return GenContext(
                catalog=cat,
                cfg=cfg,
                out_dir=out_dir,
                base_name=base_name(cat, cfg),
                assembly=asm,
                render_png=None,
                summary={},
            )

        out1 = tmp_path_factory.mktemp(f"rfa_det1_{cfg.configId}")
        out2 = tmp_path_factory.mktemp(f"rfa_det2_{cfg.configId}")
        adapter = RfaAdapter()
        b1 = adapter.generate(_ctx(out1))[0].read_bytes()
        b2 = adapter.generate(_ctx(out2))[0].read_bytes()

        assert b1 == b2, (
            f"rfa determinism failed for {cfg.configId}: "
            f"byte lengths {len(b1)} vs {len(b2)}"
        )


class TestP04BothFormatsViaAPI:
    """Integration: POST /generate with herocard + rfa returns both files + mock warning."""

    def test_both_formats_returned(self, monkeypatch):
        """herocard and rfa both appear in response.files; mock APS warning present."""
        monkeypatch.delenv("APS_CLIENT_ID", raising=False)
        monkeypatch.delenv("APS_CLIENT_SECRET", raising=False)

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        resp = client.post(
            "/generate",
            json={
                "config": {
                    "configId": "p04-both-formats-test-001",
                    "brand": "WiLLstudio",
                    "pole": "alum-pole-20",
                    "baseCover": "bc-fluted",
                    "arm": "sh1-shepherds-hook",
                    "fixture": "gvx-pendant",
                    "finish": "matte-black",
                    "rev": 1,
                },
                "formats": ["herocard", "rfa"],
                "renderPng": None,
            },
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()

        formats_returned = {f["format"] for f in body["files"]}
        assert "herocard" in formats_returned, f"herocard missing from files: {body['files']}"
        assert "rfa" in formats_returned, f"rfa missing from files: {body['files']}"
        assert len(body["files"]) == 2, f"Expected exactly 2 files, got {body['files']}"

        # mock APS warning
        warnings_lower = [w.lower() for w in body.get("warnings", [])]
        assert any("mock" in w for w in warnings_lower), (
            f"Expected mock APS warning in warnings, got: {body['warnings']}"
        )
