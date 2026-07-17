# Task 4 Report: Revit .rfa adapter with mock APS + real Design Automation scaffold

## Status
COMPLETE — all acceptance criteria met.

## TDD Evidence

### RED phase
```
ERROR collecting tests/test_rfa.py
ModuleNotFoundError: No module named 'app.adapters.rfa_adapter'
```
Tests failed to collect (import error) before any implementation existed — confirmed RED.

### GREEN phase
```
16 passed, 4 warnings in 4.55s
```
All 16 tests in `test_rfa.py` pass after implementation.

## Test Results

### Backend (geometry-service)
```
192 passed, 2244 deselected, 6 warnings in 372.65s (0:06:12)
```
Full suite: 192 passed, 0 failures. 2244 "deselected" are the matrix parametric tests filtered by default.

### Frontend
```
77 passed (77 tests, 6 files) — vitest run
```

### Build
```
tsc -b && vite build — ✓ built in 352ms (no TypeScript errors)
```

### Lint
```
oxlint — 0 errors (5 pre-existing warnings in scripts/merge-inventory.mjs, not new)
```

## Boundary Grep Result
```
grep -rn "import ezdxf|import fpdf|import ifcopenshell|from build123d|import httpx" \
  geometry-service/app --include="*.py" | grep -v "app/adapters/|app/kit/"
```
**EMPTY** — boundary rule holds. `import httpx` is inside `app/adapters/aps_client.py` only.

## Files Changed

### Created
- `geometry-service/app/adapters/aps_client.py` — `ApsClient` Protocol, `MockApsClient` (deterministic ASCII+JSON payload), `RealApsClient` (outlined OAuth→workitem→poll→download, import-safe, never called in tests), `get_aps_client()` selector returning `(client, is_mock)` tuple
- `geometry-service/app/adapters/rfa_adapter.py` — `RfaAdapter`, `format="rfa"`, `available()→True`, `generate()` builds params from assembly dims, dispatches to APS client, writes `.rfa`, appends mock warning to `ctx.warnings`
- `geometry-service/tests/test_rfa.py` — 16 tests covering: file produced/ends .rfa, content (configId/hash/DISCLAIMER/mock note), determinism (byte-identical), mock selected when no creds + warning emitted, RealApsClient selected when both env vars set, registry/health/API integration

### Modified
- `geometry-service/app/adapters/base.py` — added `warnings: list[str] = field(default_factory=list)` to `GenContext`
- `geometry-service/app/adapters/__init__.py` — imported `RfaAdapter`, added `_rfa` to registry loop
- `geometry-service/app/models.py` — added `"rfa"` to `GenerateRequest.formats` Literal
- `geometry-service/app/main.py` — added `"rfa"` to `_GEOMETRIC_FORMATS`; added `warnings.extend(ctx.warnings)` before building `GenerateResponse`
- `src/lib/geometry.ts` — added `'rfa'` to `OutputFormat` union
- `src/components/OutputTray.tsx` — added RFA card `{format:'rfa', title:'Revit Family', formatLabel:'RFA · Revit family', audience:'For your Revit model', includeRender:false}` as first CAD group entry; reordered CAD group to: Concept Card, Spec Sheet, 2D Drawing, Revit Family (rfa), STEP, Revit Model (IFC, relabeled audience to 'For open BIM / import'), Handoff Package, Photometric; also fixes Task-3 IFC/STEP ordering
- `package.json` — bumped version 0.0.3 → 0.0.4

## Self-Review

**Correctness**: `MockApsClient.submit` output is deterministic (sort_keys, no wall-clock) and byte-identical across runs — confirmed by test. `get_aps_client()` correctly gates on both env vars. `ctx.warnings` is accumulated per-request (field_factory=list means each GenContext gets its own list). `main.py` extends `warnings` after the adapter loop so ctx.warnings don't get lost.

**RealApsClient**: compiles, import-safe (httpx imported lazily inside `submit()`), clearly outlines the 5-step APS flow with commented-out httpx calls. Never invoked in tests. Guard raises RuntimeError if somehow called without creds.

**Frontend card order**: matches brief exactly — RFA is W3 priority #1 in the CAD group. IFC audience updated to "For open BIM / import". Task-3 IFC/STEP order mismatch resolved as a side-effect.

**Boundary**: httpx stays inside `app/adapters/aps_client.py`. All engine imports (ezdxf, fpdf, ifcopenshell, build123d) stay in adapters/kit. Grep confirms empty outside those dirs.

## Concerns

1. **DoD 2 deferred**: The produced `.rfa` file is NOT Revit-loadable — it's an ASCII/JSON placeholder container. This is correct per plan ("loads in Revit" is deferred until Autodesk account exists). The mock note and `ctx.warnings` message make this explicit to downstream consumers.

2. **RealApsClient.submit raises NotImplementedError**: This is intentional — the flow is outlined/documented but not wired. Once APS creds exist, the commented scaffolding provides the implementation template.

3. **`httpx` already in venv**: `starlette.testclient` brings httpx in as a test dependency, so no new package installation was needed. The `import httpx` inside `RealApsClient.submit` is guarded against `ImportError` just in case the runtime dep is absent in a stripped prod environment.
