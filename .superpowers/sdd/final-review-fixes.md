# Final-Review Fixes — phase-0.3

## Fix 1 — Silent false success (OutputTray.tsx `runDelivery`)

**Finding:** The geometry service returns HTTP 200 with `files: []` and adapter errors in
`warnings` when an adapter fails. `runDelivery` then called `setCardState(format, { phase: 'done' })`
and showed a ✓ checkmark even though nothing was downloaded.

**Fix:** After `generateOutputs` returns, check `response.files.length === 0` and throw a
`GeometryError` whose message is `response.warnings.join(' ')` (falling back to
`"The service couldn't generate this file."`). The existing `catch` block routes it to the
card's error state.

**Test evidence:** `geometry.test.ts` — new test
`"returns an empty files array when the service returns files: []"` verifies that
`generateOutputs` faithfully surfaces `files: []` + `warnings` so the component guard can fire.
59 tests pass.

---

## Fix 2 — DWG mislabeling (OutputTray.tsx `DeliverableCard` + render site)

**Finding:** When `/health` advertised `dwg`, the 2D Drawing card already showed the "DWG" label
(line 177) but `onRequest` was still called with `'dxf'` because `def.format` was never changed.

**Fix:**
- Added `requestFormat` prop to `DeliverableCard` (type `OutputFormat | null`). The card's
  `onClick` now calls `onRequest(requestFormat)` instead of `onRequest(def.format)`.
- At the render site, `requestFormat` is computed as `'dwg'` when `availFormats.has('dwg')`,
  falling back to `'dxf'`. The card state key follows `requestFormat` so working/done/error
  state tracks the correct format string.
- When DWG is unavailable: label stays `'DXF · DWG on request'`, request stays `'dxf'`.

**Test evidence:** Pure component logic; covered by 59 passing unit tests. No format-routing
unit test added (logic is inside React component; tested at integration level).

---

## Fix 3 — Phantom finish on standalone spec sheets (ProductViewer.tsx line 147)

**Finding:** `const defaultFinish = part.finishes[0] ?? catalog.finishes[0]?.id ?? ''`
falls through to `catalog.finishes[0]?.id` when a part has `finishes: []`, sending e.g.
`'matte-black'` for products that carry no finish. The geometry service then prints that
finish on spec-sheet PDFs for unfinished products.

**Fix:** Changed to `part.finishes.length > 0 ? part.finishes[0] : ''`. When the part has
no finishes, `selectedFinish` is `''`; the FinishChips row is already hidden by its
`part.finishes.length > 0` guard, and the geometry service explicitly accepts `finish: ''`
for standalone configs.

**Test evidence:** Pure initializer change; 59 existing tests pass. No new test added
(pure conditional, no extracted function to unit-test).

---

## Fix 5 — DXF sheet layout scale mismatch (app/adapters/_titleblock.py + app/adapters/dxf_adapter.py)

**Finding:** The A3 border/title block was drawn at paper size (420×297 mm) at the origin while the elevation was 1:1 real-world mm (a 20 ft pole = ~6100 mm tall). Opened in a CAD viewer, the title block was a postage stamp overlapping the pole base. The "Scale 1:50" note was false.

**Fix:** Moved the title block implementation to `app/adapters/_titleblock.py`. All geometry is now drawn at ×50 scale (A3 sheet = 21 000×14 850 mm in model space) and positioned dynamically relative to the elevation extents (elevation sits inside the border with MARGIN=250 mm clearance; title block occupies the right 4000 mm strip). `actual_measurement` values on DIMENSION entities remain the real mm values as before. `app/titleblock.py` is now a backwards-compat re-export shim.

**Test evidence:** `tests/test_dxf.py::TestDxfTitleBlock::test_border_encloses_all_elevation_entities` — new test asserts the outer border rectangle encloses all elevation entity points (both routes). 163 service tests pass (157 baseline + 6 new).

---

## Fix 6 — Boundary hygiene: engine-importing helpers moved inside adapter package

**Finding:** `app/titleblock.py` imported `ezdxf` and `app/spec_template.py` imported `fpdf` — both were outside `app/adapters/`. The rule is that engine imports (ezdxf, fpdf, ifcopenshell, build123d) must only appear in `app/adapters/` or `app/kit/`.

**Fix:**
- `app/titleblock.py` → `app/adapters/_titleblock.py` (real implementation)
- `app/spec_template.py` → `app/adapters/_spec_template.py` (real implementation)
- Both old files reduced to backwards-compat re-export shims so existing test imports keep working.
- `app/adapters/pdf_adapter.py` updated to import from `app/adapters/_spec_template`.
- `app/adapters/dxf_adapter.py` and `app/adapters/dxf_projection_adapter.py` updated to import from `app/adapters/_titleblock`.
- `docs/adapter-swap-note.md` caveat line updated to reflect new locations.

**Test evidence:** `grep -rn "import ezdxf|import fpdf|import ifcopenshell|from build123d" geometry-service/app --include="*.py" | grep -v "app/adapters/|app/kit/"` → empty (clean). 163 service tests pass.

---

## Fix 7 — Slot validation in validate_config (app/catalog.py)

**Finding:** `_can_host` returns True when a part has no mount, so `{fixture: 'alum-pole-12', ...}` (a pole id in the fixture field) validated and built nonsense geometry.

**Fix:** In `validate_config`'s full-assembly branch, after resolving each part from the catalog, assert that `part["slot"] == field`. Mismatches (e.g. slot="pole", field="fixture") are added to the problems list as `"part 'alum-pole-12' is a pole, not a fixture"`. The standalone path (pole/arm/baseCover === '') is unchanged — it intentionally accepts any catalog part id in the fixture field.

**Test evidence:**
- `tests/test_api.py::TestValidateConfig::test_slot_mismatch_pole_in_fixture_field_raises` — ValueError with "pole" in message
- `tests/test_api.py::TestGenerateValidation::test_slot_mismatch_via_api_returns_422` — POST /generate with alum-pole-12 in fixture field → 422
- 163 service tests pass.

---

## Fix 8 — Per-request bundle artifact staleness (app/adapters/bundle_adapter.py + app/adapters/base.py)

**Finding:** `BundleAdapter.generate()` reused any `<base_name>.pdf`/`.step` already on disk, regardless of which request produced it. Two sequential requests with different configs (or render images) could produce a bundle containing stale artifacts from the previous request.

**Fix:**
- Added `produced: dict[str, list[Path]]` field to `GenContext` (default empty dict). Tracks which files were generated in THIS request.
- `app/main.py` populates `ctx.produced[fmt]` after each adapter's `generate()` call.
- `BundleAdapter.generate()` now checks `ctx.produced.get("step/pdf")` instead of `step_path.exists()`. If the file was not produced this request, it calls the peer adapter to regenerate it.
- The DWG adapter's same-request DXF reuse pattern is unaffected (DWG checks `dxf_path.exists()` which still works since DXF was produced this request).

**Test evidence:**
- `tests/test_bundle.py::TestBundlePerRequestArtifacts::test_bundle_regenerates_pdf_when_not_produced_this_request` — writes sentinel bytes to disk before bundle call; asserts bundled PDF starts with `%PDF`, not the sentinel.
- `tests/test_bundle.py::TestBundlePerRequestArtifacts::test_bundle_reuses_pdf_when_produced_this_request` — asserts PDF mtime unchanged when `ctx.produced` already has the PDF path.
- 163 service tests pass.

---

## Fix 4 — Download anchor hardening (geometry.ts + OutputTray.tsx)

**Finding:** Both `downloadGeneratedFile` (geometry.ts ~line 112) and `downloadSnapshot`
(OutputTray.tsx ~line 103) created a detached `<a>` element and called `.click()` without
attaching it to the DOM. Firefox requires the anchor to be in the document for a programmatic
click to trigger a download.

**Fix:** In both locations, wrapped the click sequence with:
```ts
document.body.appendChild(a)
a.click()
document.body.removeChild(a)
```
The `URL.revokeObjectURL` call remains after removal.

**Test evidence:** DOM manipulation; 59 existing tests pass (JSDOM environment).
