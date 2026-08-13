---
name: willbuild-product-ingest
description: Pipeline for bringing a new WiLL product from CAD to the configurator. Use whenever ingesting or updating a product from the Synology STEP drive, adding a catalog part or product family, encoding an ordering matrix from a spec sheet, mapping real CAD to a part, deriving sockets/orientation, regenerating renders, or flipping realCad/comingSoon flags. Trigger on any mention of Synology, STEP ingest, step-to-glb, real-parts.json, render rig, coverage matrix, or "add <product> to the site."
---

# WiLLbuild Product Ingest Pipeline

One product, one uniform path: **classify → encode → align → render → flag → gate → verify.**
Skipping a step has always cost more than doing it. Work on a phase branch off `Dev`
(merge to `Dev` before the next branch — the 0.10.5 rule).

## 0 · Source ground rules

- Source of truth (Cole's exports; basis = 4" pole, 40F arm hub, 3" OD tenon):
  `~/Library/CloudStorage/SynologyDrive-NickSynology206/Engineering/Marketing-Engineering/STEP-Website/WiLLstudio`
  — this is the **CloudStorage** mount. `~/SynologyDrive/...` also resolves but reads
  EMPTY, so a path built from it silently finds nothing (corrected 2026-08-13; the
  same warning is in `scripts/step-to-glb/ingest.py`'s docstring).
  Files are **FULL engineering STEP — IP-sensitive**. They never ship. GLBs are
  machine-local + gitignored, and `ingest.py` does NOT copy from the drive: the local
  cache `scripts/render-rig/real-assets/step/` is populated by hand, and a file that
  is on Synology but not there records as `present: false` with no hash.
- The vault (phase docs, coverage matrix, open decisions) moved 2026-08-13 to the
  shared Google Drive and is the single source of truth for Nick, Tyler and Claude:
  `/Users/nickmarkel/Library/CloudStorage/GoogleDrive-nmarkel@willbrands.com/Shared drives/21-Engineering/18-coding-projects/WiLLbuild/Design Assistant`
  The old `~/Documents/Design Assistant` is tombstoned — never write there.
- If a filename changed on Synology, verify by **SHA compare** before assuming a rename
  (CR1→CR2 precedent), then update `scripts/step-to-glb/ingest.py` to follow.
- The coverage audit lives in the vault ("WiLLstudio STEP → Site Coverage Matrix"); update
  counts there (or note them in the execution response) when they move.

## 1 · Classify the file — not everything gets a render layer

| Class | Meaning | Action |
|---|---|---|
| **Render source** | generates its part's layer | full pipeline below |
| **Cluster/variant** (AR2-4, SS2-4, BA30, side-mounts…) | part covered by a sibling; rig renders one arm + repeats radially | register in `CLUSTER_FILES`; CAD-download wiring only; NO layer |
| **Order-code adder** (FH, PH, CF1-3, CPL…) | code + shaft placement, not a slot part | no layer — a render would be wrong |
| **Pseudo-part** (`direct-mount`) | needs no CAD ever | exclude from realCad/comingSoon logic |

## 2 · Ordering matrix (new product family only)

- Encode from the spec sheet into the catalog **and BOTH resolvers** (TS + Python), guarded by
  the shared fixture `docs/part-number-cases.json` — add cases, including the **sheet's own
  published example**, and reproduce it byte-exact in both languages before moving on.
- **Never hand-edit `catalog.json`.** Corrections go in `docs/spec-option-corrections.json`
  via `scripts/apply-spec-option-corrections.mjs` (idempotent) — merge scripts silently revert
  hand-fixes.
- Watch the two known column traps: a sheet column that merges **two segments** (TEX's
  Design+Lumen) and **two finish columns zipped into one** (TEX Housing vs Spider/Accent —
  which needed a whole config axis, `accentFinishes`, joined into `config_hash`).
- Anything ambiguous on the sheet (e.g. a distribution in the lumen tables but not the matrix,
  like TEX `5VN`): **do not encode; pin its absence with a test** and flag needs-human.
- New config fields MUST be declared on the pydantic model — undeclared fields are silently
  dropped (the 0.10.5 failure mode), and options-bearing fields join `config_hash`.

## 3 · Orientation + socket alignment — measure, never assume

- Real arms reach along **Z** (x pinned ≈0.102, the pole clamp); placeholders reach **+X**.
  Most need `rotateY: -90` in `real-parts.json` — **but measure each one: PM1 needed +90**
  (it reaches the opposite way; batch-assuming −90 ships a backwards arm).
- Catalog sockets were authored against placeholders. **Re-derive the socket from the GLB's
  actual vertices**, calibrating the method against a known-good part first (SH1 reference:
  derived [0.513, 0.544] vs authored [0.483, 0.514]; anchor rule = end-fitting centroid,
  ±3 cm).
- The vertical hang point is a **judgment call per socket type** — a pendant hangs from the
  tip's underside; a tenon fixture sits on top. Any socket move visibly repositions the
  fixture → **needs human visual verification (before/after screenshots)**. Flag, don't ship
  blind.
- **Never map a part without its socket fix.** A misaligned real render is worse than the
  placeholder and invisible to the coverage gate (layers exist; they're just wrong).
- `src/lib/socketRealCad.test.ts` catches gross misplacement (≥~8 cm), **not** fine offsets
  (AR1's 4 cm was found by measuring) — it's a floor, not proof.

## 4 · Render

- Viewport set: **2 full-assembly views 180° apart + component focus views (fixture/arm/base)**;
  render azimuths {0,90,180,270}; **13 finishes; no coverage exemptions, ever** — the gate
  reports degradation, it never tolerates it (also fails on stray/retired angles).
- Focus views are a **camera concern** (`focusBox`/`focusFrame`) — same fixed `pxPerMeter`
  crops are byte-identical; don't re-render for framing.
- **Mapping + re-render ship together**: `realCad` drives Coming Soon, so mapping without new
  renders presents a part as configurable while showing placeholder art.
- Tessellation is dense (GVX ≈1.12 M triangles) and the rig is competent PBR — neither is the
  fidelity lever; don't "improve" them without a measured side-by-side.

## 5 · Flags — two axes, never conflated

- **`realCad`** = generated truth from the rig's `real-parts.json` — never hand-set. Parts
  re-enable out of Coming Soon automatically when ingest lands them.
- **`comingSoon`** = editorial/merchandising hold, set by humans (current cut: fixture slot =
  GVX + TEX only; DRX/MVX/DWX held despite real CAD). Only Nick/Tyler change the cut.
- Repair semantics: **never *choose* a held part, never *evict* one already selected** — new
  configs land on something configurable; saved links keep their part, inert (badged, no part
  number, no downloads).

## 6 · IP gates (non-negotiable)

- **Full engineering STEP never ships.** Customer downloads (`factory-cad/<PN>.step`) stay
  gated until Cole's stripped shells exist; the allowlist is fail-closed (`GVX-Simple.STEP` is
  the one-entry exception pattern). Registering cluster files does NOT make them downloadable.
- Web GLBs (live-3D work): **exterior-shell only + decimated**, with an automated shell-only
  check; if extraction is unreliable for a part, hold that part.

## 7 · Verify + hand back

- Both suites green (frontend + geometry-service); drift fixture passes both languages;
  coverage gate green; visual checks in the browser for anything positional.
- Append a dated **Execution response** to the current phase doc in the vault, marking
  machine-verified vs needs-human-open, and report the real-CAD count (x of 117).

## Known hazards (learned the hard way)

- `docs/real-geometry.json --manifest` **wipes provenance hashes** when CAD assets aren't
  local (they're gitignored — CI has none). Edit surgically instead.
- `merge-spec-options.mjs` is **not a full regenerator** — shipped-catalog curation (GVX
  mounting column removed, alum-pole option trims) lives nowhere else; see the script header.
- Bounding-box assertions pass on buggy sockets (the whole-arm box contains bad positions);
  assert on the **tip band** instead — and prove a new test can fail by reverting the fix.
- Fixture rot: derive test fixtures from the catalog, never hardcode slots (the 0.10.5
  `standalone` re-slot broke 68 tests).
