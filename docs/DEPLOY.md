# WiLLBuild Geometry Service — Deployment Runbook

This document covers deploying the `geometry-service` FastAPI backend to
[fly.io](https://fly.io) and wiring the Cloudflare Pages/Workers frontend to
point at the deployed URL.

---

## Prerequisites

- **flyctl** installed: `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
- A fly.io account with billing configured (`fly auth login`)
- Docker desktop (or equivalent) installed and running (fly.io builds remotely so
  a local Docker daemon is not strictly required, but useful for local testing)
- Access to the WiLLBuild Cloudflare Pages/Workers project to set env vars

---

## Docker Build Context

The Dockerfile lives at `geometry-service/Dockerfile` but **must be built from
the repo root** because it COPYs two subtrees:

| COPY source               | Destination in image    | Why                          |
|---------------------------|-------------------------|------------------------------|
| `geometry-service/app/`   | `/app/app/`             | FastAPI application code     |
| `public/catalog.json`     | `/app/catalog.json`     | Catalog data (not in gs dir) |

The `fly.toml` `[build]` section already sets `dockerfile = "geometry-service/Dockerfile"`,
so fly.io uses the repo root as the build context automatically when you run:

```bash
# From the repo root:
fly deploy --config geometry-service/fly.toml
```

For a local test build (no deploy):

```bash
# From repo root:
docker build -f geometry-service/Dockerfile -t willbuild-geometry .
docker run --rm -p 8080:8080 willbuild-geometry
# Then: curl http://localhost:8080/health
```

---

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
geometry service URL. The default (`http://localhost:8000`) is dev-only.

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

### DWG output (ODA File Converter)

DWG export requires the **ODA File Converter** binary which is not shipped in
the Docker image. Requests that include `"dwg"` in `formats` will receive a
warning in the response and the DXF file will be returned instead. The download
tray treats this gracefully.

Adding ODA to the image requires:
1. Downloading `ODAFileConverter_QT5_lnxX64_8.3dll_24.8.0.snap` (or similar)
2. Installing it in the Dockerfile via `apt`/manual extraction
3. Updating `geometry-service/app/adapters/dwg_adapter.py` to point at the
   installed binary path

This is deferred to a future pass.

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
