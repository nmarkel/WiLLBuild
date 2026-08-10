"""BREP disk cache — app/kit/real_import.py (Phase 0.10.5 review follow-up).

test_realgeom.py's ``cache_clear()`` calls only ever touch the in-process
``lru_cache`` on ``realgeom.load_real_solid`` — the on-disk ``.brep`` cache
inside ``import_real_shape`` (``_cache_path``/``_read_brep``/``_write_brep``)
had zero direct coverage before this file.  These tests exercise that path
for real: a genuine STEP master, copied into a tmp directory so the cache
lands there too (the module derives the cache path from the STEP path, with
no separate override), never mocked geometry.

Skipped everywhere the real WiLLstudio STEP drop is absent (gitignored, not
part of any deploy) — see test_realgeom.py's ``needs_cad`` for the same
pattern.
"""

from __future__ import annotations

import shutil

import pytest

from app import realgeom
from app.kit import real_import as ri

_POLE_ID = "alum-pole-12"
_STEP_SRC = realgeom.step_dir() / realgeom.BASE_FILES[_POLE_ID]
_HAS_CAD = _STEP_SRC.is_file()
needs_cad = pytest.mark.skipif(not _HAS_CAD, reason="real WiLLstudio CAD not present locally")


@needs_cad
def test_brep_cache_hit_returns_equivalent_geometry_without_reparsing_step(tmp_path, monkeypatch):
    """Second call for the same (part, mode, frame) hits the .brep cache.

    Proven two ways: (1) ``_read_step`` — the STEP parser — is spied on and
    must fire exactly once, on the first (cache-miss) call, never on the
    second; (2) the shape returned on the cache hit matches the freshly
    parsed shape's bounding box and volume, so the cache is not merely
    present but round-trips the correct geometry.
    """
    tmp_step = tmp_path / _STEP_SRC.name
    shutil.copy(_STEP_SRC, tmp_step)

    calls: list[str] = []
    orig_read_step = ri._read_step

    def spy(path):
        calls.append(str(path))
        return orig_read_step(path)

    monkeypatch.setattr(ri, "_read_step", spy)

    shape1 = ri.import_real_shape(str(tmp_step), mode="base", source_frame="y-up")
    assert shape1 is not None
    assert len(calls) == 1, "first call must be a cache miss (parses the STEP master)"

    cache_path = ri._cache_path(tmp_step, "base-y-up")
    assert cache_path.is_file(), "a .brep cache must be written next to the STEP copy"

    shape2 = ri.import_real_shape(str(tmp_step), mode="base", source_frame="y-up")
    assert shape2 is not None
    assert len(calls) == 1, "second call must be a cache HIT — the STEP master must not be reparsed"

    bb1, bb2 = shape1.bounding_box(), shape2.bounding_box()
    assert bb2.size.X == pytest.approx(bb1.size.X, abs=1e-6)
    assert bb2.size.Y == pytest.approx(bb1.size.Y, abs=1e-6)
    assert bb2.size.Z == pytest.approx(bb1.size.Z, abs=1e-6)
    assert shape2.volume == pytest.approx(shape1.volume, rel=1e-9)


@needs_cad
def test_corrupt_brep_cache_falls_back_to_the_step_master(tmp_path):
    """A cache file that fails to parse must degrade to the STEP master, not crash.

    ``_read_brep`` catches every read error, but this proves the *caller*
    (``import_real_shape``) actually takes the fallback branch and still
    returns valid, correctly-sized geometry — and that the corrupt cache is
    self-healed (overwritten with a real BREP) on the way out.
    """
    tmp_step = tmp_path / _STEP_SRC.name
    shutil.copy(_STEP_SRC, tmp_step)

    cache_path = ri._cache_path(tmp_step, "base-y-up")
    cache_path.write_bytes(b"this is not a valid OCCT BREP file\x00\x01\x02")
    assert ri._read_brep(cache_path) is None, "the garbage file must fail to parse as a precondition"

    shape = ri.import_real_shape(str(tmp_step), mode="base", source_frame="y-up")
    assert shape is not None, "a corrupt cache must fall back to the STEP master, not return None"

    # RSAA-4040-12 is a real 12 ft pole — same size assertion test_realgeom.py
    # uses for the REAL_GEOMETRY_IN_KIT path, proving this is genuine geometry,
    # not an empty/degenerate shape.
    bb = shape.bounding_box()
    assert bb.size.Z == pytest.approx(12 * 304.8, abs=2.0)
    assert shape.volume > 0

    # Self-healing: the corrupt cache was overwritten with a real BREP.
    assert ri._read_brep(cache_path) is not None
