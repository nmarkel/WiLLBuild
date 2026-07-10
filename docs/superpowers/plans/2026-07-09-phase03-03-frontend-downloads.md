# Phase 0.3 Plan 03 — Frontend: live Downloads tray

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download cards call the geometry-service, show progress, deliver the file; failures show a plain-language error; contact gate stays in front. IES stays a disabled placeholder (photometrics out of scope).

**Architecture:** New `src/lib/geometry.ts` client against the frozen HTTP contract in the master plan. `OutputTray.tsx` grows per-card state (idle/working/done/error). Service reachable at `VITE_GEOMETRY_URL ?? 'http://localhost:8000'`. Tests mock `fetch` — no live service needed in vitest.

**Prereq:** Plan 01 merged (touches the same `src/` tree). Plan 02 NOT required to be done — build against the contract; integration happens in the master plan's end-to-end step.

Global constraints: see `2026-07-09-phase03-00-master.md`.

---

### Task 1: geometry client

**Files:**
- Create: `src/lib/geometry.ts`, `src/lib/geometry.test.ts`

**Interfaces (produced):**

```ts
export type OutputFormat = 'step' | 'dxf' | 'dwg' | 'ifc' | 'pdf' | 'bundle'
export interface GeneratedFile { format: string; filename: string; url: string; sizeBytes: number }
export interface GenerateResponse { configHash: string; files: GeneratedFile[]; warnings: string[] }

export const GEOMETRY_URL: string   // import.meta.env.VITE_GEOMETRY_URL ?? 'http://localhost:8000'

/** POST /generate; renderPng is a base64 data-URL payload (strip the prefix before sending). */
export async function generateOutputs(
  config: PoleConfig, formats: OutputFormat[], renderPng?: string,
): Promise<GenerateResponse>          // throws GeometryError with a plain-language message

export class GeometryError extends Error {}   // .message is user-facing

/** GET /health → set of available formats; empty set when service unreachable. */
export async function availableFormats(): Promise<Set<string>>

/** Fetch a generated file and trigger a browser download. */
export async function downloadGeneratedFile(file: GeneratedFile): Promise<void>
```

- [ ] **Step 1: Failing tests** (`vi.stubGlobal('fetch', ...)`): success path returns parsed response; network failure → GeometryError message `"Couldn't reach the file generator — is the geometry service running?"`; 422 → GeometryError carrying the server's `detail`; `availableFormats` maps `/health` `adapters:{step:true,dwg:false}` → `Set{'step',...}` and unreachable → empty set.
- [ ] **Step 2:** Implement; `npx vitest run src/lib/geometry.test.ts` green.
- [ ] **Step 3:** Commit: `git commit -am "geometry client for the output tray"`

### Task 2: OutputTray goes live

**Files:**
- Modify: `src/components/OutputTray.tsx`, `src/index.css`

**Interfaces:**
- Consumes: Task 1 client; `useConfigurator.getState().snapshot` (existing) for the hero render; existing ContactGate + `saveLead`.
- Produces: live cards: Spec Sheet (pdf), 2D Drawing (dxf — label mentions DWG when available), Solid CAD (step), Revit Model (ifc, format label "IFC"), Handoff Package (bundle). Photometric (IES) stays disabled "coming soon".

Card behavior:
- On mount, `availableFormats()` once; cards for unavailable formats render like today's disabled placeholders with "coming soon" (so the tray degrades gracefully when the service is down).
- Click → contact gate (existing flow, lead logged with the deliverable key) → card enters working state ("Generating…", spinner, button disabled) → `generateOutputs(config, [fmt], renderPng)` where `renderPng` comes from `snapshot()` for `pdf`/`bundle` only → `downloadGeneratedFile` each returned file → brief "Downloaded ✓".
- Error → card shows the GeometryError message inline (12px, gunmetal on silver — **no red-alarm styling, no blue**), reverts to idle on next click.
- Show `warnings[]` (e.g. DWG skipped) as a one-line note under the tray.

- [ ] **Step 1:** Implement per-card state machine (`useState<Record<string, CardState>>`). Keep PNG + Config Summary cards as they are.
- [ ] **Step 2:** CSS: spinner = 3-dot pulse in gunmetal; working card gets yellow left border `#FFCF2E`.
- [ ] **Step 3:** Manual check with the service down: cards show "coming soon"; with a stub (if plan 02 not yet done, `python3 -m http.server` is not enough — instead run `npx vitest` mocks only and defer the live click-through to master-plan integration).
- [ ] **Step 4:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "output tray: live STEP/DXF/IFC/PDF/bundle cards with progress + plain-language errors"`

### Task 3: Quote handoff carries the config hash

**Files:**
- Modify: `src/lib/summary.ts` (no signature change — add the share URL + note that CAD files reference the config ID), `src/components/Summary.tsx` if the chip area needs the hash

- [ ] **Step 1:** `buildSummaryText` already includes config ID; append the share URL line if absent so a quote request round-trips to the exact build. Update `src/lib/summary` tests if present, else add one assertion in a new test.
- [ ] **Step 2:** `npm run test && npm run lint && npm run build`; commit: `git commit -am "summary text round-trips the share URL"`
