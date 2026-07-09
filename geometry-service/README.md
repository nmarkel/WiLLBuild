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

## Disclaimer

Generated files carry: *"Concept starter model - not final engineered or manufacturing-released design"*
