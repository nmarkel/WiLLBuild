# WiLL Geometry Service

FastAPI service that generates CAD/geometry files from a WiLL pole configurator `PoleConfig`.

## Python version

Venv uses **Python 3.13** (`/opt/homebrew/bin/python3.13`).
All required wheels — including `build123d` and `ifcopenshell` — resolved successfully on 3.13 (no fallback to 3.12 was needed).

## Setup

```sh
cd geometry-service
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run instructions

```sh
# Development server (auto-reload on file change)
./run.sh
# or directly:
.venv/bin/uvicorn app.main:app --port 8000 --reload

# Production-style (single worker, no reload)
.venv/bin/uvicorn app.main:app --port 8000
```

Service listens on `http://localhost:8000`. CORS is open to `http://localhost:5173` and `http://localhost:5174`.

## Test

```sh
# Default (fast) suite — 140 tests, ~90 s, slow matrix excluded:
.venv/bin/pytest tests/ -q

# Full matrix suite — 192 tests, every valid combo x [step, dxf, ifc, pdf]:
.venv/bin/pytest tests/test_matrix.py -q -m slow

# Single file:
.venv/bin/pytest tests/test_bundle.py -q
```

The `@pytest.mark.slow` marker is registered in `pyproject.toml`, and `addopts = "-m 'not slow'"` keeps the default run fast. Run the matrix explicitly with `-m slow`.

## HTTP API Contract

```
POST /generate
  body:
    {
      "config": PoleConfig,          # see PoleConfig schema below
      "formats": ["step"|"dxf"|"ifc"|"pdf"|"bundle"|"dwg"],
      "renderPng": "<base64-png>" | null
    }
  200:
    {
      "configHash": "<8-hex-chars>",
      "files": [{ "format": "...", "filename": "...", "url": "/files/<name>", "sizeBytes": 123 }],
      "warnings": ["..."]            # non-fatal adapter issues
    }
  422: { "detail": "<string>" }     # invalid config or unknown format adapter

GET /files/{filename}
  Returns the generated file from geometry-service/out/.
  Rejects path-traversal (any filename containing / or ..).

GET /health
  { "status": "ok", "adapters": { "step": true, "dxf": true, ... } }
```

### PoleConfig schema

```json
{
  "configId": "uuid-or-string",
  "pole": "alum-pole-20",
  "baseCover": "bc-fluted",
  "arm": "sh1-shepherds-hook",
  "fixture": "gvx-pendant",
  "finish": "matte-black",
  "rev": 1
}
```

All field values must match IDs in `public/catalog.json`. Socket compatibility is validated server-side (same rules as the frontend `canHost` logic).

## Supported formats

| Format   | Adapter          | Notes                                                                 |
|----------|-----------------|-----------------------------------------------------------------------|
| `step`   | StepAdapter     | build123d solid → STEP AP214; FILE_DESCRIPTION carries configId + DISCLAIMER |
| `dxf`    | DxfAdapter (default) / DxfProjectionAdapter | Route selected by `DXF_ROUTE` env var (see below) |
| `ifc`    | IfcAdapter      | IFC 2x3 with WiLL property set; requires ifcopenshell                 |
| `pdf`    | PdfAdapter      | A4 landscape spec-sheet via fpdf2; byte-deterministic                 |
| `bundle` | BundleAdapter   | ZIP containing step + pdf + [render.png] + config.json + summary.txt + README.txt |
| `dwg`    | DwgAdapter      | Requires ODA File Converter (see below); not available in CI          |

### Bundle format

`bundle` produces `<base_name>_bundle.zip` with a fixed entry order and `ZipInfo.date_time=(1980,1,1,0,0,0)` on every entry — byte-identical across runs with identical input. The bundled STEP bytes have the `FILE_NAME` timestamp replaced with a fixed stub for determinism; the on-disk `.step` file keeps its authentic timestamp.

### DWG — needs ODA File Converter

`dwg` is only registered when ODA File Converter is present at one of:
- `ODAFileConverter` on `PATH`
- `/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter` (macOS bundle)

When absent, the adapter is not registered and requesting `"formats": ["dwg"]` demotes to a warning (the DXF output is still produced). The warning text is: `"DWG skipped: ODA File Converter not installed"`.

## Environment flags

| Variable      | Default   | Effect                                                          |
|---------------|-----------|-----------------------------------------------------------------|
| `CATALOG_PATH`| `../public/catalog.json` (relative to service root) | Path to the catalog JSON |
| `DXF_ROUTE`   | `direct`  | `direct` → Route 1 (catalog placeholder silhouettes); `projection` → Route 2 (build123d solid projection) |

Changing `DXF_ROUTE` touches zero files outside `app/adapters/` (+ `app/titleblock.py`).

## Architecture and adapter boundary rules

```
app/models.py       — Pydantic models (PoleConfig, GenerateRequest, GenerateResponse)
app/catalog.py      — load_catalog() [lru_cache], part(), validate_config()
app/naming.py       — config_hash(), base_name(), DISCLAIMER
app/main.py         — FastAPI routes; dispatches to REGISTRY per format
app/adapters/
  __init__.py       — REGISTRY (the only place engines meet the app)
  base.py           — Adapter protocol, GenContext dataclass
  step_adapter.py   — StepAdapter
  dxf_adapter.py    — DxfAdapter (direct route)
  dxf_projection_adapter.py — DxfProjectionAdapter (projection route)
  dwg_adapter.py    — DwgAdapter (ODA wrapper)
  ifc_adapter.py    — IfcAdapter
  pdf_adapter.py    — PdfAdapter
  bundle_adapter.py — BundleAdapter
app/kit/            — build_assembly(), BuiltAssembly, AssemblyDims
app/spec_template.py — render_spec() PDF template
app/titleblock.py   — shared DXF titleblock helper
```

**Adapter boundary rules:**

1. `main.py` imports only `REGISTRY` from `app.adapters` — it never imports individual adapter modules directly.
2. All catalog knowledge lives in `public/catalog.json`. Adapters read from `GenContext.catalog`; they never hardcode part IDs or dimensions.
3. Geometry is built **once per request** in `main.py` (`build_assembly`), stored in `ctx.assembly`, and shared across all adapters via `GenContext`.
4. Adapters that need a peer adapter's output (e.g. DWG needs DXF, bundle needs STEP + PDF) check for the on-disk file first (`ctx.out_dir / f"{ctx.base_name}.ext"`), then call `REGISTRY[peer].generate(ctx)` only if missing. This avoids double computation when multiple formats are requested together.
5. `GenContext.summary` carries human-readable metadata (parts list, finish name, dims in mm). Adapters may read it but should not overwrite keys set by `main.py` — they may add new keys (e.g. `pdf_adapter` adds `finish_ral`).

## PDF spec-sheet

Generated by `app/spec_template.py` via fpdf2 2.8.7.

- One-page A4 landscape: gunmetal header, components table, dimensions block, finish block, render image or placeholder, footer with DISCLAIMER + configId + quote URL.
- **Font note**: Helvetica (fpdf2 built-in core font) is used as a stand-in for Roboto. Helvetica only supports latin-1 (U+0000–U+00FF). All strings passed to the PDF renderer are sanitised by `_latin1()` in `spec_template.py` — common Unicode punctuation (em dashes, curly quotes, ellipsis, etc.) is transliterated to ASCII equivalents; anything remaining outside latin-1 is replaced with `?`. A TTF Roboto embed is a Phase 1 improvement.
- **Determinism**: `set_creation_date(datetime(2000,1,1,tzinfo=timezone.utc))`, `set_producer("WiLL Geometry Service")`, `set_creator("WiLL Geometry Service")` pin all variable metadata so two runs with identical input produce byte-identical output.

## Matrix test results

Run: 48 valid combos × 4 formats (step, dxf, ifc, pdf) = **192 tests, all passed**.

```
Wall time:  ~2 min 27 s
Worst single-format time: 2.29 s (IFC, mvx-coach+upsweep+alum-pole-12+bc-fluted)
All combos well within the 60 s per-test limit.
```

To run the matrix:
```sh
.venv/bin/pytest tests/test_matrix.py -q -m slow
# With pytest durations:
.venv/bin/pytest tests/test_matrix.py -m slow --durations=20
```

## Disclaimer

All generated files carry:

> *"Concept starter model - not final engineered or manufacturing-released design"*

## Deliberate non-goals

The following are explicitly **out of scope** for this service:

- **Photometrics** — no IES generation, no luminaire photometric data, no lux calculations. Night-mode in the configurator frontend is a conceptual visual preview only.
- **Manufacturing geometry** — STEP/DXF outputs are concept-quality models for visualisation and quoting. They are not stamped for fabrication or structural analysis.
- **EPA / structural validation** — no wind-load or exposed projected area computation.
- **Pricing** — no cost calculations or BoM generation.
- **User accounts / auth** — stateless service; no session management.
- **CMS / Shopify integration** — no e-commerce hooks.
