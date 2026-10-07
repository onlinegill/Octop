#!/bin/bash
#
# Octop FnOS packaging shared library.
# Single source of truth in the repo: scripts/fnos/common.sh
# At package time scripts/build-fpk.sh injects it into the package as cmd/common.sh;
# the cmd and app/bin scripts of fnos/docker/ and fnos/native/ all source this file,
# avoiding duplicate maintenance of find_python312 / fix_ownership_and_perms / free_octop_ports.
#
set -u

# ---------------------------------------------------------------------------
# Kill a pid and its descendants (TERM first; the caller decides on KILL).
# The native start runs bin/octop via runuser; the PID file usually holds the shell, while
# the process listening on 8089 is the Python child after exec; killing only the shell leaves an orphan holding the port.
# ---------------------------------------------------------------------------
octop_kill_pid_tree() {
    local pid="${1:-}" sig="${2:-TERM}" child
    [ -n "$pid" ] || return 0
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
        octop_kill_pid_tree "$child" "$sig"
    done
    kill -s "$sig" "$pid" 2>/dev/null || true
}

octop_port_pids() {
    local port="$1" pids
    pids="$(ss -ltnp 2>/dev/null | grep -E "[:.]${port}([[:space:]]|$)" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)" || true
    if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "${port}/tcp" 2>/dev/null | tr -cs '[:digit:]' ' ')" || true
    fi
    if [ -z "$pids" ] && command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti tcp:"$port" 2>/dev/null)" || true
    fi
    printf '%s' "$pids"
}

# Wait for a set of pids to exit. The first arg is the number of 0.2s polls, the rest are pids.
octop_wait_pids_gone() {
    local rounds="${1:-15}" pid still i
    shift
    for i in $(seq 1 "$rounds"); do
        still=0
        for pid in "$@"; do
            [ -n "$pid" ] || continue
            if kill -0 "$pid" 2>/dev/null; then
                still=1
                break
            fi
        done
        [ "$still" = 0 ] && return 0
        sleep 0.2
    done
    return 1
}

# bin/octop execs into python -m octop.cli.main run, so the command line no longer contains the launcher path.
# Identify this package's service process by the OCTOP_INSTALL_MODE=fpk-native written at install time.
octop_fpk_native_run_pids() {
    local pid
    for pid in $(pgrep -f -- 'octop.cli.main run' 2>/dev/null || true); do
        [ -n "$pid" ] || continue
        if tr '\0' '\n' < "/proc/${pid}/environ" 2>/dev/null | grep -qx 'OCTOP_INSTALL_MODE=fpk-native'; then
            printf '%s\n' "$pid"
        fi
    done
}

octop_signal_pids() {
    local sig="$1" pid
    shift
    for pid in "$@"; do
        [ -n "$pid" ] || continue
        octop_kill_pid_tree "$pid" "$sig"
    done
}

# ---------------------------------------------------------------------------
# Free the Octop ports and clean up this app's leftover processes.
# No args: 8088=Docker variant + 8089=native variant (used on install/uninstall).
# With args: free only the given ports (native stop clears only 8089 to avoid touching the Docker variant).
# Only clean up: (1) processes holding these ports; (2) not-yet-exec'd launchers under this install dir;
# (3) `octop.cli.main run` with OCTOP_INSTALL_MODE=fpk-native (only when this run
# is freeing 8089). Do not use a broad `pgrep -f octop`.
# ---------------------------------------------------------------------------
free_octop_ports() {
    local port pid pids pat appdir ports
    if [ "$#" -gt 0 ]; then
        ports="$*"
    else
        ports="8088 8089"
    fi
    for port in $ports; do
        pids="$(octop_port_pids "$port")"
        octop_signal_pids TERM $pids
        for pid in $pids; do
            [ -n "$pid" ] || continue
            echo "[octop] sent TERM to process ${pid} holding ${port}" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>/dev/null || true
        done
        octop_wait_pids_gone 10 $pids || true
        octop_signal_pids KILL $pids
        for pid in $pids; do
            [ -n "$pid" ] || continue
            if kill -0 "$pid" 2>/dev/null; then
                echo "[octop] force-KILLed process ${pid} holding ${port}" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>/dev/null || true
            fi
        done
    done

    appdir="${TRIM_APPDEST:-/var/apps/octop-native}"
    for pat in "$appdir/bin/octop" "$appdir/app/bin/octop"; do
        pids="$(pgrep -f -- "$pat" 2>/dev/null | tr '\n' ' ')" || true
        [ -z "$pids" ] && continue
        echo "[octop] found leftover service process for this app ($pat): $pids, cleaning up" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>&1 || true
        octop_signal_pids TERM $pids
        octop_wait_pids_gone 10 $pids || true
        octop_signal_pids KILL $pids
    done

    case " ${ports} " in
        *" 8089 "*)
            pids="$(octop_fpk_native_run_pids | tr '\n' ' ')"
            if [ -n "$pids" ]; then
                echo "[octop] found leftover fpk-native run process: $pids, cleaning up" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>&1 || true
                octop_signal_pids TERM $pids
                octop_wait_pids_gone 10 $pids || true
                octop_signal_pids KILL $pids
            fi
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Fix ownership/permissions of the data directory and .env.
# install_callback/config_callback write .env as root; without chown to the runtime user,
# the service (octop-native) gets Permission denied on `. "$PKGVAR/.env"` at startup.
# If the directory had an ACL, a plain chmod squashes the mask to ---, so clear it with setfacl -b.
# ---------------------------------------------------------------------------
fix_ownership_and_perms() {
    local pkgvar="$1" envfile="$2"
    local octop_user="octop-native"
    id "$octop_user" >/dev/null 2>&1 || {
        echo "[octop] warning: account ${octop_user} does not exist, skipping data-dir chown (the service will fall back to running as root)" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>&1 || true
        return 0
    }

    # 1) Chown the app data directory and .env to the runtime user
    chown -R "$octop_user:$octop_user" "$pkgvar" 2>/dev/null || true
    chmod 700 "$pkgvar" 2>/dev/null || true
    [ -f "$envfile" ] && chmod 600 "$envfile" 2>/dev/null || true

    # 2) Clear the ACL so a chmod squashing the mask to --- does not keep it unreadable
    if command -v setfacl >/dev/null 2>&1; then
        setfacl -b "$pkgvar" 2>/dev/null || true
        [ -f "$envfile" ] && setfacl -b "$envfile" 2>/dev/null || true
    fi

    # 3) Shared data directory (@appshare): ensure correct ownership and traversability
    if [ -n "${TRIM_DATA_SHARE_PATHS:-}" ]; then
        local ds="${TRIM_DATA_SHARE_PATHS%%:*}"
        chown -R "$octop_user:$octop_user" "$ds" 2>/dev/null || true
        local share_root="$ds"
        while [ "$share_root" != "/" ] && [ "$(basename "$(dirname "$share_root")")" != "@appshare" ]; do
            share_root="$(dirname "$share_root")"
        done
        chown "$octop_user:$octop_user" "$share_root" 2>/dev/null || true
        chmod 755 "$share_root" 2>/dev/null || true
        if command -v setfacl >/dev/null 2>&1; then
            setfacl -b "$share_root" 2>/dev/null || true
            setfacl -b "$ds" 2>/dev/null || true
        fi
    fi

    echo "[octop] fixed data-dir/.env ownership and permissions (${octop_user}:${octop_user})" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>&1 || true
}

# ---------------------------------------------------------------------------
# Native FPK architecture: build-fpk.sh writes cmd/fpk-arch (amd64 / arm64).
# Old packages lack this file, so skip to avoid breaking the upgrade path.
# Tests can set OCTOP_FPK_ARCH_FILE / OCTOP_FPK_HOST_ARCH.
# ---------------------------------------------------------------------------
octop_host_fpk_arch() {
    if [ -n "${OCTOP_FPK_HOST_ARCH:-}" ]; then
        printf '%s' "$OCTOP_FPK_HOST_ARCH"
        return 0
    fi
    case "$(uname -m)" in
        aarch64|arm64) printf '%s' arm64 ;;
        x86_64|amd64) printf '%s' amd64 ;;
        *) uname -m ;;
    esac
}

octop_packed_fpk_arch() {
    local f here
    if [ -n "${OCTOP_FPK_ARCH_FILE:-}" ]; then
        [ -f "$OCTOP_FPK_ARCH_FILE" ] || return 1
        tr -d '[:space:]' < "$OCTOP_FPK_ARCH_FILE"
        return 0
    fi
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for f in "$here/fpk-arch" "/var/apps/octop-native/cmd/fpk-arch"; do
        if [ -f "$f" ]; then
            tr -d '[:space:]' < "$f"
            return 0
        fi
    done
    return 1
}

octop_assert_native_arch() {
    local packed host
    packed="$(octop_packed_fpk_arch 2>/dev/null || true)"
    [ -n "$packed" ] || return 0
    host="$(octop_host_fpk_arch)"
    if [ "$packed" != "$host" ]; then
        echo "This native package is ${packed} but this device is ${host}. Use the package matching the architecture: x86_64 uses Octop-fnos-native, ARM64 uses Octop-fnos-native-arm64. On ARM fnOS with Docker installed, prefer the Docker variant."
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Locate Python 3.12 on the fnOS system (provided by the app store).
# ---------------------------------------------------------------------------
find_python312() {
    local cand py
    for cand in \
        /var/apps/python312/target/bin/python3.12 \
        /usr/local/bin/python3.12 \
        /var/apps/python3.12/bin/python3.12 \
        python3.12
    do
        if command -v "$cand" >/dev/null 2>&1; then
            py="$(command -v "$cand")"
            if "$py" -c 'import sys; assert sys.version_info[:2] == (3,12)' >/dev/null 2>&1; then
                printf '%s' "$py"
                return 0
            fi
        fi
    done
    return 1
}

# ---------------------------------------------------------------------------
# Reuse fnOS's installed Node.js (developer tools) for the expert shell / skills / npx.
# Do not force-install: leave PATH unchanged if not found. Leave it alone if already on PATH.
# Tests can set OCTOP_FNOS_NODE_BIN_DIRS (colon-separated).
# ---------------------------------------------------------------------------
octop_fnos_node_candidate_dirs() {
    local d oldifs
    if [ -n "${OCTOP_FNOS_NODE_BIN_DIRS:-}" ]; then
        oldifs="$IFS"
        IFS=':'
        for d in $OCTOP_FNOS_NODE_BIN_DIRS; do
            [ -n "$d" ] && printf '%s\n' "$d"
        done
        IFS="$oldifs"
        return 0
    fi
    printf '%s\n' \
        /usr/local/bin \
        /var/apps/nodejs/target/bin \
        /var/apps/nodejs/bin \
        /var/apps/NodeJS/target/bin \
        /var/apps/node/target/bin
    for d in /var/apps/nodejs*/target/bin /var/apps/node[0-9]*/target/bin /var/apps/nodejs*/bin; do
        if [ -d "$d" ]; then
            printf '%s\n' "$d"
        fi
    done
}

octop_prepend_fnos_node_path() {
    local dir
    if command -v node >/dev/null 2>&1; then
        return 0
    fi
    while IFS= read -r dir; do
        [ -n "$dir" ] || continue
        if [ -x "$dir/node" ]; then
            case ":${PATH:-}:" in
                *":$dir:"*) ;;
                *) PATH="$dir${PATH:+:$PATH}" ;;
            esac
            export PATH
            return 0
        fi
    done <<EOF
$(octop_fnos_node_candidate_dirs)
EOF
    return 0
}

# ---------------------------------------------------------------------------
# Admin password: generation / validation / credential fallback persistence.
#
# Background (issue #502): the weak-password blocklist in src/octop/infra/users/password.py contains
# "octop123", while the old FPK hard-coded the initial password as Octop123, so octop init on first
# startup exits with "password is too common" and the app never starts. These functions
# let the install wizard own password setup: a user-chosen one (validated locally first so no invalid password reaches init)
# or an auto-generated strong random one, with a fallback saved to the data directory so the user never loses the password.
# ---------------------------------------------------------------------------

# Wizard field sanitization: strip characters that would break .env / JSON / shell.
# Equivalent to the legacy sanitize() in the callback scripts, but also strips backslashes (a JSON injection surface).
octop_sanitize_value() {
    printf '%s' "$1" | tr -d '\n\r"'"'"'\\'
}

# Generate a random password: first char a letter, last char a digit, all from an alphanumeric set without easily confused characters.
# Length defaults to 16 (at least 8). Relies on /dev/urandom (available on fnOS and in containers).
octop_generate_password() {
    local letters='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
    local digits='23456789'
    local all="${letters}${digits}"
    local n="${1:-16}" out="" i b
    case "$n" in ''|*[!0-9]*) n=16 ;; esac
    [ "$n" -lt 8 ] && n=8
    b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    [ -n "$b" ] || b=7
    out="${letters:$((b % ${#letters})):1}"
    for ((i = 1; i < n - 1; i++)); do
        b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
        [ -n "$b" ] || b=$((RANDOM % 255))
        out+="${all:$((b % ${#all})):1}"
    done
    b="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    [ -n "$b" ] || b=3
    out+="${digits:$((b % ${#digits})):1}"
    printf '%s' "$out"
}

# Validate a password against the app-side policy (src/octop/infra/users/password.py):
# >=8 chars, contains both a letter and a digit, and is not in the common weak-password blocklist.
# The blocklist must stay in sync with password.py's _COMMON_PASSWORDS (covered by a unit test).
# On failure prints the reason to stderr and returns non-zero.
octop_validate_password() {
    local pw="$1" reason=""
    if [ -z "$pw" ]; then
        reason="Password is empty"
    elif [ "${#pw}" -lt 8 ]; then
        reason="Password must be at least 8 characters"
    elif [ "${#pw}" -gt 64 ]; then
        reason="Password must not exceed 64 characters"
    elif ! printf '%s' "$pw" | grep -q '[A-Za-z]'; then
        reason="Password must contain both letters and digits"
    elif ! printf '%s' "$pw" | grep -q '[0-9]'; then
        reason="Password must contain both letters and digits"
    elif printf '%s' "$pw" | tr 'A-Z' 'a-z' | grep -qx \
        -e 'password' -e 'password1' -e 'password12' -e 'password123' \
        -e '12345678' -e '123456789' -e 'qwerty123' -e 'admin123' \
        -e 'welcome1' -e 'letmein1' -e 'changeme1' -e 'octop123' \
        -e 'abc12345' -e 'iloveyou1'
    then
        reason="Password is too common; please choose a stronger one"
    fi
    if [ -n "$reason" ]; then
        echo "$reason" >&2
        return 1
    fi
    return 0
}

# Install-wizard account fields: username + password/confirm required, email optional. On failure prints the reason to stderr.
octop_validate_install_fields() {
    local user="$1" pass="$2" confirm="$3" email="${4:-}" display="${5:-}"
    if [ -z "$user" ]; then
        echo "Admin username must not be empty" >&2
        return 1
    fi
    if ! printf '%s' "$user" | grep -qE '^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,31}$'; then
        echo "Invalid admin username \"${user}\": only letters, digits, dots, underscores and hyphens (2-32 chars)" >&2
        return 1
    fi
    if [ "${#display}" -gt 64 ]; then
        echo "Display name must not exceed 64 characters" >&2
        return 1
    fi
    if [ -n "$email" ] && ! printf '%s' "$email" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
        echo "Invalid email format: \"${email}\"" >&2
        return 1
    fi
    if [ -z "$pass" ]; then
        echo "Enter an admin password" >&2
        return 1
    fi
    if [ "$pass" != "$confirm" ]; then
        echo "The two passwords do not match; please re-enter" >&2
        return 1
    fi
    octop_validate_password "$pass"
}

# Settings-window password change: both fields empty = keep unchanged; reject if only one is filled or they differ.
octop_validate_optional_password_change() {
    local pass="$1" confirm="$2"
    if [ -z "$pass" ] && [ -z "$confirm" ]; then
        return 0
    fi
    if [ -z "$pass" ] || [ -z "$confirm" ]; then
        echo "Fill in both the new password and its confirmation, or leave both empty to keep the current password" >&2
        return 1
    fi
    if [ "$pass" != "$confirm" ]; then
        echo "The two passwords do not match; please re-enter" >&2
        return 1
    fi
    octop_validate_password "$pass"
}

# Read a KEY=VALUE from a .env file (tolerating quotes and trailing whitespace).
octop_env_get() {
    local file="$1" key="$2" line
    [ -f "$file" ] || return 0
    line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1)"
    line="${line#*=}"
    line="${line%\"}"; line="${line#\"}"
    printf '%s' "$line"
}

# Update a single KEY in .env in place (keeping other lines); create it if absent.
# Pure-bash implementation: passwords may contain sed-special characters such as | & /, so sed cannot be used.
octop_env_set() {
    local file="$1" key="$2" value="$3" tmp line
    if [ -f "$file" ]; then
        tmp="${file}.tmp.$$"
        : > "$tmp"
        while IFS= read -r line || [ -n "$line" ]; do
            case "$line" in
                "${key}="*) ;;
                *) printf '%s\n' "$line" >> "$tmp" ;;
            esac
        done < "$file"
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
        mv -f "$tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$value" > "$file"
    fi
    chmod 600 "$file" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Docker variant data persistence: must mount the fnOS data-share, never write /var/apps/<app>/share/.
#
# The old FPK bound compose to /var/apps/octop/share/octop/data (singular share, and
# not @appshare). After the app center restarts / rebuilds the container that directory is emptied or unmounted,
# so the entrypoint cannot see octop.db and re-inits, showing up as "reconfigure on every restart".
# The official docker-project injects TRIM_DATA_SHARE_PATHS on compose up
# (usually /volX/@appshare/octop/data); the native callbacks read the same variable.
# ---------------------------------------------------------------------------

octop_legacy_docker_data_dir() {
    printf '%s' "/var/apps/octop/share/octop/data"
}

# Resolve the fnOS persistent data-share directory. The optional arg is the share name from resource.json.
octop_data_share_dir() {
    local share_name="${1:-}" app="${TRIM_APPNAME:-octop}" cand dir
    if [ -z "$share_name" ]; then
        case "$app" in
            octop-native) share_name="octop-native/data" ;;
            *) share_name="octop/data" ;;
        esac
    fi
    if [ -n "${TRIM_DATA_SHARE_PATHS:-}" ]; then
        dir="${TRIM_DATA_SHARE_PATHS%%:*}"
        if [ -n "$dir" ]; then
            printf '%s' "$dir"
            return 0
        fi
    fi
    cand="/var/apps/${app}/shares/${share_name}"
    if [ -d "$cand" ]; then
        printf '%s' "$cand"
        return 0
    fi
    if [ -n "${TRIM_APPDEST:-}" ]; then
        cand="$(dirname "$TRIM_APPDEST")/shares/${share_name}"
        if [ -d "$cand" ]; then
            printf '%s' "$cand"
            return 0
        fi
    fi
    for cand in /vol*/@appshare/"${share_name}"; do
        if [ -d "$cand" ]; then
            printf '%s' "$cand"
            return 0
        fi
    done
    printf '%s' "/var/apps/${app}/shares/${share_name}"
}

# If the old bind directory has octop.db / config.json, migrate them to share/.octop (without overwriting an existing DB).
octop_migrate_legacy_docker_data() {
    local dest="$1" src home
    src="$(octop_legacy_docker_data_dir)"
    [ -n "$dest" ] || return 0
    home="${dest}/.octop"
    mkdir -p "$home"
    [ -d "$src" ] || return 0
    [ "$src" = "$home" ] && return 0
    [ "$src" = "$dest" ] && return 0
    if [ -f "${home}/octop.db" ]; then
        return 0
    fi
    if [ -f "${src}/octop.db" ] || [ -f "${src}/config.json" ]; then
        cp -a "${src}/." "${home}/" 2>/dev/null || true
        echo "[octop] migrated the old data directory ${src} to ${home}" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>/dev/null || true
    fi
}

# fnOS docker-project compose working directories (payload and the @appcenter runtime copy).
octop_docker_compose_dirs() {
    local d
    [ -n "${TRIM_APPDEST:-}" ] && printf '%s\n' "${TRIM_APPDEST}/docker"
    printf '%s\n' "/var/apps/octop/target/docker"
    for d in /vol*/@appcenter/octop; do
        if [ -d "$d" ]; then
            printf '%s\n' "${d}/docker"
        fi
    done
}

# Rewrite data volumes as absolute paths and drop env_file (a missing file makes compose fail immediately).
octop_sync_fnos_compose() {
    local compose="$1" data_dir="$2" env_file="${3:-}" bind tmp line in_env_file=0
    [ -f "$compose" ] || return 0
    [ -n "$data_dir" ] || return 0
    bind="${data_dir}/.octop"
    mkdir -p "$bind"
    tmp="${compose}.tmp.$$"
    : > "$tmp"
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            *"env_file:"*)
                in_env_file=1
                continue
                ;;
        esac
        if [ "$in_env_file" = 1 ]; then
            case "$line" in
                *" - "*|*" -"*)
                    continue
                    ;;
                *)
                    in_env_file=0
                    ;;
            esac
        fi
        case "$line" in
            *":/data/.octop"*)
                printf '      - "%s:/data/.octop"\n' "$bind" >> "$tmp"
                ;;
            *"/fnos-boot.sh:"*)
                printf '      - "%s/fnos-boot.sh:/usr/local/bin/fnos-boot.sh:ro"\n' "$data_dir" >> "$tmp"
                ;;
            *"/fnos-admin.env:"*)
                printf '      - "%s/fnos-admin.env:/data/fnos-admin.env:ro"\n' "$data_dir" >> "$tmp"
                ;;
            *)
                printf '%s\n' "$line" >> "$tmp"
                ;;
        esac
    done < "$compose"
    mv -f "$tmp" "$compose"
}

# Copy .env into the directories where fnOS actually runs compose (including /volX/@appcenter/octop/docker).
octop_distribute_docker_env() {
    local src="$1" data_dir="${2:-}" d dest seen=""
    [ -f "$src" ] || return 0
    [ -n "$data_dir" ] || data_dir="$(octop_env_get "$src" TRIM_DATA_SHARE_PATHS)"
    while IFS= read -r d; do
        [ -n "$d" ] || continue
        case " $seen " in
            *" $d "*) continue ;;
        esac
        seen="${seen} ${d}"
        mkdir -p "$d" 2>/dev/null || continue
        dest="${d}/.env"
        if [ "$dest" != "$src" ]; then
            cp -a "$src" "$dest" 2>/dev/null || true
            chmod 600 "$dest" 2>/dev/null || true
        fi
        if [ -f "${d}/docker-compose.yaml" ]; then
            octop_sync_fnos_compose "${d}/docker-compose.yaml" "$data_dir" "$src"
        fi
    done <<EOF
$(octop_docker_compose_dirs)
EOF
}

# docker/.env lives under target/ and is replaced wholesale on upgrade; the copy goes to TRIM_PKGVAR (@appdata).
octop_persist_docker_env() {
    local env_file="$1" pkgvar="${TRIM_PKGVAR:-/var/apps/octop/var}"
    [ -f "$env_file" ] || return 0
    mkdir -p "$pkgvar"
    cp -a "$env_file" "${pkgvar}/docker.env" 2>/dev/null || true
}

octop_restore_docker_env() {
    local env_file="$1" pkgvar="${TRIM_PKGVAR:-/var/apps/octop/var}"
    [ -f "$env_file" ] && return 0
    [ -f "${pkgvar}/docker.env" ] || return 0
    mkdir -p "$(dirname "$env_file")"
    cp -a "${pkgvar}/docker.env" "$env_file" 2>/dev/null || true
}

# One-shot password-change marker: written on reinstall with kept data, or when a settings-window change did not succeed.
# The container only runs passwd when it sees this file, so a user password changed in the web UI is not overwritten on every restart.
octop_mark_fnos_passwd_pending() {
    local data_dir="$1"
    [ -n "$data_dir" ] || return 0
    mkdir -p "${data_dir}/.octop"
    : > "${data_dir}/.octop/.fnos-apply-wizard-password"
}

# Wizard credentials land in data-share (not .octop, so a published init does not fail on a non-empty directory).
# The container's fnos-boot.sh reads them then inits; it only runs passwd when a pending marker exists or on the first legacy sync.
octop_write_fnos_bootstrap() {
    local data_dir="$1" username="${2:-admin}" password="$3" display="${4:-}" email="${5:-}"
    [ -n "$data_dir" ] || return 0
    [ -n "$password" ] || return 0
    mkdir -p "$data_dir" "${data_dir}/.octop"
    cat > "${data_dir}/fnos-admin.env" << EOF
OCTOP_ADMIN_USERNAME=${username}
OCTOP_DEFAULT_PASSWORD=${password}
OCTOP_ADMIN_DISPLAY_NAME=${display}
OCTOP_ADMIN_EMAIL=${email}
EOF
    chmod 600 "${data_dir}/fnos-admin.env" 2>/dev/null || true
    cat > "${data_dir}/fnos-boot.sh" << 'EOF'
#!/bin/bash
set -euo pipefail
export HOME="${HOME:-/data}"
export OCTOP_HOME="${OCTOP_HOME:-${HOME}/.octop}"
PORT="${OCTOP_PORT:-8088}"
USER_NAME="${OCTOP_ADMIN_USERNAME:-admin}"
PASSWORD="${OCTOP_DEFAULT_PASSWORD:-}"
DISPLAY_NAME="${OCTOP_ADMIN_DISPLAY_NAME:-}"
ADMIN_EMAIL="${OCTOP_ADMIN_EMAIL:-}"
if [ -f /data/fnos-admin.env ]; then
    set -a
    # shellcheck disable=SC1091
    . /data/fnos-admin.env
    set +a
    USER_NAME="${OCTOP_ADMIN_USERNAME:-$USER_NAME}"
    PASSWORD="${OCTOP_DEFAULT_PASSWORD:-$PASSWORD}"
    DISPLAY_NAME="${OCTOP_ADMIN_DISPLAY_NAME:-$DISPLAY_NAME}"
    ADMIN_EMAIL="${OCTOP_ADMIN_EMAIL:-$ADMIN_EMAIL}"
fi
if [ -z "$PASSWORD" ]; then
    echo "[fnos-boot] missing admin password (/data/fnos-admin.env); cannot start." >&2
    exit 1
fi
mkdir -p "$OCTOP_HOME"
PENDING="${OCTOP_HOME}/.fnos-apply-wizard-password"
APPLIED="${OCTOP_HOME}/.fnos-wizard-password-applied"
if [ ! -f "${OCTOP_HOME}/octop.db" ]; then
    echo "[fnos-boot] first initialization, using the install-wizard password ..."
    if [ -n "$DISPLAY_NAME" ]; then
        octop init --yes \
            --admin-username "$USER_NAME" \
            --admin-password "$PASSWORD" \
            --admin-display-name "$DISPLAY_NAME"
    else
        octop init --yes \
            --admin-username "$USER_NAME" \
            --admin-password "$PASSWORD"
    fi
    if [ ! -f "${OCTOP_HOME}/octop.db" ]; then
        echo "[fnos-boot] initialization failed, database not created. Check the log above and restart the app." >&2
        exit 1
    fi
    if [ -n "$ADMIN_EMAIL" ]; then
        octop user set-email "$USER_NAME" "$ADMIN_EMAIL" || true
    fi
    : > "$APPLIED"
    rm -f "$PENDING"
elif [ -f "$PENDING" ]; then
    echo "[fnos-boot] applying the pending wizard password to admin ${USER_NAME} ..."
    octop user passwd "$USER_NAME" --password "$PASSWORD" || true
    if [ -n "$ADMIN_EMAIL" ]; then
        octop user set-email "$USER_NAME" "$ADMIN_EMAIL" || true
    fi
    : > "$APPLIED"
    rm -f "$PENDING"
elif [ ! -f "$APPLIED" ]; then
    echo "[fnos-boot] first upgrade to the boot script that no longer re-changes the password every time; syncing the wizard password once ..."
    octop user passwd "$USER_NAME" --password "$PASSWORD" || true
    : > "$APPLIED"
fi
echo "[fnos-boot] starting Octop on port $PORT ..."
exec octop run --host 0.0.0.0 --port "$PORT"
EOF
    chmod 755 "${data_dir}/fnos-boot.sh" 2>/dev/null || true
}

# When the DB already exists (last init used a random password), sync the wizard password into the container.
octop_apply_wizard_password() {
    local env_file="$1" user pass
    [ -f "$env_file" ] || return 0
    user="$(octop_env_get "$env_file" OCTOP_ADMIN_USERNAME)"
    pass="$(octop_env_get "$env_file" OCTOP_DEFAULT_PASSWORD)"
    [ -n "$user" ] || user="admin"
    [ -n "$pass" ] || return 0
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx octop; then
        if docker exec octop octop user passwd "$user" --password "$pass" >/dev/null 2>&1; then
            echo "[octop] synced the wizard password to the container admin ${user}" > "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>/dev/null || true
        fi
    fi
}

# Resolve data-share, migrate old data, and write the path into the .env used for compose interpolation.
octop_prepare_docker_persist() {
    local env_file="$1" data_dir compose
    octop_restore_docker_env "$env_file"
    data_dir="$(octop_data_share_dir octop/data)"
    mkdir -p "${data_dir}/.octop"
    octop_migrate_legacy_docker_data "$data_dir"
    octop_env_set "$env_file" TRIM_DATA_SHARE_PATHS "$data_dir"
    octop_env_set "$env_file" OCTOP_DATA "$data_dir"
    _boot_user="$(octop_env_get "$env_file" OCTOP_ADMIN_USERNAME)"
    _boot_pass="$(octop_env_get "$env_file" OCTOP_DEFAULT_PASSWORD)"
    _boot_display="$(octop_env_get "$env_file" OCTOP_ADMIN_DISPLAY_NAME)"
    _boot_email="$(octop_env_get "$env_file" OCTOP_ADMIN_EMAIL)"
    [ -n "$_boot_user" ] || _boot_user="admin"
    if [ -n "$_boot_pass" ]; then
        octop_write_fnos_bootstrap "$data_dir" "$_boot_user" "$_boot_pass" "$_boot_display" "$_boot_email"
    fi
    octop_persist_docker_env "$env_file"
    compose="$(dirname "$env_file")/docker-compose.yaml"
    octop_sync_fnos_compose "$compose" "$data_dir" "$env_file"
    octop_distribute_docker_env "$env_file" "$data_dir"
    printf '%s' "$data_dir"
}

# Emergency admin-credential backup (octop-login.txt in the data dir, refreshed only on install / settings-window password changes).
# The settings window no longer shows the password in plaintext; this file is the last resort for recovering the install password.
# The caller must ensure data_dir exists; fix_ownership_and_perms fixes the file ownership centrally.
octop_write_login_file() {
    local data_dir="$1" username="$2" password="$3" port="${4:-8089}" file
    [ -n "$data_dir" ] && [ -d "$data_dir" ] || return 0
    file="${data_dir}/octop-login.txt"
    cat > "$file" << EOF
==========================================================
 Octop admin login information (keep it safe; do not share)
==========================================================
URL: http://<fnOS-IP>:${port}
Admin user: ${username}
Admin password: ${password}

Notes:
- This file only records the password from install or an app "Settings" change; it is not a live password store and is not auto-updated after a change.
- If you changed the password under the web console "avatar menu -> Change password", log in with the web password.
- Configure model API keys under the web console "Settings -> Models".
EOF
    chmod 600 "$file" 2>/dev/null || true
}

# Render the app "Settings" window form (wizard/config) with the current username.
# The template contains <octop-current-username>; it no longer writes the plaintext password.
# wizard_dir is the installed package's wizard directory (/var/apps/<app>/wizard); template is
# the path to the template bundled in the package payload. If either is missing it is skipped silently (install is unaffected).
octop_render_config_wizard() {
    local template="$1" wizard_dir="$2" username="$3" password="${4:-}" data_dir="${5:-}" target tmp content dir_label
    [ -f "$template" ] || return 0
    [ -d "$wizard_dir" ] || return 0
    target="${wizard_dir}/config"
    content="$(cat "$template" 2>/dev/null)" || return 0
    dir_label="${data_dir:-App share / Octop data directory}"
    content="${content//<octop-current-username>/${username}}"
    content="${content//<octop-current-password>/${password}}"
    content="${content//<octop-data-dir>/${dir_label}}"
    tmp="${target}.tmp.$$"
    if printf '%s\n' "$content" > "$tmp" 2>/dev/null; then
        mv -f "$tmp" "$target" 2>/dev/null || rm -f "$tmp"
    fi
    return 0
}
