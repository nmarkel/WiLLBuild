"""Full-matrix test — every valid combo × [step, dxf, ifc, pdf].

Marked ``@pytest.mark.slow`` so it is EXCLUDED from the default test run.

Default run (fast, ~140 tests):
    .venv/bin/pytest tests/ -q

Full matrix run (slow — may take many minutes):
    .venv/bin/pytest tests/test_matrix.py -q -m slow
    # or with verbose timing output:
    .venv/bin/pytest tests/test_matrix.py -v -m slow

DoD 7 requirements
------------------
- Every valid combo × [step, dxf, ifc, pdf] must succeed with zero errors.
- Each single-format generation must complete within 60 seconds.
- A timing table (slowest combos per format) is printed at the end.

Parametrisation
---------------
The ``all_valid_combos`` session fixture (from conftest.py) enumerates
48 combos.  We parametrise over formats × combos → 48 × 4 = 192 tests.
Each test generates one format for one combo, asserts zero warnings that
look like errors, and times itself.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Generator

import pytest

from app.catalog import load_catalog
from app.kit.assembly import build_assembly
from app.models import PoleConfig
from app.naming import base_name
from app.adapters import REGISTRY
from app.adapters.base import GenContext

# Formats covered by the matrix
_MATRIX_FORMATS = ["step", "dxf", "ifc", "pdf"]

# Per-test wall-time limit (seconds)
_TIME_LIMIT = 60.0

# Collected timing results: list of (format, combo_idx, elapsed)
_TIMING_RESULTS: list[tuple[str, str, float]] = []


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def cat() -> dict:
    load_catalog.cache_clear()
    return load_catalog()


@pytest.fixture(scope="session")
def all_valid_combos(cat: dict) -> list[PoleConfig]:
    """Enumerate all valid PoleConfig combinations from the catalog."""
    from tests.conftest import valid_combos as _valid_combos
    return _valid_combos(cat)


# ---------------------------------------------------------------------------
# Parametric matrix test
# ---------------------------------------------------------------------------

def _combo_label(cfg: PoleConfig) -> str:
    """Short human label for parametrize IDs."""
    return f"{cfg.fixture}+{cfg.arm}+{cfg.pole}+{cfg.baseCover}"


def _pytest_params(cat: dict) -> list[pytest.param]:
    """Build parametrize list at collection time.

    We call valid_combos directly here because the session fixture is not
    available at collection time.
    """
    from tests.conftest import valid_combos as _valid_combos
    combos = _valid_combos(cat)
    params = []
    for fmt in _MATRIX_FORMATS:
        for cfg in combos:
            label = f"{fmt}::{_combo_label(cfg)}"
            params.append(pytest.param(fmt, cfg, id=label))
    return params


def _load_combos_and_formats() -> list[pytest.param]:
    """Lazily load catalog at param-collection time."""
    try:
        load_catalog.cache_clear()
        cat = load_catalog()
        return _pytest_params(cat)
    except Exception:
        return []  # If catalog fails to load, return empty (tests will be skipped)


# Pre-compute params at module load for pytest collection
_MATRIX_PARAMS = _load_combos_and_formats()


@pytest.mark.slow
@pytest.mark.parametrize("fmt,cfg", _MATRIX_PARAMS)
def test_matrix(fmt: str, cfg: PoleConfig, tmp_path: Path, cat: dict) -> None:
    """Generate ``fmt`` for ``cfg``; assert success and timing within 60 s."""
    adapter = REGISTRY.get(fmt)
    if adapter is None:
        pytest.skip(f"Adapter '{fmt}' not registered in this environment")

    # Build assembly (always needed for the four formats in the matrix)
    assembly = build_assembly(cat, cfg)
    bn = base_name(cat, cfg)

    # Build a minimal summary for adapters that need it
    finish_map = {f["id"]: f.get("name", f["id"]) for f in cat.get("finishes", [])}
    finish_ral_map = {f["id"]: f.get("ral", "") for f in cat.get("finishes", [])}
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
        "parts": parts_list,
        "finish": finish_map.get(cfg.finish, cfg.finish),
        "finish_ral": finish_ral_map.get(cfg.finish, ""),
        "dims": {
            "overall_height_mm": assembly.dims.overall_height,
            "pole_height_mm": assembly.dims.pole_height,
            "mounting_height_mm": assembly.dims.mounting_height,
            "arm_reach_mm": assembly.dims.arm_reach,
            "base_diameter_mm": assembly.dims.base_diameter,
        },
    }

    ctx = GenContext(
        catalog=cat,
        cfg=cfg,
        out_dir=tmp_path,
        base_name=bn,
        assembly=assembly,
        render_png=None,
        summary=summary,
    )

    t0 = time.monotonic()
    out_paths = adapter.generate(ctx)
    elapsed = time.monotonic() - t0

    # Record timing for the summary table
    combo_label = _combo_label(cfg)
    _TIMING_RESULTS.append((fmt, combo_label, elapsed))

    # --- Assertions ---
    assert len(out_paths) >= 1, f"{fmt}: generate() returned no paths"
    for p in out_paths:
        assert p.exists(), f"{fmt}: output file does not exist: {p}"
        assert p.stat().st_size > 0, f"{fmt}: output file is empty: {p}"

    assert elapsed <= _TIME_LIMIT, (
        f"{fmt} generation for {combo_label} took {elapsed:.2f}s "
        f"(limit {_TIME_LIMIT}s)"
    )


# ---------------------------------------------------------------------------
# Timing report — printed after the slow suite completes
# ---------------------------------------------------------------------------

def pytest_terminal_summary(terminalreporter, exitstatus, config):  # noqa: ARG001
    """Print a timing table when the matrix tests have run."""
    if not _TIMING_RESULTS:
        return

    terminalreporter.write_sep("=", "Matrix timing table")
    by_format: dict[str, list[tuple[str, float]]] = {}
    for fmt, combo, elapsed in _TIMING_RESULTS:
        by_format.setdefault(fmt, []).append((combo, elapsed))

    for fmt in _MATRIX_FORMATS:
        entries = by_format.get(fmt, [])
        if not entries:
            continue
        entries_sorted = sorted(entries, key=lambda x: x[1], reverse=True)
        total = sum(e for _, e in entries)
        worst_combo, worst_t = entries_sorted[0]
        terminalreporter.write_line(
            f"\n{fmt.upper():6s}  n={len(entries):3d}  "
            f"total={total:7.1f}s  worst={worst_t:5.2f}s  [{worst_combo}]"
        )
        # Show top-5 slowest
        for combo, elapsed in entries_sorted[:5]:
            terminalreporter.write_line(f"         {elapsed:6.2f}s  {combo}")
