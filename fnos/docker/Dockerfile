# syntax=docker/dockerfile:1
# =============================================================================
# Octop — FnOS-specific build (from repository source, installs all addons)
#
# Same as the upstream docker/Dockerfile, but explicitly installs the
# desktop extra:
#   - desktop  (mss / pynput / pillow, desktop control addon)
# Playwright Chromium is no longer preinstalled; browser automation can be
# installed on demand from the console.
#
# The build context must be the repository root (fnpack / CI use the repo
# root as context):
#   docker build -f fnos/docker/Dockerfile -t ghcr.io/onlinegill/octop:latest .
#
# Optional acceleration build-args:
#   PIP_INDEX_URL / PIP_TRUSTED_HOST / NPM_REGISTRY / APT_MIRROR
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1 — frontend build (React / TypeScript → src/octop/dashboard)
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder

ARG NODE_MAX_OLD_SPACE_SIZE=2048
ARG NPM_REGISTRY=
WORKDIR /build/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm ci --prefer-offline --no-audit

COPY dashboard/ ./

RUN mkdir -p ../src/octop/dashboard
RUN NODE_ENV=production NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" npx vite build

# ---------------------------------------------------------------------------
# Stage 2 — Python runtime + prebuilt frontend + all addons
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

LABEL maintainer="onlinegill"
LABEL org.opencontainers.image.title="Octop"
LABEL org.opencontainers.image.description="Smarter self-hosted AI assistant — multi-user, multi-agent (FnOS build with all addons)."
LABEL org.opencontainers.image.source="https://github.com/onlinegill/Octop"
LABEL org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/data \
    OCTOP_BIND_HOST=0.0.0.0 \
    OCTOP_PORT=8088 \
    OCTOP_LOG_LEVEL=info \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_INDEX_URL=https://pypi.org/simple

ARG APT_MIRROR=

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    if [ -n "$APT_MIRROR" ]; then \
        printf 'Types: deb\nURIs: https://%s/debian\nSuites: trixie trixie-updates\nComponents: main contrib non-free non-free-firmware\n\nTypes: deb\nURIs: https://%s/debian-security\nSuites: trixie-security\nComponents: main contrib non-free non-free-firmware\n' \
            "$APT_MIRROR" "$APT_MIRROR" > /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /uvx /bin/

WORKDIR /app

# This layer's cache is reused when only sources change (install with uv pip,
# avoiding uv.lock freeze conflicts)
COPY pyproject.toml README.md LICENSE ./
COPY src/ ./src/
COPY --from=frontend-builder /build/src/octop/dashboard/ ./src/octop/dashboard/

COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install the project + desktop extra (Playwright Chromium is not preinstalled;
# it can be downloaded on demand from the console).
# UV_DEFAULT_INDEX points at PyPI; an alternative index can be supplied via
# UV_INDEX_URL. Keeping PyPI as the fallback avoids build failures when a
# freshly published package has not yet been synced to a mirror.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv /app/.venv \
    && UV_DEFAULT_INDEX=https://pypi.org/simple \
       uv pip install --python /app/.venv ".[desktop]" \
    && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/* /tmp/*

ENV PATH="/app/.venv/bin:$PATH" \
    PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

RUN mkdir -p /data/.octop

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD ["sh", "-c", "curl -f http://localhost:${OCTOP_PORT:-8088}/api/health || exit 1"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD []
