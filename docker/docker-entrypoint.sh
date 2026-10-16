#!/usr/bin/env bash
# =============================================================================
# Octop container entrypoint
#
# Environment variables:
#   HOME                      — must be /data so ~/.octop maps to the data volume
#   OCTOP_DEFAULT_PASSWORD    — initial admin password (>=8 chars with letters and digits).
#                               If set and valid, octop init creates the account.
#                               If unset, completes first-time setup via Web Wizard.
#   OCTOP_ADMIN_USERNAME      — initial admin username (default: admin)
#   OCTOP_ADMIN_DISPLAY_NAME  — optional display name
#   OCTOP_PORT                — service port (default: 8088)
#
# Init Marker (issue #1866): External databases (PostgreSQL) don't store octop.db on volume.
# When octop init completes, /data/.octop/.initialized is written to avoid re-init loops.
# =============================================================================
set -euo pipefail

export HOME="${HOME:-/data}"
OCTOP_HOME="${OCTOP_HOME:-${HOME}/.octop}"
export OCTOP_HOME
DB_FILE="${OCTOP_HOME}/octop.db"
INIT_MARKER="${OCTOP_HOME}/.initialized"
CREDENTIAL_FILE="${OCTOP_HOME}/credential.txt"
WIZARD_FILE="${OCTOP_HOME}/octop-login.txt"
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
    if ! printf '%s' "$pw" | grep -q '[A-Za-z]'; then
        echo "密码必须同时包含字母和数字" >&2
        return 1
    fi
    if ! printf '%s' "$pw" | grep -q '[0-9]'; then
        echo "密码必须同时包含字母和数字" >&2
        return 1
    fi
    lower="$(printf '%s' "$pw" | tr 'A-Z' 'a-z')"
    case " ${_OCTOP_COMMON_PASSWORDS} " in
        *" ${lower} "*)
            echo "密码过于常见" >&2
            return 1
            ;;
    esac
    return 0
}

# 向导口令写到数据卷，并让 $HOME/octop-login.txt 指向同一文件（服务端读 HOME）。
octop_seed_wizard_password() {
    mkdir -p "$OCTOP_HOME" "$HOME"
    if [ ! -s "$WIZARD_FILE" ]; then
        octop_random_password > "$WIZARD_FILE"
        chmod 600 "$WIZARD_FILE"
    fi
    local home_file="${HOME}/octop-login.txt"
    if [ "$home_file" = "$WIZARD_FILE" ]; then
        return 0
    fi
    if [ -f "$home_file" ] && [ ! -L "$home_file" ]; then
        cp -f "$home_file" "$WIZARD_FILE"
        chmod 600 "$WIZARD_FILE"
        return 0
    fi
    ln -sfn "$WIZARD_FILE" "$home_file"
}

octop_write_setup_hint() {
    local pw
    pw="$(tr -d '\n\r' < "$WIZARD_FILE")"
    cat > "$CREDENTIAL_FILE" << EOF
Octop Setup Required
URL:      http://<host>:${PORT}

No admin account has been created yet.
Open the dashboard and complete the setup wizard.

Wizard password: ${pw}

This password only unlocks the wizard (same value as octop-login.txt).
Choose the admin username and password in the browser.
EOF
    chmod 600 "$CREDENTIAL_FILE"
}

octop_write_admin_credential() {
    local password="$1"
    cat > "$CREDENTIAL_FILE" << EOF
Octop Login Credential
URL:      http://<host>:${PORT}
Username: ${ADMIN_USERNAME}
Password: ${password}

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
}

# Allow tests to source helpers without starting the server.
if [ "${OCTOP_ENTRYPOINT_LIB:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

octop_entrypoint_main "$@"
