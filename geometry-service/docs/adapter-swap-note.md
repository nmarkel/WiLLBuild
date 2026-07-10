# DXF Adapter Swap Note — DoD 8 Boundary Proof

## What Was Swapped

Two DXF route adapters exist for the WiLL geometry service, both producing
A3 landscape elevation drawings with identical dimension entities and the
WiLL title block:

| File | Route | Description |
|---|---|---|
| `app/adapters/dxf_adapter.py` | `direct` (default) | 2D silhouette from catalog placeholder data — no build123d import |
| `app/adapters/dxf_projection_adapter.py` | `projection` | build123d `project()` of the fused solid onto the CAD XZ plane |

Shared across both routes (read-only at swap time):

- `app/adapters/_titleblock.py` — A3 border (scaled ×50 to model-space mm), WiLL wordmark, config ID, date "—", finish, DISCLAIMER, 1:50 scale note (`app/titleblock.py` is a backwards-compat re-export shim)
- `app/adapters/dxf_adapter._draw_dimensions` — identical 5-dimension calls driven by `ctx.assembly.dims`

## The Env Flag

```
DXF_ROUTE=direct      # default — Route 1: catalog placeholder silhouettes
DXF_ROUTE=projection  # Route 2: build123d solid projection
```

The flag is read at registry-build time in `app/adapters/__init__.py`.
**Swapping the route touches ZERO files outside `app/adapters/`.**

## File Diff Between Routes

Only these files differ between a `direct` and a `projection` deployment:

```
app/adapters/__init__.py    (3 lines: which adapter class is imported)
```

The adapter files themselves are not modified — the registry simply imports
a different class.  All other files (`app/adapters/_titleblock.py`, `main.py`,
`base.py`, `naming.py`, every test file) are identical between routes.

The `app/adapters/` directory at the route boundary:

```
app/adapters/
  __init__.py                  ← only file that differs (env-gated import)
  _titleblock.py               ← shared title block (scaled ×50); ezdxf import lives here
  _spec_template.py            ← shared PDF template; fpdf import lives here
  base.py                      ← shared (Protocol + GenContext + produced tracking)
  dxf_adapter.py               ← Route 1 — loaded when DXF_ROUTE=direct
  dxf_projection_adapter.py    ← Route 2 — loaded when DXF_ROUTE=projection
  dwg_adapter.py               ← ODA wrapper (shared)
  step_adapter.py              ← unchanged
```

## Test Output — Identical Dims (DoD 8)

Config under test: `alum-pole-20 + bc-fluted + sh1-shepherds-hook + gvx-pendant + matte-black`

Assembly dims (mm):
```
overall_height  = 6906.4
pole_height     = 6100.0
mounting_height = 6220.0
arm_reach       =  657.6
base_diameter   =  380.0
```

Dimension measurements in DXF output (sorted, mm):

```
Route "direct":     [380.0, 657.6, 6100.0, 6220.0, 6906.4]
Route "projection": [380.0, 657.6, 6100.0, 6220.0, 6906.4]
Identical: True
```

Test `tests/test_dxf.py::TestDxfRouteParity::test_dimension_measurements_identical_across_routes`
**PASSED** — both routes produce the same sorted dimension measurement list
within 0.1 mm tolerance (actual delta: 0.0 mm).

## ODA File Converter

ODA File Converter is **not installed** on this machine.  `DwgAdapter.available()`
returns `False`.  When `"dwg"` is requested via `/generate`, the service returns
HTTP 200 with the DXF file and the warning:

    "DWG skipped: ODA File Converter not installed"

DWG generation is available on machines with ODA File Converter at
`/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter` or on PATH.
