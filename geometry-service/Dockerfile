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

# ── ODA File Converter (real DWG output) ────────────────────────────────────
# ODA File Converter is a proprietary, FREE download that requires an ODA
# account — it is NOT on apt/Homebrew, so it cannot be fetched anonymously at
# build time.  Supply its download URL at build time:
#
#   docker build -f geometry-service/Dockerfile \
#       --build-arg ODA_URL="https://.../ODAFileConverter_QT5_lnxX64_8.3dll_25.12.deb" \
#       -t willbuild-geometry .
#
# When ODA_URL is empty (the default) the image still builds and runs — the
# service simply falls back to DXF for the 2D deliverable and emits the
# DWG_WARNING (see app/adapters/dwg_adapter.py).  See docs/DEPLOY.md.
#
# ODA File Converter is a Qt GUI app that needs an X server even for CLI
# conversions, so we install xvfb (virtual framebuffer); dwg_adapter.py wraps
# the invocation in `xvfb-run` on linux.  Qt5 runtime + X11/xcb + fontconfig +
# hicolor-icon-theme cover the GUI toolkit's shared-library needs.
ARG ODA_URL=""
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libqt5core5a \
    libqt5gui5 \
    libqt5widgets5 \
    libqt5printsupport5 \
    libxcb1 \
    libxcb-render0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-shm0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-xinerama0 \
    libxcb-xkb1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libfontconfig1 \
    libfreetype6 \
    libdbus-1-3 \
    hicolor-icon-theme \
    ca-certificates \
    curl \
    && if [ -n "$ODA_URL" ]; then \
         echo "Installing ODA File Converter from $ODA_URL" && \
         curl -fsSL "$ODA_URL" -o /tmp/oda.deb && \
         (dpkg -i /tmp/oda.deb || apt-get install -y -f --no-install-recommends) && \
         rm -f /tmp/oda.deb && \
         (command -v ODAFileConverter && echo "ODA installed OK" || echo "WARN: ODAFileConverter not on PATH after install"); \
       else \
         echo "ODA_URL not provided — building WITHOUT DWG support (DXF fallback)."; \
       fi \
    && rm -rf /var/lib/apt/lists/*

# Qt needs the xcb platform plugin under xvfb; make it explicit and headless.
ENV QT_QPA_PLATFORM=xcb
# If a specific ODA install path is needed, set ODA_PATH here or at runtime;
# _find_oda() checks $ODA_PATH first, then PATH, then well-known locations.

WORKDIR /app

# ── Python dependencies (pinned in requirements.txt) ─────────────────────────
COPY geometry-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY geometry-service/app ./app

# ── Service assets ────────────────────────────────────────────────────────────
# assets/shells: the gated exterior-shell GLBs (committed) that back the
# shell-accurate STEP/IFC and the 2D drawing sheet — app/shellgeom.py resolves
# them relative to the app package, so omitting this COPY silently degrades
# every geometry deliverable to the parametric kit (found in Phase 0.19; the
# pre-0.19 image shipped without them).
# assets/customer-step: the customer-cleared simplified STEPs, staged by
# scripts/stage-customer-step.py (run it before building — the files are
# gitignored, only manifest.json is committed). An unstaged build still works:
# factory-cad/ degrades to the documented README-MISSING note. The runtime can
# also point CUSTOMER_STEP_DIR at an external source (e.g. an S3-synced dir)
# instead of the baked copies; bytes must hash to manifest.json either way.
COPY geometry-service/assets ./assets

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
