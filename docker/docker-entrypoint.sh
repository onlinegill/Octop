#!/usr/bin/env bash
# =============================================================================
# Octop container entrypoint
#
# Environment variables:
#   HOME                      — must be /data so ~/.octop maps to the data volume
#   OCTOP_DEFAULT_PASSWORD    — initial admin password (>=8 chars with letters and digits;
#                               if unset a random password is generated and the credentials are written to
#                               /data/.octop/credential.txt)
#   OCTOP_ADMIN_USERNAME      — initial admin username (default: admin)
#   OCTOP_ADMIN_DISPLAY_NAME  — optional display name
#   OCTOP_PORT                — service port (default: 8088)
#
# Password fallback (fixes issue #502): the app-side policy has a common weak-password blocklist (including
# Octop123); the old default password made octop init exit with "password is too common"
# and the container restart repeatedly. Now: when no password is set a strong random one is generated; a supplied
# one rejected by the policy also falls back to a random retry, so the container always completes first-time init.
# =============================================================================
set -euo pipefail

export HOME="${HOME:-/data}"
OCTOP_HOME="${OCTOP_HOME:-${HOME}/.octop}"
export OCTOP_HOME
DB_FILE="${OCTOP_HOME}/octop.db"
CREDENTIAL_FILE="${OCTOP_HOME}/credential.txt"
ADMIN_USERNAME="${OCTOP_ADMIN_USERNAME:-admin}"
ADMIN_DISPLAY_NAME="${OCTOP_ADMIN_DISPLAY_NAME:-Admin}"
PORT="${OCTOP_PORT:-8088}"

# Generate a random password (first char a letter, last char a digit, avoiding easily confused characters).
octop_random_password() {
    local letters='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
    local digits='23456789'
    local all="${letters}${digits}" n=16 out="" i b
    b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    out="${letters:$((b % ${#letters})):1}"
    for ((i = 1; i < n - 1; i++)); do
        b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
        out+="${all:$((b % ${#all})):1}"
    done
    b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    out+="${digits:$((b % ${#digits})):1}"
    printf '%s' "$out"
}

DEFAULT_PASSWORD="${OCTOP_DEFAULT_PASSWORD:-}"

if [ ! -f "$DB_FILE" ]; then
    echo "[entrypoint] first start, initializing Octop..."

    if [ -z "$DEFAULT_PASSWORD" ]; then
        DEFAULT_PASSWORD="$(octop_random_password)"
        echo "[entrypoint] OCTOP_DEFAULT_PASSWORD is unset; generated a random password."
    fi

    init_log="$(mktemp)"
    run_init() {
        octop init \
            --yes \
            --admin-username "$ADMIN_USERNAME" \
            --admin-password "$DEFAULT_PASSWORD" \
            ${ADMIN_DISPLAY_NAME:+--admin-display-name "$ADMIN_DISPLAY_NAME"} \
            >"$init_log" 2>&1
    }
    if ! run_init; then
        if grep -qiE 'password is too common|password too short|password must include' "$init_log"; then
            echo "[entrypoint] the supplied initial password failed the app password policy (too weak or too common); retrying with a random one ..."
            DEFAULT_PASSWORD="$(octop_random_password)"
            if ! run_init; then
                cat "$init_log" >&2 || true
                rm -f "$init_log"
                echo "[entrypoint] initialization failed; check the log above." >&2
                exit 1
            fi
        else
            cat "$init_log" >&2 || true
            rm -f "$init_log"
            echo "[entrypoint] initialization failed (not a password-policy issue). If the data directory has files but no octop.db, check the volume mount." >&2
            exit 1
        fi
    fi
    rm -f "$init_log"

    cat > "$CREDENTIAL_FILE" << EOF
Octop Login Credential
======================
URL:      http://<host>:${PORT}
Username: ${ADMIN_USERNAME}
Password: ${DEFAULT_PASSWORD}

Please change this password after first login!
  - Via Web: avatar menu → Change password
  - Via CLI: docker exec -it <container> octop user passwd --username $ADMIN_USERNAME

This file is rewritten whenever the initial password is (re)generated here.
If you changed the password inside the Web console, that password wins.
EOF
    chmod 600 "$CREDENTIAL_FILE"
    echo "[entrypoint] credentials saved to: $CREDENTIAL_FILE"
fi

if [ $# -eq 0 ]; then
    echo "[entrypoint] starting Octop on port $PORT..."
    exec octop run --host 0.0.0.0 --port "$PORT"
fi

if [ "$1" = "octop" ]; then
    echo "[entrypoint] exec: $*"
    exec "$@"
fi

echo "[entrypoint] exec: $*"
exec "$@"
