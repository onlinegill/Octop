#!/usr/bin/env bash
# =============================================================================
# Build the Octop Docker image
#
# Usage:
#   bash docker/docker_build.sh [IMAGE_TAG] [extra docker build args...]
#
# Examples:
#   bash docker/docker_build.sh
#   bash docker/docker_build.sh myreg/octop:v1
#   bash docker/docker_build.sh octop:dev --no-cache
#
# Optional build acceleration (needs BuildKit; this script enables it by default):
#   PIP_INDEX_URL=https://pypi.org/simple \
#   PIP_TRUSTED_HOST=pypi.org \
#   NPM_REGISTRY=https://registry.npmjs.org/ \
#   APT_MIRROR=deb.debian.org \
#   bash docker/docker_build.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

IMAGE_TAG="${1:-octop:latest}"
shift 2>/dev/null || true

# BuildKit enables Dockerfile cache mounts, speeding up npm / pip / apt downloads
export DOCKER_BUILDKIT=1

BUILD_ARGS=()
if [ -n "${PIP_INDEX_URL:-}" ]; then
    BUILD_ARGS+=(--build-arg "PIP_INDEX_URL=${PIP_INDEX_URL}")
fi
if [ -n "${PIP_TRUSTED_HOST:-}" ]; then
    BUILD_ARGS+=(--build-arg "PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}")
fi
if [ -n "${NPM_REGISTRY:-}" ]; then
    BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
if [ -n "${NODE_MAX_OLD_SPACE_SIZE:-}" ]; then
    BUILD_ARGS+=(--build-arg "NODE_MAX_OLD_SPACE_SIZE=${NODE_MAX_OLD_SPACE_SIZE}")
fi
if [ -n "${APT_MIRROR:-}" ]; then
    BUILD_ARGS+=(--build-arg "APT_MIRROR=${APT_MIRROR}")
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║  Building the Octop Docker image                 ║"
echo "║  Tag: ${IMAGE_TAG}"
echo "╚══════════════════════════════════════════════════╝"
echo ""

docker build \
    -t "$IMAGE_TAG" \
    -f "${REPO_ROOT}/docker/Dockerfile" \
    "${BUILD_ARGS[@]}" \
    "$@" \
    "$REPO_ROOT"

echo ""
echo "✅ Build complete: ${IMAGE_TAG}"
echo ""
echo "Run example:"
echo "  docker run -d -p 8088:8088 -v octop-data:/data/.octop -e HOME=/data ${IMAGE_TAG}"
echo ""
echo "Or use Compose:"
echo "  docker compose -f docker/docker-compose.yml up -d"
