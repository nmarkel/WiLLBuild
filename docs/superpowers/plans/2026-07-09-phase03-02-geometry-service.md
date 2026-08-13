# Phase 0.3 Plan 02 — geometry-service (Workstreams A, B, C, D, E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A FastAPI service that turns a config JSON into downloadable STEP, DXF (+DWG when ODA exists), IFC, spec-sheet PDF, and a zip handoff bundle — deterministic, labeled, behind a sacred adapter boundary.

**Architecture:** `geometry-service/` colocated in the repo. `app/kit/` builds build123d B-rep solids parametrically **from `public/catalog.json` dims/sockets** (one source of truth with the viewer). `app/adapters/` each expose `generate(assembly, ctx) -> list[Path]`; engines (build123d exporter, ezdxf, ifcopenshell, fpdf2, ODA CLI) are imported **only** inside their adapter module. `app/main.py` knows only the adapter registry.

**Tech Stack:** Python 3.13 venv, FastAPI + uvicorn, build123d, ezdxf, ifcopenshell, fpdf2, pytest. `python3.13` is at `/opt/homebrew/bin/python3.13`.

Global constraints + frozen HTTP contract: see `2026-07-09-phase03-00-master.md`.

**Dimension source of truth:** the kit reads `../public/catalog.json`: pole `heightM`/radii from `placeholder`, socket positions from `sockets`, arm sweeps from `placeholder.points`, fixture/base-cover silhouettes from `placeholder` (lathe profiles, prisms, groups). Viewer meters → CAD mm (×1000). Concept-level shells, NOT manufacturing geometry.

---

### Task 1: Service skeleton — venv, FastAPI app, config validation, catalog loader

**Files:**
- Create: `geometry-service/requirements.txt`, `geometry-service/run.sh`, `geometry-service/README.md`, `geometry-service/app/__init__.py`, `geometry-service/app/main.py`, `geometry-service/app/catalog.py`, `geometry-service/app/models.py`, `geometry-service/app/naming.py`
- Create: `geometry-service/tests/test_api.py`, `geometry-service/tests/conftest.py`
- Modify: `.gitignore` (add `geometry-service/.venv/`, `geometry-service/out/`)

**Interfaces (produced, used by every later task):**

```python
# app/models.py
class PoleConfig(BaseModel):
    configId: str; pole: str; baseCover: str; arm: str; fixture: str; finish: str; rev: int
class GenerateRequest(BaseModel):
    config: PoleConfig
    formats: list[Literal['step','dxf','dwg','ifc','pdf','bundle']]
    renderPng: str | None = None        # base64

# app/catalog.py
def load_catalog() -> dict            # cached read of ../public/catalog.json (env CATALOG_PATH overrides)
def part(catalog, part_id) -> dict    # raises KeyError
def validate_config(catalog, cfg: PoleConfig) -> None
    # raises ValueError listing problems: unknown ids, socket-compat violations
    # (reimplements canHost: host has socket whose type == part's mount — ~15 lines, mirrors src/lib/compat.ts)

# app/naming.py
DISCLAIMER = "Concept starter model - not final engineered or manufacturing-released design"
def config_hash(cfg: PoleConfig) -> str   # sha256 over canonical json of
    # {pole,baseCover,arm,fixture,finish} sorted-keys (configId/rev excluded so the
    # SAME geometry gets the SAME hash), first 8 hex chars
def base_name(catalog, cfg) -> str        # f"WiLL_{config_hash}_{cfg.configId[:8]}"
```

- [ ] **Step 1:** `cd geometry-service && /opt/homebrew/bin/python3.13 -m venv .venv && .venv/bin/pip install fastapi 'uvicorn[standard]' pydantic pytest httpx build123d ezdxf ifcopenshell fpdf2` — then freeze: `.venv/bin/pip freeze > requirements.txt`. If `build123d` or `ifcopenshell` has no 3.13 wheel, recreate the venv with `python3.12` and note it in README.
- [ ] **Step 2: Failing tests** in `tests/test_api.py` (use `fastapi.testclient`): `/health` returns adapter map; `/generate` with unknown part id → 422; `/generate` with post-top fixture + pendant arm → 422 (socket violation); `config_hash` stable across configId/rev changes, different across part changes.
- [ ] **Step 3:** Implement the four modules. `main.py`: `POST /generate` validates, dispatches to registered adapters (empty registry for now → 422 "no adapter for format"), `GET /files/{name}` serves from `geometry-service/out/` (FileResponse, reject path traversal), `GET /health` reports which adapters registered. CORS middleware allowing `http://localhost:5173`. Output dir `out/` created on boot.
- [ ] **Step 4:** `.venv/bin/pytest` green. `run.sh`: `#!/bin/sh\ncd "$(dirname "$0")" && exec .venv/bin/uvicorn app.main:app --port 8000` (chmod +x).
- [ ] **Step 5:** Commit: `git add -A && git commit -m "geometry-service: FastAPI skeleton, config validation, deterministic naming"`

### Task 2: Workstream A — parametric solid kit (build123d)

**Files:**
- Create: `geometry-service/app/kit/__init__.py`, `app/kit/parts.py`, `app/kit/assembly.py`
- Create: `geometry-service/tests/test_kit.py`

**Interfaces:**

```python
# app/kit/parts.py — every builder returns a build123d Part (solid), origin at the
# part's lower attachment point, +Z up (build123d convention; viewer +Y maps to +Z), mm.
def build_pole(p: dict) -> Part          # tapered cylinder from placeholder radii/height
def build_base_cover(p: dict) -> Part    # revolve/loft; 'fluted' gets 12 shallow flutes (cosmetic)
def build_arm(p: dict) -> Part           # sweep placeholder.points polyline (fillet-smoothed spline) with circle radiusM
def build_fixture(p: dict) -> Part       # by placeholder kind: lathe→revolve profile, group/prism→loft+boolean union, cone→cone
def build_part(p: dict) -> Part          # dispatch on slot/kind

# app/kit/assembly.py
@dataclass
class BuiltAssembly:
    solid: Part                # single fused solid, mm, sitting on Z=0
    parts: list[tuple[str, Part]]          # (part_id, positioned solid)
    dims: AssemblyDims

@dataclass
class AssemblyDims:            # everything the DXF/PDF need, all in mm
    overall_height: float; pole_height: float; mounting_height: float   # fixture light/attach height
    arm_reach: float; base_diameter: float

def build_assembly(catalog: dict, cfg: PoleConfig) -> BuiltAssembly
    # positions parts by walking the same socket data the viewer uses:
    # pole at origin; baseCover at pole.sockets.base; arm at pole.sockets.top;
    # fixture at arm's socket whose type == fixture.mount. NO hardcoded offsets.
```

- [ ] **Step 1: Failing tests** in `tests/test_kit.py`: for every valid combo of the current kit (enumerate via catalog + validate_config — reuse a `valid_combos(catalog)` helper in `conftest.py`): `build_assembly` returns a solid with `volume > 0`; bbox Z-height within ±1% of expected (pole heightM + fixture extent above pole top, computed from catalog data); assembly sits on Z=0 (bbox zmin ≥ -1 mm); a 20 ft pole assembly is ~6100 mm + fixture.
- [ ] **Step 2:** Implement `parts.py`. Concept-level shells. Exemplar for the lathe (rest follow the same pattern):

```python
from build123d import *
M = 1000.0  # catalog meters → mm

def build_fixture_lathe(profile: list[list[float]]) -> Part:
    pts = [(r * M, y * M) for r, y in profile]        # (radius, height) pairs
    with BuildPart() as bp:
        with BuildSketch(Plane.XZ) as sk:
            with BuildLine():
                Polyline(*[(r, y) for r, y in pts],
                         (0, pts[-1][1]), (0, pts[0][1]), close=True)
            make_face()
        revolve(axis=Axis.Z)
    return bp.part
```

Arms: `sweep()` a circle of `radiusM*M` along a `Spline` through `placeholder.points` (map viewer `[x,y,z]` → mm `(x, z, y)` so viewer +Y becomes +Z). Groups: union of children builders translated by child position. Prisms: `extrude` a regular polygon with taper via `loft` between top/bottom polygons. Keep each builder ≤ ~30 lines; fall back to a simpler solid (plain loft) rather than fighting fillets — concept fidelity, not manufacturing.
- [ ] **Step 3:** Implement `assembly.py`: position copies via `Pos(...) * part`, fuse with `+`, compute `AssemblyDims` (arm_reach = max X extent of arm solid; mounting_height = fixture attach Z or fixture `lightOffset` Z when present; base_diameter from base cover placeholder bottom radius ×2).
- [ ] **Step 4:** `.venv/bin/pytest tests/test_kit.py` green (this is the long pole — iterate builder by builder; run per-test with `-k`).
- [ ] **Step 5:** Commit: `git commit -am "kit: parametric build123d solids for all catalog parts + socket-driven composer"`

### Task 3: Workstream B — STEP adapter + determinism

**Files:**
- Create: `geometry-service/app/adapters/__init__.py` (registry), `app/adapters/base.py`, `app/adapters/step_adapter.py`
- Create: `geometry-service/tests/test_step.py`

**Interfaces:**

```python
# app/adapters/base.py
@dataclass
class GenContext:
    catalog: dict; cfg: PoleConfig; out_dir: Path; base_name: str
    assembly: BuiltAssembly | None      # built once in main.py when any geometric format requested
    render_png: bytes | None
    summary: dict                       # part names, finish name+RAL, dims — built by main.py from catalog

class Adapter(Protocol):
    format: str
    def available(self) -> bool
    def generate(self, ctx: GenContext) -> list[Path]

# app/adapters/__init__.py
REGISTRY: dict[str, Adapter]           # populated by explicit imports here — the ONLY place engines meet the app
```

- [ ] **Step 1: Failing tests** `tests/test_step.py`: generating a default config yields `out/WiLL_<hash>_<id8>.step`; file starts with `ISO-10303-21`; `FILE_DESCRIPTION` contains the DISCLAIMER and config ID; **determinism** — generate twice into different dirs, strip the `FILE_NAME` line (carries a timestamp), remaining bytes identical; re-import with build123d `import_step` and volume matches the source solid within 0.1%.
- [ ] **Step 2:** Implement: `export_step(assembly.solid, path)`, then post-process the header: rewrite `FILE_DESCRIPTION(('...'),'2;1');` to `FILE_DESCRIPTION(('WiLL concept model config {configId} rev {rev}','{DISCLAIMER}'),'2;1');` (plain-text line edit — STEP headers are ASCII).
- [ ] **Step 3:** Register in `REGISTRY`; wire `main.py`: when requested formats intersect geometric ones, call `build_assembly` once, share via ctx. `pytest` green.
- [ ] **Step 4:** Commit: `git commit -am "STEP adapter: labeled header, deterministic output"`

### Task 4: Workstream C — DXF adapter (dimensioned elevation) + DWG via ODA + boundary proof

**Files:**
- Create: `app/adapters/dxf_adapter.py` (route 1: dims direct from `AssemblyDims` + 2D projection), `app/adapters/dxf_projection_adapter.py` (route 2: build123d `section`/`project` of the solid → edges → ezdxf), `app/adapters/dwg_adapter.py`, `app/titleblock.py`
- Create: `tests/test_dxf.py`
- Create: `geometry-service/docs/adapter-swap-note.md` (DoD 8)

**Interfaces:**
- Consumes: `GenContext` (assembly.dims, assembly.parts for silhouette), `titleblock.draw(msp, ctx)` shared by both DXF routes.
- Produces: `<base>.dxf` (+ `<base>.dwg` when ODA available). Env `DXF_ROUTE=direct|projection` picks the adapter at registry time — **the swap must touch zero files outside `app/adapters/`** (that's the demo).

- [ ] **Step 1: Failing tests** `tests/test_dxf.py`: DXF loads with `ezdxf.readfile`; modelspace contains ≥4 `DIMENSION` entities; a text entity contains the DISCLAIMER and one contains the config ID; the overall-height dimension's measurement equals `dims.overall_height` ±1 mm; runs for both `DXF_ROUTE` values with identical dimension measurements (the boundary proof, as a test).
- [ ] **Step 2:** `titleblock.py`: A3 landscape border, right-bottom block with WiLL wordmark as text (gunmetal), config ID, date placeholder "—" (no wall-clock in output → determinism), finish name, DISCLAIMER line, `1:50` scale note.
- [ ] **Step 3:** Route 1 (`dxf_adapter.py`, ships first): front elevation as XZ silhouette polylines taken per-part from catalog placeholder data (pole trapezoid, arm polyline offset by tube radius, fixture profile), plus ezdxf `LinearDimension` for: overall height, pole height, mounting height, arm reach, base diameter. Route 2 (`dxf_projection_adapter.py`): `project(assembly.solid, workplane=Plane.XZ)` → iterate resulting edges → `msp.add_line/add_spline`, then the same `titleblock.draw` + same dimension calls from `dims`.
- [ ] **Step 4:** `dwg_adapter.py`: locate ODA File Converter (`shutil.which('ODAFileConverter')` or `/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter`); if present convert DXF→DWG (subprocess, ACAD2018), else `available() → False` and main.py adds the warning `"DWG skipped: ODA File Converter not installed"` while still returning the DXF.
- [ ] **Step 5:** `pytest` green. Write `docs/adapter-swap-note.md`: what was swapped, the env flag, `git diff --stat` evidence that only adapter files differ, test output showing identical dims (DoD 8).
- [ ] **Step 6:** Commit: `git commit -am "DXF elevation with WiLL title block + dims; DWG via ODA when present; adapter-swap proof"`

### Task 5: Workstream D — IFC adapter (Revit deliverable, Option B)

**Files:**
- Create: `app/adapters/ifc_adapter.py`
- Create: `tests/test_ifc.py`

**Interfaces:**
- Consumes: `GenContext.assembly` (per-part solids), `naming.DISCLAIMER`.
- Produces: `<base>.ifc` — IFC4, one `IfcLightFixture` (category maps to Revit *Lighting Fixtures*) containing the fused geometry as a tessellated representation, property set `Pset_WiLLConcept` with `ConfigId`, `Revision`, `Disclaimer`, `OverallHeight_mm`, `Finish`.

- [ ] **Step 1: Failing tests** `tests/test_ifc.py`: file opens with `ifcopenshell.open`; schema `IFC4`; exactly one `IfcLightFixture`; its psets (via `ifcopenshell.util.element.get_psets`) carry ConfigId + Disclaimer; geometry present (shape representation non-empty); deterministic across two runs after zeroing the header timestamp (ifcopenshell lets you set `file.header` / owner history explicitly — set fixed `creation_date=0`).
- [ ] **Step 2:** Implement: mesh the solid via build123d `.tessellate(0.5)` (or export/import trick), build IFC with `ifcopenshell.api` (project → site → building → storey → `IfcLightFixture` with `IfcPolygonalFaceSet`), mm units, add pset. ~120 lines.
- [ ] **Step 3:** `pytest` green; register adapter. Commit: `git commit -am "IFC adapter: IfcLightFixture with concept pset (Revit deliverable, Option B)"`
- [ ] **Step 4:** Append the decision record to `/Users/nickmarkel/Library/CloudStorage/GoogleDrive-nmarkel@willbrands.com/Shared drives/21-Engineering/18-coding-projects/WiLLbuild/Design Assistant/12 Open Decisions.md` (see master plan; short entry: chose IFC now, RFA-via-APS deferred to Phase 3 — blocked on APS account/credentials; adapter boundary keeps the swap frontend-invisible).

### Task 6: Workstream E — spec-sheet PDF adapter

**Files:**
- Create: `app/adapters/pdf_adapter.py`, `app/spec_template.py`
- Create: `tests/test_pdf.py`
- Modify: `public/catalog.json` — add `"ral"` to each finish: matte-black `RAL 9005`, statuary-bronze `RAL 8019`, forest-green `RAL 6009`, gloss-white `RAL 9016`, silver `RAL 9006` (provisional — palette unconfirmed). Add `"ral"?: string` to `FinishDef` in `src/types.ts`.

**Interfaces:**
- Consumes: `ctx.summary` (component names + productUrls + dims + finish w/ RAL), `ctx.render_png`.
- Produces: `<base>.pdf`, one page. `spec_template.py` exposes `render_spec(ctx, mode='spec'|'concept-card') -> bytes` — one template, two names (per spec / [[06 Deliverable Stack]]).

- [ ] **Step 1: Failing tests** `tests/test_pdf.py`: output is a valid PDF (`%PDF` magic + parse with `pypdf` — add to venv); extracted text contains config ID, DISCLAIMER, every part name, finish name + RAL, overall height in ft+mm, and the quote URL `willbrands.com/pages/request-a-quote`; with `renderPng` supplied the PDF embeds an image XObject.
- [ ] **Step 2:** Implement with fpdf2: WiLL-branded header band (gunmetal hex `#42413D`, title in white, yellow `#FFCF2E` rule — no blue), hero render right column (or silver placeholder box "render not supplied"), component table (slot / product / link), dims block from `AssemblyDims` (mm + ft-in), finish block (name, RAL, provisional note when `finishesProvisional`), footer: DISCLAIMER + config ID + rev + quote CTA. Core fonts (Helvetica) are acceptable stand-ins for Roboto in 0.3 — note in README.
- [ ] **Step 3:** `pytest` green; register. Commit: `git commit -am "spec-sheet PDF adapter (fpdf2), one template for spec sheet + concept card"`

### Task 7: Bundle adapter + full-matrix + performance test

**Files:**
- Create: `app/adapters/bundle_adapter.py`, `tests/test_bundle.py`, `tests/test_matrix.py`

- [ ] **Step 1: Failing tests:** bundle zip contains `<base>.step`, `render.png` (when supplied), `config.json` (exact PoleConfig), `summary.txt`, `README.txt` with DISCLAIMER; zip is deterministic (fixed `ZipInfo` date_time=(1980,1,1,0,0,0)).
- [ ] **Step 2:** Implement (reuse STEP+PDF adapters' outputs via ctx-level caching in main.py: each adapter runs once per request even for bundle). `pytest` green; commit.
- [ ] **Step 3:** `tests/test_matrix.py` (mark `@pytest.mark.slow`): every valid combo × [step, dxf, ifc, pdf] generates without error; assert each single-format call ≤ 60 s (DoD 7); print a timing table. Run it once fully: `.venv/bin/pytest tests/test_matrix.py -v`.
- [ ] **Step 4:** Update `geometry-service/README.md`: run instructions, API contract, adapter boundary rules, env flags (`CATALOG_PATH`, `DXF_ROUTE`), what's deliberately not here (photometrics, manufacturing geometry). Commit: `git commit -am "bundle adapter + full test matrix; service docs"`
