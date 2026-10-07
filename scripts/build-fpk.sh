#!/usr/bin/env bash
# =============================================================================
# Build the Octop FeiNiu (fnOS) install package (.fpk)
#
# Package directly with the official fnpack CLI (fnpack validates the manifest / cmd /
# config / wizard / app layout before producing the .fpk, so the output exactly matches fnOS install validation).
#
# Usage (run from the repository root):
#   bash scripts/build-fpk.sh docker      # build the Docker variant -> dist/Octop-fnos-docker-<ver>.fpk
#   bash scripts/build-fpk.sh native      # build the native (non-Docker) variant -> dist/Octop-fnos-native-<ver>.fpk
#   bash scripts/build-fpk.sh             # build both
#
# Environment variables:
#   FPK_NAME_PREFIX  output filename prefix, default "octop"
#                    e.g. FPK_NAME_PREFIX=Octop-fnos produces Octop-fnos-docker-<ver>.fpk / Octop-fnos-native-<ver>.fpk
#   FPK_ITER         iteration number, empty by default
#                    e.g. FPK_ITER=01 produces ...-<ver>-01.fpk (usually unnecessary; releases follow the version number)
#   FPK_ARCH         native build architecture. arm64 -> Octop-fnos-native-arm64-<ver>.fpk,
#                    and writes manifest platform=arm64. Empty or any other value keeps the existing x86 package name.
#                    fnpack only ships linux-amd64, so ARM packages should be built on an amd64 host
#                    (install site-packages on aarch64 first, then copy it over).
#
# Notes:
#   - On Linux CI, fnpack is downloaded automatically (version in FNPACK_VERSION, default 1.2.3);
#     curl retries transient errors such as RST / timeouts. On success it lands in .verify/fnpack so both the local machine and
#     the Actions cache can reuse it.
#   - If .verify/fnpack(.exe) already exists locally it is reused directly with no network download.
#   - The version comes from the repo-root pyproject.toml and is injected into the manifest version field
#     (the manifest uses key=value with no spaces, hence the `^version=` match).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"

# Use a temp dir inside the repo so a Windows-style TMPDIR is not misparsed under Git Bash
TMP="$(mktemp -d "$ROOT/.buildtmp.XXXXXX")"
cleanup() { rm -rf "$TMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Accept full PEP 440 strings in quotes (e.g. 1.0.2b1), not digits-only.
VER="$(sed -nE 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/pyproject.toml" | head -1)"
[ -n "$VER" ] || { echo "Could not parse the version from pyproject.toml"; exit 1; }
case "$VER" in
  *[[:space:]]*|*[\"\']*)
    echo "Parsed version is invalid: $VER"
    exit 1
    ;;
esac
echo "[build-fpk] Octop version: $VER"

# Output filename prefix and iteration number (passed in by CI for the Octop-fnos-docker-0.9.30.fpk style)
PREFIX="${FPK_NAME_PREFIX:-octop}"
ITER_SUFFIX=""
if [ -n "${FPK_ITER:-}" ]; then
  ITER_SUFFIX="-$FPK_ITER"
fi
echo "[build-fpk] package prefix: $PREFIX, iteration suffix: ${ITER_SUFFIX:-<none>}"

# --- Fetch the fnpack CLI ---
# Keep FNPACK_VERSION in sync with .github/workflows/fnos-build-fpk.yml cache key.
FNPACK_VER="${FNPACK_VERSION:-1.2.3}"
VERIFY_DIR="$ROOT/.verify"
mkdir -p "$VERIFY_DIR"
if [ -f "$VERIFY_DIR/fnpack.exe" ]; then
  chmod +x "$VERIFY_DIR/fnpack.exe" 2>/dev/null || true
fi
if [ -f "$VERIFY_DIR/fnpack" ]; then
  chmod +x "$VERIFY_DIR/fnpack" 2>/dev/null || true
fi
FNPACK=""
if [ -x "$VERIFY_DIR/fnpack.exe" ]; then
  FNPACK="$VERIFY_DIR/fnpack.exe"
elif [ -x "$VERIFY_DIR/fnpack" ]; then
  FNPACK="$VERIFY_DIR/fnpack"
else
  OS="$(uname -s)"
  case "$OS" in
    Linux)  FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VER}-linux-amd64" ;;
    Darwin) FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VER}-darwin-amd64" ;;
    *)      FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VER}-windows-amd64" ;;
  esac
  case "$OS" in
    Linux|Darwin) FNPACK="$VERIFY_DIR/fnpack" ;;
    *)            FNPACK="$VERIFY_DIR/fnpack.exe" ;;
  esac
  echo "[build-fpk] downloading fnpack: $FNPACK_URL"
  curl -fsSL --connect-timeout 20 --max-time 120 \
    --retry 5 --retry-delay 2 --retry-all-errors \
    -o "${FNPACK}.partial" "$FNPACK_URL"
  mv "${FNPACK}.partial" "$FNPACK"
  chmod +x "$FNPACK"
  if [ ! -s "$FNPACK" ]; then
    echo "[build-fpk] downloaded fnpack is empty: $FNPACK_URL"
    rm -f "$FNPACK"
    exit 1
  fi
fi
echo "[build-fpk] using fnpack: $FNPACK"

mkdir -p "$OUT"

build_one() {
  local KIND="$1" PKG OUTNAME
  case "$KIND" in
    docker)
      PKG="$ROOT/fnos/docker"
      OUTNAME="${PREFIX}-docker-${VER}${ITER_SUFFIX}.fpk"
      ;;
    native)
      PKG="$ROOT/fnos/native"
      if [ "${FPK_ARCH:-}" = "arm64" ]; then
        OUTNAME="${PREFIX}-native-arm64-${VER}${ITER_SUFFIX}.fpk"
      else
        OUTNAME="${PREFIX}-native-${VER}${ITER_SUFFIX}.fpk"
      fi
      ;;
    *) echo "Unknown kind: $KIND"; return 1 ;;
  esac

  local BUILD="$TMP/$KIND"
  rm -rf "$BUILD"; mkdir -p "$BUILD"

  # Copy the whole package directory (manifest / cmd / config / wizard / app / ICON* / LICENSE)
  cp -r "$PKG/." "$BUILD/"

  # Inject the shared function library (find_python312 / fix_ownership_and_perms / free_octop_ports),
  # a single repo source scripts/fnos/common.sh; cmd/bin scripts all source cmd/common.sh.
  if [ -f "$ROOT/scripts/fnos/common.sh" ]; then
    cp "$ROOT/scripts/fnos/common.sh" "$BUILD/cmd/common.sh"
  fi

  # Inject the version into the manifest (the manifest is key=value with no spaces)
  sed -i.bak "s/^version=.*/version=$VER/" "$BUILD/manifest" && rm -f "$BUILD/manifest.bak"

  # Write platform=arm64 for ARM native builds so x86 fnOS does not install aarch64 site-packages by mistake.
  if [ "$KIND" = "native" ] && [ "${FPK_ARCH:-}" = "arm64" ]; then
    sed -i.bak "s/^platform=.*/platform=arm64/" "$BUILD/manifest" && rm -f "$BUILD/manifest.bak"
    echo "[build-fpk] native manifest platform=arm64"
  fi

  # Write the architecture marker for native builds, checked on install/startup to avoid installing the wrong package.
  if [ "$KIND" = "native" ]; then
    local packed_arch
    case "${FPK_ARCH:-}" in
      arm64) packed_arch=arm64 ;;
      amd64) packed_arch=amd64 ;;
      *)
        case "$(uname -m)" in
          aarch64|arm64) packed_arch=arm64 ;;
          *) packed_arch=amd64 ;;
        esac
        ;;
    esac
    printf '%s\n' "$packed_arch" > "$BUILD/cmd/fpk-arch"
    echo "[build-fpk] native cmd/fpk-arch=$packed_arch"
  fi

  # Pin the Docker compose to the same image tag as this package; test packages can override with FPK_IMAGE_TAG=latest.
  if [ "$KIND" = "docker" ]; then
    local compose="$BUILD/app/docker/docker-compose.yaml" image_tag="${FPK_IMAGE_TAG:-$VER}"
    if [ -f "$compose" ]; then
      sed -i.bak -E "s#ghcr.io/onlinegill/octop:[^[:space:]]+#ghcr.io/onlinegill/octop:${image_tag}#" "$compose"
      rm -f "${compose}.bak"
      echo "[build-fpk] compose image: ghcr.io/onlinegill/octop:${image_tag}"
    fi
  fi

  echo "[build-fpk] fnpack validates and packages $KIND ..."
  # fnpack validates manifest/cmd/config/wizard/app then writes <appname>.fpk in the current directory
  # fnpack.exe on Windows cannot parse Git-Bash /c/... paths, so convert to native Windows paths.
  local DIR="$BUILD"
  case "$FNPACK" in
    *.exe) DIR="$(cygpath -w -m "$BUILD")" ;;
  esac
  ( cd "$BUILD" && "$FNPACK" build --directory "$DIR" )

  local SRC
  SRC="$(ls "$BUILD"/*.fpk 2>/dev/null | head -1)"
  [ -n "$SRC" ] || { echo "[build-fpk] fnpack artifact not found"; return 1; }

  mv "$SRC" "$OUT/$OUTNAME"
  echo "[build-fpk] artifact: $OUT/$OUTNAME ($(stat -c%s "$OUT/$OUTNAME") bytes)"
  echo "[build-fpk] outer contents:"
  tar -tzf "$OUT/$OUTNAME"
}

if [ $# -eq 0 ]; then
  build_one docker
  build_one native
else
  for k in "$@"; do build_one "$k"; done
fi
