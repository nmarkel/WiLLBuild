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

## Run

```sh
./run.sh
# or
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

Service listens on http://localhost:8000. CORS is open to `http://localhost:5173` and `http://localhost:5174`.

## Test

```sh
.venv/bin/pytest
```

## HTTP Contract

```
POST /generate
  body: { config: PoleConfig, formats: [...], renderPng: base64|null }
  200: { configHash, files: [{format, filename, url, sizeBytes}], warnings: [] }
  422: { "detail": "..." }  — invalid config or no adapter for requested format

GET /files/{filename}
  FileResponse from geometry-service/out/ (path traversal rejected)

GET /health
  { "status": "ok", "adapters": { ... } }
```

## Architecture

- `app/models.py` — Pydantic models (`PoleConfig`, `GenerateRequest`, `GenerateResponse`)
- `app/catalog.py` — `load_catalog()`, `part()`, `validate_config()` (socket-compat mirrors frontend `canHost`)
- `app/naming.py` — `config_hash()` (SHA-256 over canonical JSON of geometry fields, first 8 hex chars), `base_name()`
- `app/main.py` — FastAPI routes; adapter registry for format handlers (empty in this skeleton)

## PDF spec-sheet / concept card

The `pdf` format adapter generates a branded one-page PDF using **fpdf2 2.8.7**.

- Template: `app/spec_template.py` — `render_spec(ctx, mode='spec'|'concept-card')`
- Adapter: `app/adapters/pdf_adapter.py` — writes `<base_name>.pdf` to `out/`
- **Font**: Helvetica (fpdf2 built-in core font) is used as a stand-in for Roboto.
  Helvetica covers latin-1; special characters (e.g. em-dashes) must be avoided
  in all string literals passed to the PDF renderer.  A TTF Roboto embed is a
  Phase 1 improvement.
- **Determinism**: `set_creation_date(datetime(2000,1,1,tzinfo=timezone.utc))`,
  `set_producer("WiLL Geometry Service")`, and `set_creator("WiLL Geometry Service")`
  are pinned so two runs with identical input produce byte-identical output.

## Disclaimer

Generated files carry: *"Concept starter model - not final engineered or manufacturing-released design"*
