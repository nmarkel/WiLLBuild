"""Regression: _label_step_header must handle SolidWorks AP214 headers.

Phase 0.6 spike found that Cole's real SolidWorks STEP files emit a
FILE_DESCRIPTION unlike build123d/OpenCASCADE:

    FILE_DESCRIPTION (( 'STEP AP214' ),
        '1' );

versus the OCC form:

    FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');

The old regex (`^FILE_DESCRIPTION\\(.*?\\),'2;1'\\);`) matched 0 of 4 real
files, so labeling silently no-opped and the served STEP carried NO
disclaimer or config-ID — a labeling-compliance failure that only surfaced
on real geometry.

These tests pin the tolerant behaviour: the disclaimer + config-ID are
injected for BOTH header dialects, and the original implementation level is
preserved verbatim (never swapping '1' -> '2;1').
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.step_adapter import _label_step_header
from app.naming import DISCLAIMER

CONFIG_ID = "0.6-spike-gvx-assembly-0001"
REV = 1
EXPECTED_LABEL = f"WiLL concept model config {CONFIG_ID} rev {REV}"

# --- SolidWorks AP214 form: whitespace after keyword, level '1', multi-line ---
SOLIDWORKS_HEADER = (
    "ISO-10303-21;\n"
    "HEADER;\n"
    "FILE_DESCRIPTION (( 'STEP AP214' ),\n"
    "    '1' );\n"
    "FILE_NAME ('RSAA-4040-12.STEP',\n"
    "    '2026-07-22T14:35:00',( '' ),( '' ),\n"
    "    'SwSTEP 2.0','SolidWorks 2024','' );\n"
    "FILE_SCHEMA (( 'AUTOMOTIVE_DESIGN' ));\n"
    "ENDSEC;\n"
    "DATA;\n"
    "ENDSEC;\n"
    "END-ISO-10303-21;\n"
)

# --- OpenCASCADE / build123d form: no space, level '2;1', single line ---
OCC_HEADER = (
    "ISO-10303-21;\n"
    "HEADER;\n"
    "FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\n"
    "FILE_NAME('/tmp/x.step','2026-07-22T14:35:00',(''),(''),"
    "'Open CASCADE STEP processor 7.7','build123d','');\n"
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\n"
    "ENDSEC;\n"
    "DATA;\n"
    "ENDSEC;\n"
    "END-ISO-10303-21;\n"
)


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="ascii")
    return p


def test_solidworks_header_gets_labeled_and_preserves_level_1(tmp_path):
    """SolidWorks '1'-level, multi-line header: disclaimer + config-ID injected."""
    p = _write(tmp_path, "sw.step", SOLIDWORKS_HEADER)
    _label_step_header(p, CONFIG_ID, REV)
    out = p.read_text(encoding="ascii")

    assert DISCLAIMER in out, "SolidWorks header was NOT labeled (silent no-op regression)"
    assert EXPECTED_LABEL in out
    # Implementation level '1' must be preserved — never swapped to '2;1'.
    assert "'1');" in out
    assert "'2;1'" not in out
    # Original description string must be gone (replaced, not appended).
    assert "STEP AP214" not in out


def test_occ_header_still_labeled_and_preserves_level_2_1(tmp_path):
    """OpenCASCADE '2;1'-level header keeps working exactly as before."""
    p = _write(tmp_path, "occ.step", OCC_HEADER)
    _label_step_header(p, CONFIG_ID, REV)
    out = p.read_text(encoding="ascii")

    assert DISCLAIMER in out
    assert EXPECTED_LABEL in out
    # Implementation level '2;1' preserved.
    assert "'2;1');" in out
    assert "Open CASCADE Model" not in out


def test_label_replaces_only_file_description_line(tmp_path):
    """Rewrite touches FILE_DESCRIPTION only; FILE_NAME/FILE_SCHEMA intact."""
    p = _write(tmp_path, "sw.step", SOLIDWORKS_HEADER)
    _label_step_header(p, CONFIG_ID, REV)
    out = p.read_text(encoding="ascii")

    assert "FILE_NAME ('RSAA-4040-12.STEP'," in out
    assert "FILE_SCHEMA (( 'AUTOMOTIVE_DESIGN' ));" in out
    assert out.startswith("ISO-10303-21;")
