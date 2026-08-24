# WiLLBuild Geometry Service — Deployment Runbook

**The chosen venue is AWS App Runner from an ECR image** (Tyler 8/19, prepped
turnkey in Phase 0.19). The fly.io sections further down were the Nick-era prep
and are **NOT TAKEN** — kept for reference, `fly.toml` stays as dormant config.

Division of labor: everything in this doc that needs no cloud credentials is
already done and verified (image builds, `/health` serves, assets baked, tests
green). The steps marked **[AUTH]** are the only ones left — they need an AWS
login and are run by Nick/Tyler.

---

## Docker Build Context

The Dockerfile lives at `geometry-service/Dockerfile` but **must be built from
the repo root** because it COPYs three subtrees:

| COPY source                 | Destination in image    | Why                          |
|-----------------------------|-------------------------|------------------------------|
| `geometry-service/app/`     | `/app/app/`             | FastAPI application code     |
| `geometry-service/assets/`  | `/app/assets/`          | Shell GLBs (committed) + staged customer STEPs — see the two sections below |
| `public/catalog.json`       | `/app/catalog.json`     | Catalog data (not in gs dir) |

> Phase 0.19 fix: the pre-0.19 image copied only `app/` + the catalog, so
> `assets/shells/` was missing and every shell-accurate STEP/IFC/drawing
> silently degraded to the parametric kit on deploy. The `.dockerignore` also
> excludes the gitignored engineering CAD cache
> (`scripts/render-rig/real-assets/`) so full masters can never enter the
> build context.

For a local test build (no deploy):

```bash
# From repo root:
python3 scripts/stage-customer-step.py          # stage customer STEPs (see below)
docker build -f geometry-service/Dockerfile -t willbuild-geometry .
docker run --rm -p 8080:8080 willbuild-geometry
# Then: curl http://localhost:8080/health
```

---

## Customer-download STEP files — the simplified-files home (Phase 0.19)

The customer-cleared simplified STEPs (`GVX-Simple.STEP`, `TEX-Post-Top.STEP`,
`TEX-AREA.STEP`) are ~27–30 MB each and gitignored, so a bare checkout ships an
empty `factory-cad/`. The home that fixes this:

1. **`geometry-service/assets/customer-step/manifest.json`** (committed) pins
   the SHA-256 + byte size of every file cleared to ship. `app/realgeom.py`
   refuses to serve bytes that do not hash to their pin — fail-closed, so a
   full engineering master under a reused filename can never leave the
   building. A cleared-but-missing file degrades to a documented
   `factory-cad/README-MISSING.txt` note in the bundle, never to a fallback.
2. **`scripts/stage-customer-step.py`** (stdlib python3) copies the manifest's
   files from the dev cache (`scripts/render-rig/real-assets/step/`, or
   `$REAL_STEP_DIR`) into `assets/customer-step/`, verifying each hash. Run it
   **before `docker build`** — the image bakes the staged files in. Skipped
   files are warnings (degraded deploy); hash mismatches are errors.
3. **Swappable source:** at runtime the service reads `$CUSTOMER_STEP_DIR`
   before the baked-in directory. When Cole's batch makes rebuild-per-file
   annoying, point it at a directory an S3 sync (or startup fetch) fills —
   e.g. mount/download `s3://<bucket>/customer-step/` to `/data/customer-step`
   and set `CUSTOMER_STEP_DIR=/data/customer-step`. The committed manifest
   still gates every byte served, so the bucket needs no trust.

Growing the set = add the verified file's pin to `manifest.json` + its entry in
`CUSTOMER_STEP_FILES` (or `CUSTOMER_STEP_FILES_BY_FIT`), re-stage, rebuild.

---

## AWS — App Runner from ECR (the taken path)

Prerequisites: AWS CLI v2 (`brew install awscli`), Docker Desktop running, and
an AWS login (`aws configure` / SSO). An ECR repository for this image already
exists: `563744787247.dkr.ecr.us-east-1.amazonaws.com/willbuild-geometry`
(us-east-1). All commands from the repo root.

### Step 1 — Build for linux/amd64 and push to ECR

App Runner runs **x86_64 only**, and dev machines are Apple Silicon — the plain
`docker build` produces an arm64 image App Runner cannot run. Always build the
deploy image with `--platform linux/amd64` (buildx + QEMU; the first amd64
build is slow, later ones cache):

```bash
# Unauthenticated prep (already verified locally):
python3 scripts/stage-customer-step.py

# [AUTH] one-time, only if the repository does not already exist:
aws ecr create-repository --repository-name willbuild-geometry --region us-east-1

# [AUTH] login, build, push:
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 563744787247.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/amd64 -f geometry-service/Dockerfile \
  -t 563744787247.dkr.ecr.us-east-1.amazonaws.com/willbuild-geometry:latest --push .
```

(Optional DWG: add `--build-arg ODA_URL="…"` — see the ODA section below.)

### Step 2 — Create the App Runner service

**One-time IAM role** so App Runner can pull from ECR:

```bash
# [AUTH]
aws iam create-role --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

**Console variant:** AWS Console → App Runner → Create service → Source:
*Container registry / Amazon ECR* → pick `willbuild-geometry:latest` →
Deployment trigger: *Manual* → ECR access role: `AppRunnerECRAccessRole` →
Service name `willbuild-geometry` → **Port 8080** → CPU **1 vCPU**, Memory
**2 GB** (OCCT wants headroom; 0.5 GB will OOM on fixture configs) → add the
environment variables from the table below → Health check: protocol HTTP,
path `/health` → Create.

**CLI variant:**

```bash
# [AUTH]
aws apprunner create-service --region us-east-1 \
  --service-name willbuild-geometry \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "563744787247.dkr.ecr.us-east-1.amazonaws.com/willbuild-geometry:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "ALLOWED_ORIGINS": "https://willbuild.nmarkel.workers.dev"
        }
      }
    },
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::563744787247:role/AppRunnerECRAccessRole"
    },
    "AutoDeploymentsEnabled": false
  }' \
  --instance-configuration '{"Cpu": "1 vCPU", "Memory": "2 GB"}' \
  --health-check-configuration '{"Protocol": "HTTP", "Path": "/health"}'
```

The response carries `ServiceUrl` — the service lives at
`https://<id>.us-east-1.awsapprunner.com`. Re-deploying after a new push:
`aws apprunner start-deployment --service-arn <arn>` (or the console's Deploy
button).

### Environment variables

| Variable            | Value                                                        | Notes |
|---------------------|--------------------------------------------------------------|-------|
| `ALLOWED_ORIGINS`   | comma-separated frontend origins, e.g. `https://willbuild.nmarkel.workers.dev,https://<tunnel>.trycloudflare.com` | CORS. Localhost dev origins are always merged in by the service. Tunnel hostnames are ephemeral — a tunnel-served frontend should instead proxy `/geometry/*` same-origin (see `docs` on the 0.18 share setup), which needs no CORS entry at all. |
| `CUSTOMER_STEP_DIR` | *(unset)* — or a mounted/synced dir when the S3 swap happens | See the simplified-files home section. |
| `ODA_PATH`          | *(unset)* — path to ODAFileConverter if DWG is enabled       | See ODA section. |

### Cost note

App Runner has **no scale-to-zero**: the minimum provisioned instance is
billed continuously (memory-hours) even when idle — expect **~$5–10/mo** at
1 vCPU / 2 GB with light traffic (provisioned ≈ $0.007/GB-hr ⇒ ~$10/mo for
2 GB, plus active vCPU-seconds while generating). That is the price of no
cold starts. If that line item ever matters, the same image runs anywhere
(ECS, EC2, fly) — nothing in it is App Runner-specific.

### Step 3 — Wire the frontend and verify

```bash
# 1. point the frontend at the service (build-time var):
echo 'VITE_GEOMETRY_URL=https://<id>.us-east-1.awsapprunner.com' > .env.production
npm run build

# 2. verify health from anywhere:
curl https://<id>.us-east-1.awsapprunner.com/health
# Expected: {"status":"ok","adapters":{"step":true,...}} — no "dwg" unless ODA was baked in.

# 3. verify one real download end-to-end (async job flow):
APP=https://<id>.us-east-1.awsapprunner.com
CFG='{"config":{"configId":"deploy-check","pole":"alum-pole-20","baseCover":"bc-cl1-small-clamshell","arm":"sh1-shepherds-hook","fixture":"gvx-pendant","finish":"matte-black","rev":1},"formats":["step","bundle"]}'
JOB=$(curl -s -X POST $APP/jobs -H 'content-type: application/json' -d "$CFG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')
sleep 20 && curl -s $APP/jobs/$JOB | python3 -m json.tool     # status done + files[]
# download the bundle URL it lists and check factory-cad/ contains the GVX .step
```

On Cloudflare Pages/Workers, set `VITE_GEOMETRY_URL` as a build env var
instead of `.env.production` and trigger a redeploy. **Trap (bit twice):** a
`npm run build` without the var bakes in `http://localhost:8000` and every
remote user's downloads silently point at their own machine.

---

# fly.io — NOT TAKEN (kept for reference)

Everything below was the Nick-era fly.io prep. Tyler's 8/19 call chose AWS;
`fly.toml` stays untouched as dormant config.

## Prerequisites

- **flyctl** installed: `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
- A fly.io account with billing configured (`fly auth login`)
- Docker desktop (or equivalent) installed and running (fly.io builds remotely so
  a local Docker daemon is not strictly required, but useful for local testing)
- Access to the WiLLBuild Cloudflare Pages/Workers project to set env vars

The `fly.toml` `[build]` section already sets `dockerfile = "geometry-service/Dockerfile"`,
so fly.io uses the repo root as the build context automatically when you run:

```bash
# From the repo root:
fly deploy --config geometry-service/fly.toml
```

## Step 1 — Create the fly.io app (first deploy only)

```bash
# From repo root:
fly launch --no-deploy --config geometry-service/fly.toml
```

When prompted:
- App name: `willbuild-geometry` (already set in fly.toml)
- Region: `ord` (Chicago) or whatever is closest to your users
- Postgres / Redis: **No** (not needed)
- Accept the fly.toml as-is

---

## Step 2 — Deploy

```bash
# From repo root:
fly deploy --config geometry-service/fly.toml
```

fly.io builds the image remotely (no local Docker build needed), pushes it, and
starts the VM. First deploy takes ~5-10 min due to the OCP/build123d image size.

After deploy, check health:

```bash
fly status --config geometry-service/fly.toml
curl https://willbuild-geometry.fly.dev/health
# Expected: {"status":"ok","adapters":{...}}
```

---

## Step 3 — Configure ALLOWED_ORIGINS

The deployed service reads `ALLOWED_ORIGINS` from env. The `fly.toml` already
sets it to `https://willbuild.nmarkel.workers.dev`. To update it (e.g. for a
different Cloudflare URL) without re-deploying:

```bash
fly secrets set ALLOWED_ORIGINS="https://your-actual-workers-url.workers.dev" \
    --config geometry-service/fly.toml
```

Or edit `fly.toml` `[env]` and re-run `fly deploy`.

The localhost defaults (`http://localhost:5173`, `http://localhost:5174`) are
always included automatically by the service — no env change needed for local dev.

---

## Step 4 — Update the Frontend (Cloudflare Pages/Workers)

The frontend reads `VITE_GEOMETRY_URL` at **build time** to construct the
geometry service URL. The default (`http://localhost:8000`) is dev-only. A
documented template lives at `.env.production.example` in the repo root — copy it
to `.env.production` and fill in the real fly.io URL before `npm run build`.

The frontend uses the async job endpoints (`POST /jobs`, `GET /jobs/{jobId}`)
for CAD downloads, plus `GET /files/{name}`, `GET /health`, and the legacy
`POST /generate` — all relative to `VITE_GEOMETRY_URL`.

After deploying the geometry service, rebuild and redeploy the frontend with:

```bash
# Local build pointing at fly.io:
VITE_GEOMETRY_URL=https://willbuild-geometry.fly.dev npm run build
```

On Cloudflare Pages/Workers, set this as a build environment variable:

| Variable            | Value                                   |
|---------------------|-----------------------------------------|
| `VITE_GEOMETRY_URL` | `https://willbuild-geometry.fly.dev`    |

Trigger a redeploy (push a commit or use the Cloudflare dashboard). Once the
frontend is live with this env var, the Download Tray will correctly fetch from
the geometry service instead of falling back to degraded mode.

---

## Cost Profile

- `shared-cpu-1x` + 1 GB memory
- `auto_stop_machines = "stop"` + `min_machines_running = 0` — the VM stops when
  idle and starts on the first request (cold-start ~2-5 s)
- Estimated: **~$0–10/mo** for light demo usage (billed per second of CPU time)

---

## Known Limitations / Out of Scope This Pass

### DWG output (ODA File Converter) — the 2D deliverable is DXF (Tyler 8/20)

**The tray ships DXF and says DXF.** Phase 0.7 made DWG the preferred 2D
deliverable and the card advertised `DXF · DWG on request` whenever the server
had no ODA binary — which was every deployment, and the "request" reached
nobody: no lead record, no line in the quote. The card now requests `dxf` and
labels it `DXF`, full stop. Turning DWG back on is a deliberate edit to
`DELIVERABLE_DEFS` in `src/components/OutputTray.tsx` AFTER the runbook below
lands the binary — not something that flips itself based on `/health`.

The service side is untouched: `POST /generate` with `formats: ["dwg"]` still
produces a DWG wherever ODA is installed. DWG export requires
the proprietary **ODA File Converter** binary. It is a **FREE download but
requires an ODA account**, so it is NOT on apt/Homebrew and cannot be fetched
anonymously at Docker build time. Server behaviour:

- **ODA present** → `dwg` is registered, `/health`'s `adapters` map reports
  `"dwg": true`, and a request for `dwg` returns both the `.dwg` and its `.dxf`
  (DXF stays available as the fallback file).
- **ODA absent** → `dwg` is not registered, `/health` omits it, and a request
  for `dwg` still returns 200 with the DXF plus the warning
  `"DWG skipped: ODA File Converter not installed"`. The frontend never asks
  for `dwg`, so it never sees this warning.

The Dockerfile bakes in everything ODA needs on debian-slim **except the binary
itself** (xvfb for headless, Qt5 runtime, X11/xcb libs, fontconfig,
hicolor-icon-theme). `dwg_adapter.py` wraps the ODA CLI in `xvfb-run` on linux
and `_find_oda()` checks, in order: `$ODA_PATH` → `PATH` → the macOS bundle →
`/usr/bin/ODAFileConverter` and other well-known linux paths.

**Runbook — enabling real DWG (steps 1-2 need a human; 3-4 are the automated build):**

1. **[HUMAN]** Create a free ODA account at <https://www.opendesign.com> and
   download the Linux **ODA File Converter** `.deb` (e.g.
   `ODAFileConverter_QT5_lnxX64_8.3dll_25.12.deb`). Host it somewhere the build
   can `curl` it (a private bucket, a release asset, or an internal URL). The
   URL is account-gated, so **do not commit it**.
2. **[HUMAN]** Note the download URL → this is `ODA_URL`.
3. **[AUTOMATED]** Build/deploy passing the URL as a build-arg:
   ```bash
   # From repo root:
   fly deploy --config geometry-service/fly.toml \
       --build-arg ODA_URL="https://.../ODAFileConverter_QT5_lnxX64_25.12.deb"
   ```
   (Local test build: `docker build -f geometry-service/Dockerfile \
   --build-arg ODA_URL="..." -t willbuild-geometry .`)
4. **[AUTOMATED]** The Dockerfile downloads + `dpkg -i` installs it onto PATH as
   `ODAFileConverter`. If it lands elsewhere, set `ODA_PATH` (env or
   `fly secrets set ODA_PATH=/path/to/ODAFileConverter`).

If `ODA_URL` is omitted the image builds fine **without** DWG (DXF fallback) —
no build failure.

**Verify:** `curl https://<app>.fly.dev/health` → `adapters` map contains
`"dwg": true`. Then request a DWG (see the async section below) and confirm a
`.dwg` file is returned. NOTE: whether a produced `.dwg` actually **opens in a
CAD viewer** is a **human check** — ODA is not installed in the dev/test
environment, so that end-to-end path is unverified here.

### RFA / Autodesk Platform Services (APS)

The `rfa` format adapter runs in **mock mode** by default (returns a placeholder
file). To enable real Revit Family file generation via APS:

1. Create an APS application at <https://aps.autodesk.com>
2. Set the following environment variables (via `fly secrets set` or `fly.toml [env]`):

   | Variable          | Description                     |
   |-------------------|---------------------------------|
   | `APS_CLIENT_ID`   | APS application client ID       |
   | `APS_CLIENT_SECRET` | APS application client secret |
   | `APS_ACTIVITY_ID` | Design Automation activity ID   |

3. Redeploy. When all three vars are present the adapter flips from mock to real.

---

## Async generation (`/jobs`) + caching — Phase 0.7

The synchronous `POST /generate` contract is unchanged. Phase 0.7 adds an
**additive** async job layer so the frontend can generate CAD without blocking
the UI and can show progress:

| Endpoint            | Request                              | Response |
|---------------------|--------------------------------------|----------|
| `POST /jobs`        | `{config, formats[], renderPng?}`    | `200 {jobId, configHash, status:"pending"\|"done", cached:bool}` — validates config exactly like `/generate` (422 with string `detail` on invalid; same standalone-only-pdf rule). If every requested format is already on disk for this config it returns `status:"done", cached:true` immediately; otherwise `status:"pending"` and background generation starts. |
| `GET /jobs/{jobId}` | —                                    | `200 {jobId, status:"pending"\|"running"\|"done"\|"error", progress:0..100, stage, files:[{format,filename,url,sizeBytes}], warnings:[], error}` — `files` populated only when `done`; `404` if the jobId is unknown. |
| `GET /files/{name}` | —                                    | The actual bytes (unchanged; path-traversal guarded). |

Implementation notes for operators:

- Generation runs on a process-local single-worker thread pool (build123d/OCCT
  is not concurrency-safe), so jobs are serialised but never block the event
  loop. This matches the single-worker uvicorn `CMD` in the Dockerfile.
- **Cache** is disk-based and keyed by the deterministic output filename
  (`WiLL_<configHash>_<configId8>.<ext>`). Because the pipeline is byte
  deterministic, a repeat request for the same config finds its files and skips
  the adapters entirely.
- The `out/` directory is **ephemeral** on fly.io (no volume mounted). With
  `auto_stop_machines`, a stopped machine loses its cache — this is acceptable
  for a concept service (regeneration is a few seconds). Mount a fly volume at
  `/app/out` if you want the cache to survive restarts.

**Weight:** the customer deliverable is produced entirely by the parametric kit
— there is **no** real-engineering-STEP passthrough in the download path (the
~87 MB figure from the Phase 0.6 spike was the raw SolidWorks STEP loaded
directly, never wired into `/generate`). Measured GVX sizes: STEP ~0.97 MB, IFC
~4.2 MB (largest), DXF ~0.03 MB, PDF ~0.003 MB, bundle ~0.27 MB — all well under
the ≤10 MB/file target, enforced by `tests/test_weight.py`.

**Verify async + cache after deploy:**

```bash
APP=https://<app>.fly.dev
CFG='{"config":{"configId":"deploy-check","pole":"alum-pole-20","baseCover":"bc-fluted","arm":"sh1-shepherds-hook","fixture":"gvx-pendant","finish":"matte-black","rev":1},"formats":["step","dxf"]}'
# 1. submit
JOB=$(curl -s -X POST $APP/jobs -H 'content-type: application/json' -d "$CFG" | tee /dev/stderr | python -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')
# 2. poll until done
curl -s $APP/jobs/$JOB | python -m json.tool
# 3. resubmit identical → expect "cached": true
curl -s -X POST $APP/jobs -H 'content-type: application/json' -d "$CFG" | python -m json.tool
```

| Check                                             | Status |
|---------------------------------------------------|--------|
| `/health`, `/generate`, `/files/{name}` live      | automated in CI |
| async `/jobs` lifecycle pending→done              | automated (`tests/test_jobs.py`) |
| cache hit on repeat request                       | automated (`tests/test_jobs.py`) |
| every GVX deliverable ≤ 10 MB                     | automated (`tests/test_weight.py`) |
| `/health` reports `dwg:true`                      | **needs human** — requires ODA installed in the image |
| produced `.dwg` opens in a CAD viewer             | **needs human** — ODA not installed in dev/test |
| `fly deploy` succeeds & app reachable             | **needs human** — flyctl auth is a manual step |
