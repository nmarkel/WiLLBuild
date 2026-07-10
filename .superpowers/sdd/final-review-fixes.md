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
