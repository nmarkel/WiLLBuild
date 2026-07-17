# WiLL Geometry Service — production container
#
# NOTE: This image is large (~1-2 GB) due to OCP (Open CASCADE Technology) and
# build123d native shared libraries. This is expected and acceptable.
#
# Build context: repo root (one level above geometry-service/)
# so that both geometry-service/ and public/catalog.json are reachable.
#
# Typical invocation (from repo root):
#   docker build -f geometry-service/Dockerfile -t willbuild-geometry .
#
# Or via fly.io (see docs/DEPLOY.md):
#   fly deploy --config geometry-service/fly.toml  (from repo root)

FROM python:3.13-slim

# ── System dependencies required by OCP / build123d ─────────────────────────
# libGL, GLU, X11, Xext, Xrender are needed for OCP's rendering pipeline even
# in headless mode. libgomp1 is needed for OpenMP parallelism in the OCCT kernel.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglu1-mesa \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python dependencies (pinned in requirements.txt) ─────────────────────────
COPY geometry-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY geometry-service/app ./app

# ── Catalog — must be present at runtime ─────────────────────────────────────
# catalog.py default path resolves to <repo-root>/public/catalog.json which does
# NOT exist inside the container. We copy the file here and point CATALOG_PATH
# at the in-image location so load_catalog() finds it.
COPY public/catalog.json /app/catalog.json
ENV CATALOG_PATH=/app/catalog.json

# ── Output directory ──────────────────────────────────────────────────────────
RUN mkdir -p /app/out

# ── Runtime ───────────────────────────────────────────────────────────────────
# Port 8080 is required by fly.io (internal_port in fly.toml).
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
