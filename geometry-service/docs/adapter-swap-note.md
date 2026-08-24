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

## Phase 0.18 Update — The Shell Sheet Is Shared

Both routes now call `app/adapters/_drawing_sheet.try_shell_sheet(ctx)` FIRST.
When every core part has a gated shell, it returns the four-view C-size sheet
built from the shell assembly — the same geometry the STEP and IFC ship — and
the route flag has nothing left to select, because that sheet takes its line
work from the shells rather than from either route's silhouette.

Returning the new sheet on `direct` only would have shipped a *different
drawing* down each route, which is exactly what this note exists to rule out.
The flag still chooses between Route 1 and Route 2 for configs the shells do
not cover, where the legacy parametric elevations remain.

Dimensions on the shell sheet are real `DIMENSION` entities (they were plain
TEXT plus witness lines when the sheet first landed, which reads correctly and
measures nothing). The views are drawn reduced 1:N in inches, so `DIMLFAC`
carries the sheet scale on dimension style `WILL-DIM`: measured paper distance
x DIMLFAC = true size, the ordinary convention for a scaled model-space
drawing. Code 42 (`actual_measurement`) therefore holds the PAPER distance.

Dimension measurements for `alum-pole-20 + CL2 + sh1-shepherds-hook +
gvx-pendant + matte-black`, both routes, in mm:

```
Route "direct":     [479.3, 479.4, 938.8, 938.8, 6946.0]
Route "projection": [479.3, 479.4, 938.8, 938.8, 6946.0]
Identical: True
```

Note the overall height reads **6946.0 mm** where the parametric
`dims.overall_height` is **6906.4 mm** — a 40 mm (0.6%) gap. That is the
shell-vs-placeholder difference, not a drawing error, and the shell is the more
accurate of the two. `tests/test_dxf.py` asserts the dimension against the
drawing's own geometry exactly and against the placeholder within 1%.

The shell sheet is also byte-reproducible, which the pre-0.18 DXF never was
($TDCREATE/$TDUPDATE, random GUIDs, a save-time ezdxf marker — see
`pin_document`). With that pinned, the two routes agree to the BYTE on a
shell-covered config, not merely on their dimension values:

```
sha256 direct     == sha256 projection      True
sha256 run 1      == sha256 run 2           True
```

## Phase 0.18 Update — Component Outlines Only

The sheet draws ONE outline per component (fixture, arm, pole, base cover) and
nothing inside it, with the components opaque: `project_outlines` unions each
component's projected triangles and subtracts the components in front of it
(`app/drawing.py`). Before that it drew silhouette + crease line work per mesh,
which put every internal feature of a casting on the sheet and, having no
hidden-line removal, drew parts through each other.

Measured on the config above: **30,180 LINE entities / 5.08 MB down to 2,655 /
517 KB**, with the envelope unmoved (`tests/test_drawing.py` asserts the
extents, that every segment sits on a component boundary, and that nothing is
drawn under a nearer component). The pole's base casting and hand hole are part
of the POLE outline rather than separate items.

Known limitation, asserted as such rather than papered over: components are
ordered as wholes by their nearest point, so two interpenetrating parts — an
arm whose tip sits inside the fixture's socket — sort as units. Per-face hidden
line removal needs B-rep solids (OCC HLRBRep).
