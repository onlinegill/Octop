# LDAP Directory Login

> Octop supports connecting an enterprise directory (Active Directory, OpenLDAP, etc.) as a login method: users enter their domain account and password in the **existing login form**, Octop authenticates through the directory, and can optionally auto-create local accounts and map roles from directory groups.

This document covers: features and design, getting it running (including a local LDAP dev server), configuration reference, login behavior details, HTTP API, testing, and troubleshooting.

---

## 1. Feature overview

| Capability | Description |
|---|---|
| Login method | Reuses `/api/auth/login`, no new endpoint. **Accounts with a local password finish locally**; accounts without a local password, or users unknown locally, fall back to the directory |
| Lookup | A service account (or anonymous) first searches for the user DN, then re-binds with that DN and the user's password to verify |
| Account provisioning | The first directory login auto-creates an Octop account (can be disabled) |
| Role mapping | `admin` / `user` is decided by directory group membership, only once at account creation |
| Attribute sync | Email and display name are written back at login; existing accounts' roles are **not** touched |
| Transport security | `ldaps://` or `ldap://` + StartTLS; certificate verification can be disabled (test self-signed certificates only) |
| Credential storage | The bind password is Fernet-encrypted into `sso_providers.client_secret_enc` and is never returned by the API |

### Design points

1. **No new login form.** Directory users use the existing username/password inputs; the login page only adds one hint line (`login.ldapHint`), consistent with current interaction. The backend falls back to the directory after local password verification fails, so the same entry point serves both local and directory accounts.
2. **Roles are decided only at provisioning and never written back afterward.** Moving an existing user into the admin group does **not** silently elevate them; role changes are an explicit operation by an admin inside Octop.
3. **Zero schema change.** It reuses the existing SSO table structure: the config row is `sso_providers.kind = 'ldap'` (details in that row's `extra` JSON), and identity links reuse `user_sso_identities`.
4. **Directory failure ≠ wrong password.** An unreachable directory returns `502 LDAP_UNAVAILABLE`, a wrong password returns `401 AUTH_FAILED`. If the username corresponds to an account **with a local password**, only 401 is reported even if the directory is down (so a user's typo'd password is not masked).

---

## 2. How it works

### 2.1 Login sequence

```
User submits username / password
       │
       ├─ 1. Local password check (UserManager.authenticate)
       │      success → issue JWT, done
       │
       └─ 2. LDAP enabled? no → 401 AUTH_FAILED
              │
              ├─ 2.1 Bind with the service account (bind_dn + bind password; anonymous if bind_dn is empty)
              ├─ 2.2 Search with user_filter ({username} replaced by the escaped input) → user DN
              ├─ 2.3 Re-bind with "that user DN + the password the user typed"  ← bind only the search result, never bind the user's raw input
              ├─ 2.4 Read attributes (email / display name / groups)
              ├─ 2.5 Existing identity link → update profile (email, display name) and return
              │      No link and auto_provision → create account + set role by group + create identity link
              │      No link and auto_provision=false → 403 LDAP_USER_NOT_PROVISIONED
              └─ 3. Issue JWT (structurally identical to a local login)
```

All network and bind calls are blocking and run through `run_in_executor`, so the event loop is not blocked.

### 2.2 Data persistence

| Data | Location |
|---|---|
| Directory config | `sso_providers` row with `kind='ldap'`; `enabled` / `display_name` are columns, the rest are in the `extra` JSON |
| Bind password | The same row's `client_secret_enc` (Fernet-encrypted; the key is the `secrets` table's `sso_fernet`) |
| Identity link | `user_sso_identities(user_id, provider_id, subject)`, where `subject` = the user DN |
| New account | A `users` row with `password_hash IS NULL` (directory accounts have no local password) |

> A directory account's `password_hash` is `NULL`, so `POST /api/auth/change-password` returns `400 PASSWORD_NOT_SET` (rather than a misleading "current password is wrong").

---

## 3. Getting it running

The following flow was verified step by step against a **brand-new directory** and can be copied and executed directly.

### 3.0 Prerequisites

| Dependency | Note |
|---|---|
| Python 3.12+ / uv | The Octop runtime (run `uv sync` once at the repo root) |
| Go 1.21+ | Only for building the local LDAP dev server (glauth) |
| `ldapsearch` (optional) | OpenLDAP client for manually checking the directory; bundled with macOS |

Octop depends on `ldap3`, which is already in `pyproject.toml` and installed by `uv sync`.

### 3.1 Start a local LDAP server (glauth)

For a development directory we choose [glauth](https://github.com/glauth/glauth) — a lightweight LDAP service written in Go: a single binary, config-driven, no database or container required.

The example below puts the sandbox in `~/octop-ldap-dev/` (any directory works; **do not** place it inside the Octop repo, to avoid polluting the workspace):

```bash
LDAP_DEV=~/octop-ldap-dev
mkdir -p "$LDAP_DEV" && cd "$LDAP_DEV"

# 1) Clone
git clone --depth 1 https://github.com/glauth/glauth.git ldap-glauth

# 2) Build — GOWORK=off is required: upstream is a Go workspace and rejects -mod=mod
cd ldap-glauth/v2
GOWORK=off go build -o "$LDAP_DEV/glauth" .
```

Create `~/octop-ldap-dev/glauth.cfg` (full content below; add or remove test accounts as you like):

```toml
debug = false

[ldap]
  enabled = true
  listen = "127.0.0.1:3893"
  # Octop rejects configs that "enable plaintext ldap:// without StartTLS", so the local directory also enables StartTLS.
  tls = true
  tlsCertPath = "glauth.crt"
  tlsKeyPath = "glauth.key"

[ldaps]
  enabled = false

[backend]
  datastore = "config"
  baseDN = "dc=example,dc=org"
  nameformat = "uid"
  groupformat = "cn"

[behaviors]
  LimitFailedBinds = true
  NumberOfFailedBinds = 10
  PeriodOfFailedBinds = 10
  BlockFailedBindsFor = 30

# Service account: used only for searches
[[users]]
  name = "svc-octop"
  uidnumber = 6001
  primarygroup = 5501
  passsha256 = "ec9cea51278ff8572536540a2458a016872a2270b5876ec7ece0b31c885fdfde" # bindpw
    [[users.capabilities]]
    action = "search"
    object = "*"

[[users]]
  name = "alice"
  givenname = "Alice"
  sn = "Anderson"
  mail = "alice@example.org"
  uidnumber = 6002
  primarygroup = 5502
  passsha256 = "6624974ea2baffac164422e4490376c1c31313cd97724ae8ce62fb3f0a0370f2" # alicepw
    [[users.capabilities]]
    action = "search"
    object = "dc=example,dc=org"

[[users]]
  name = "bob"
  givenname = "Bob"
  sn = "Brown"
  mail = "bob@example.org"
  uidnumber = 6003
  primarygroup = 5503
  passsha256 = "e8f318657ce39ec4edeecbbee28fd72dea2261d8a6b2155ce4977393e0ea721b" # bobpw
    [[users.capabilities]]
    action = "search"
    object = "dc=example,dc=org"

[[users]]
  name = "carol"
  givenname = "Carol"
  sn = "Clark"
  mail = "carol@example.org"
  uidnumber = 6004
  primarygroup = 5501
  passsha256 = "d06dc93720809b81d6e0019579108a5745306ad6d37d976ddd6e66a1b2364758" # carolpw
    [[users.capabilities]]
    action = "search"
    object = "dc=example,dc=org"

[[groups]]
  name = "users"
  gidnumber = 5501

[[groups]]
  name = "admin"
  gidnumber = 5502

[[groups]]
  name = "engineering"
  gidnumber = 5503
```

`passsha256` is the lowercase hex SHA-256 of the plaintext password:

```bash
printf '%s' 'mypassword' | shasum -a 256 | cut -d' ' -f1     # macOS
printf '%s' 'mypassword' | sha256sum | cut -d' ' -f1         # Linux
```

First generate a self-signed certificate (glauth resolves relative paths, so place it in the same directory as the config):

```bash
cd ~/octop-ldap-dev
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout glauth.key -out glauth.crt \
  -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
chmod 600 glauth.key
```

Start it and self-check (`-ZZ` forces StartTLS):

```bash
~/octop-ldap-dev/glauth -c ~/octop-ldap-dev/glauth.cfg

# In another terminal: search with the service account
ldapsearch -LLL -x -H ldap://127.0.0.1:3893 \
  -D "uid=svc-octop,cn=users,dc=example,dc=org" -w bindpw \
  -b "dc=example,dc=org" "(uid=alice)" uid mail memberOf
```

Expected output (the key point: `memberOf` determines the admin role):

```
dn: uid=alice,cn=admin,ou=users,dc=example,dc=org
uid: alice
mail: alice@example.org
memberOf: cn=admin,ou=groups,dc=example,dc=org
```

### 3.2 Start Octop (separate HOME, to avoid polluting an existing instance)

Use a separate `HOME` + `OCTOP_HOME` to spin up a throwaway instance whose database and wizard password land in a temp directory:

```bash
cd <repo root>
RUNTIME=/tmp/octop-ldap-dev
mkdir -p "$RUNTIME/home"

HOME="$RUNTIME/home" \
OCTOP_HOME="$RUNTIME/home/.octop" \
uv run octop run --host 127.0.0.1 --port 8799
```

The first start prints a one-time setup-wizard password, also written to `$RUNTIME/home/octop-login.txt`:

```
╔══════════════════════════════════════════════════════════╗
║  Octop first-run wizard password (one-time use):          ║
║  xxxxxxxxxxxxxxxxxxxx                                     ║
║  File: ~/octop-login.txt                                  ║
╚══════════════════════════════════════════════════════════╝
```

### 3.3 Complete the setup wizard

**Option A: browser wizard (simplest)** — open `http://127.0.0.1:8799`, paste the wizard password above, pick the database (SQLite is fine) as prompted, create the admin account, and finish.

**Option B: scripted (reproducible; the commands below were all verified)**

```bash
API=http://127.0.0.1:8799/api
RUNTIME=/tmp/octop-ldap-dev
PW=$(head -1 "$RUNTIME/home/octop-login.txt")

# 1) Verify the wizard password → get a one-time wizard_token
TOK=$(curl -sS -X POST "$API/setup/verify-password" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["wizard_token"])')

# 2) Bind the control-plane database (SQLite)
curl -sS -X POST "$API/setup/database" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"driver":"sqlite"}'
# → {"ok":true,"driver":"sqlite"}

# 3) Create the initial admin (password must meet the strength policy: ≥8 chars with letters and digits)
curl -sS -X POST "$API/setup/initial-admin" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" \
  -d '{"username":"admin","password":"TestPass12"}'

# 4) Finish the wizard
curl -sS -X POST "$API/setup/finish" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"provider_draft":null}'
# → {"ok":true}
```

### 3.4 Configure LDAP

**Option A: browser** — sign in as `admin`, go to the **Admin → Users → LDAP** page, fill in the fields from the table in 3.5, click "Save", then click "Test connection".

**Option B: API**

```bash
API=http://127.0.0.1:8799/api
AT=$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"TestPass12"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -sS -X PUT "$API/auth/ldap/config" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AT" -d '{
    "enabled": true,
    "display_name": "Corp Directory",
    "server_url": "ldap://127.0.0.1:3893",
    "bind_dn": "uid=svc-octop,cn=users,dc=example,dc=org",
    "bind_password": "bindpw",
    "user_base_dn": "dc=example,dc=org",
    "admin_groups": "admin",
    "auto_provision": true
  }'

# Test connectivity (service-account bind + probe user_base_dn)
curl -sS -X POST "$API/auth/ldap/config/test" -H "Authorization: Bearer $AT"
# → {"ok":true,"detail":"Connected to the LDAP directory service (ldap://127.0.0.1:3893)"}

# Public status readable by the login page
curl -sS "$API/auth/ldap/status"
# → {"enabled":true,"display_name":"Corp Directory"}
```

### 3.5 Configuration values for the local directory

| Form/API field | Value | Note |
|---|---|---|
| Server URL `server_url` | `ldap://127.0.0.1:3893` | |
| StartTLS `start_tls` | on | The local directory uses a self-signed certificate; **must** be on (otherwise enabling is rejected) |
| Verify TLS certificate `verify_tls` | off | Only because the test uses a self-signed certificate; keep it on in production |
| Bind DN `bind_dn` | `uid=svc-octop,cn=users,dc=example,dc=org` | Empty = anonymous search |
| Bind password `bind_password` | `bindpw` | Write-only; omit to keep the stored value |
| User base DN `user_base_dn` | `dc=example,dc=org` | |
| User filter `user_filter` | `(uid={username})` | Must contain the literal `{username}` |
| Username attribute `username_attribute` | `uid` | |
| Email attribute `email_attribute` | `mail` | |
| Display-name attribute `display_name_attribute` | `givenName` | See the note below |
| Group attribute `group_attribute` | `memberOf` | |
| Admin groups `admin_groups` | `admin` | Comma-separated; may be a group CN or full DN |
| Auto-provision on first login `auto_provision` | on | |

> **Note**: glauth does not expose `cn` as a searchable user attribute, so with the local directory `display_name_attribute = "cn"` retrieves no display name (`givenName` works). Real OpenLDAP / AD expose `cn` normally.

### 3.6 Sign in with a directory account

Browser: sign out of the current session → enter the directory account directly on the login page (you will see the hint line "Sign in with your Corp Directory account") → complete the captcha → sign in.

Command line:

```bash
API=http://127.0.0.1:8799/api
for u in alice:alicepw bob:bobpw carol:carolpw; do
  n=${u%%:*}; p=${u##*:}
  curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$n\",\"password\":\"$p\"}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('$n ->', d['user']['role'])"
done
```

Expected result:

| Account | Password | Group | Octop role |
|---|---|---|---|
| `alice` | `alicepw` | `admin` | `admin` |
| `bob` | `bobpw` | `engineering` | `user` |
| `carol` | `carolpw` | `users` | `user` |
| `alice@example.org` | `alicepw` | — | Email also logs in (the default filter includes `mail`) |

A wrong password returns `401 AUTH_FAILED`; a down directory returns `502 LDAP_UNAVAILABLE`.

---

## 4. Configuration reference

| Field | Default | Note |
|---|---|---|
| `enabled` | `false` | When off, login no longer falls back to the directory; an unfinished draft can be saved |
| `display_name` | `""` | The name shown in the login-page hint line |
| `server_url` | `""` | `ldap://` or `ldaps://`; default port 389 / 636 |
| `start_tls` | `false` | Upgrades a plaintext `ldap://` connection to StartTLS; **cannot** be combined with `ldaps://`. **When enabled with `ldap://` and StartTLS off it is rejected**, to avoid sending the password in plaintext |
| `verify_tls` | `true` | Verifies the server certificate; disable only for self-signed test servers. A warning is emitted continuously while off |
| `bind_dn` | `""` | Service-account DN; empty = anonymous search |
| `bind_password` | — | Write-only field, never returned; omit to keep the stored value |
| `user_base_dn` | `""` | User search base DN, required |
| `user_filter` | `(\|(uid={username})(sAMAccountName={username})(mail={username}))` | Must contain the literal `{username}`, which is escaped before substitution |
| `username_attribute` | `uid` | Used to determine the Octop username |
| `email_attribute` | `mail` | Written back to the account email |
| `display_name_attribute` | `cn` | Written back to the display name |
| `subject_attribute` | `""` (empty) | Identity primary key: a directory-side stable attribute (OpenLDAP `entryUUID`, AD `objectGUID`). **Empty by default** = explicitly use the entry DN, in which case renaming/moving an entry creates another account. "Test connection" reports the attributes the directory actually provides (`detected_subject_attribute`); fill it in accordingly |
| `group_attribute` | `memberOf` | Multi-valued attribute used for group decisions; has no effect once `group_search` is enabled |
| `group_search` | `false` | Switches to "search group entries" to decide membership, for OpenLDAP without the `memberOf` overlay |
| `group_search_base` | `""` | Base DN where groups live; empty falls back to `user_base_dn` |
| `group_member_attribute` | `member` | The member attribute on group entries. `member` / `uniqueMember` store the member **DN**; `memberUid` (classic OpenLDAP `posixGroup`) stores the **username** — both value kinds match, no extra config needed |
| `admin_groups` | `""` | Comma-separated; may be a group CN (`admin`) or full DN (`cn=ops,ou=groups,dc=x`). **Only effective at first account provisioning** |
| `allowed_groups` | `""` | Comma-separated; when non-empty, only members of these groups can sign in, and other directory accounts are rejected without account creation |
| `auto_provision` | `false` | Off by default: a directory account needs a pre-existing Octop account, or an admin explicitly enables auto-provisioning |
| `timeout_seconds` | `10` | Connect/receive timeout, range 1–60 |

Saving an enabled (`enabled=true`) config runs full validation; saving a draft (`enabled=false`) allows incomplete fields for incremental entry.

---

## 5. Login behavior details

| Scenario | Behavior |
|---|---|
| Username matching | Searches by `user_filter`; prefers the entry **exactly equal** to `username_attribute`. Accepts a **unique** non-exact match; rejects when multiple match and none is exact (to avoid verifying the password against someone else's entry) |
| Filter injection | Input is escaped via `escape_filter_chars`, so `*`, `(`, etc. cannot broaden the search |
| Group-name comparison | Case-insensitive; `admin` and `cn=admin,ou=groups,dc=x` are treated as the same group |
| Identity link | Keyed by `subject_attribute` (default `entryUUID`), so renaming/moving an entry doesn't create a duplicate account |
| First login | Creates an account: the username comes from the directory value (an `_2` suffix is appended on conflict). Picks the **admin or the preset user role template** per `admin_groups`; permissions and policies are copied from the template |
| Subsequent logins | Updates email and display name; does **not** overwrite existing roles, permissions, or policies |
| Email conflict | If the directory email is already taken by another Octop account, that account's email is left blank without error |
| Account disabled | `403 USER_DISABLED` |
| Not provisioned and `auto_provision=false` | `403 LDAP_USER_NOT_PROVISIONED` |
| Not in `allowed_groups` | `403 LDAP_GROUP_NOT_ALLOWED` (no account created) |
| **Any account with a local password** types a wrong password | Ends locally: `401 AUTH_FAILED`, and that password is **never** sent to the directory (no local-password leak, no consuming the directory's failure count). This holds even if the account is also bound to the directory |
| An account with no local password (directory-provisioned, or a user absent in Octop) types a wrong password | Binds to the directory; on failure returns `401`, counted against directory login rate limiting by "username + client address" |
| Want both a local password and a directory password | Choose one: once you set a local password it wins; without one, the directory is used |
| A directory account is renamed | The display name refreshes on the next login (no Octop restart needed). **But** if `subject_attribute` is empty (DN-based linking), the rename is treated as a new user and another account is created |
| Directory unreachable / service-account password rotation invalidated | `502 LDAP_UNAVAILABLE` (accounts with a local password still report 401) |
| Change password | Directory accounts have no local password → `400 PASSWORD_NOT_SET` |
| Account deleted | The next login re-creates it if `auto_provision` is on |

> **Production notes**
>
> 1. **Roles are decided only at first provisioning.** Adding a user to `admin_groups` afterward will not elevate them, nor will removal demote them — contrary to the common "directory is the source of permissions" expectation. Change roles in the Octop user list instead.
> 2. **Where group attributes come from**: by default it reads `memberOf` on the user entry (natively provided by AD). For OpenLDAP without the `memberof` overlay, enable `group_search` to reverse-look-up group members: `member` / `uniqueMember` (store DN) and `memberUid` (store username) are both supported. Nested groups (groups inside groups) are **not** supported — only direct members are compared.
> 3. **Same-name group risk**: when `admin_groups` uses a short name (`admin`), any same-named group under any OU counts as a hit; a full DN is compared as a whole DN and is safer.
> 4. **Identity primary key**: empty by default = use the entry DN, so renaming or moving an OU creates a new account. Click "Test connection"; it reports the attributes the directory can provide (`entryUUID` or `objectGUID`). After filling `subject_attribute`, **newly provisioned** accounts link by that key. Note: switching the primary key breaks the linking of **existing** accounts and requires an admin to re-link them.
> 5. **Group allowlist**: in production, set `allowed_groups` to prevent any filterable account in the directory from being provisioned.

---

> 5. **Local password takes precedence and is final**: once you set a local password for a directory account, that password becomes its only login credential — the directory password no longer works (and is never sent out). To keep the directory password, do not set a local password for that account.
> 6. **Login rate limiting** counts by "username + client address". The address comes from the direct peer; **only when the peer is a loopback address** (a reverse proxy on the same host/pod) is `X-Forwarded-For` used, taking the right-most hop (the one the trusted proxy appended), so forged headers cannot reset the quota. Therefore, when deployed behind a reverse proxy, make sure the proxy is on the same host as Octop, otherwise all users share a single source address.

---

## 6. HTTP API

| Method | Path | Permission | Note |
|---|---|---|---|
| `GET` | `/api/auth/ldap/status` | public | `{enabled, display_name}`, for the login-page hint |
| `GET` | `/api/auth/ldap/config` | `sso` | Directory config; `bind_password` is not returned; `has_bind_password` indicates whether it is set |
| `PUT` | `/api/auth/ldap/config` | `sso` | Create/update config; `bind_password` is write-only |
| `POST` | `/api/auth/ldap/config/test` | `sso` | Service-account bind + probe `user_base_dn` → `{ok, detail}` |

Login itself reuses `POST /api/auth/login` (public), with no new endpoint. Error codes:

| Error code | HTTP | Meaning |
|---|---|---|
| `LDAP_BAD_REQUEST` | 400 | Invalid config (URL scheme, missing `{username}`, attribute name, timeout range, etc.) |
| `LDAP_UNAVAILABLE` | 502 | Directory unreachable / service account rejected / search failed |
| `LDAP_USER_NOT_PROVISIONED` | 403 | Directory account not provisioned and auto-provisioning not enabled |
| `PASSWORD_NOT_SET` | 400 | Attempt to change a local password for a directory account |
| `AUTH_FAILED` | 401 | Invalid credentials |

---

## 7. Testing

### 7.1 Unit tests (no directory needed)

```bash
uv run pytest tests/unit/auth/test_ldap_config.py tests/unit/auth/test_ldap_client.py -q
# → 51 passed
```

- `test_ldap_config.py` (27 cases, including 11 parameterized validation cases): URL parsing and default ports, validation rules (scheme/host/StartTLS conflict/attribute name/timeout range/required `{username}`), draft saving, `extra` round-trip, comma-splitting of group names, group-name normalization.
- `test_ldap_client.py` (24 cases): successful login / wrong password / unknown user, **service-account DN cannot be impersonated**, filter escaping, email login, exact same-name matching, classification of unreachable directory vs rejected service account, anonymous bind, StartTLS failure, missing attributes and type conversion.

### 7.2 Integration tests (real HTTP, only the socket boundary is replaced)

```bash
uv run pytest tests/integration/test_auth_ldap.py -q
```

19 items covering: provisioning and role mapping, non-admin groups, **group change does not elevate**, wrong password, service-account DN impersonation, local password precedence, the `auto_provision` switch, directory-down classification, service-account password rotation, disabled accounts, directory-account password change, public status, permission checks, **bind password is not leaked**, omitting the password keeps the old value, localized errors for invalid config, connectivity test, and fully skipping the directory when unconfigured.

`tests/support/ldap_fake.py` replaces only `ldap3.Connection` (faithfully reproducing its semantics such as `open()` returning `None` and raising `LDAPSocketOpenError` on failure); everything above it — client, service, router — is production code.

### 7.3 Live tests (against a real directory)

Requires the directory from 3.1 running:

```bash
OCTOP_LDAP_TEST_URL=ldap://127.0.0.1:3893 \
OCTOP_LDAP_TEST_BIND_DN='uid=svc-octop,cn=users,dc=example,dc=org' \
OCTOP_LDAP_TEST_BIND_PASSWORD=bindpw \
OCTOP_LDAP_TEST_BASE_DN='dc=example,dc=org' \
OCTOP_LDAP_TEST_ADMIN_GROUP=admin \
OCTOP_LDAP_TEST_USER=alice \
OCTOP_LDAP_TEST_PASSWORD=alicepw \
OCTOP_LDAP_TEST_EXPECTED_ROLE=admin \
uv run pytest tests/live/test_ldap_live.py -m live -v
```

It goes through the real HTTP API: configure → connectivity test → directory login → `has_password=false` check → reject a wrong password. Swap `OCTOP_LDAP_TEST_USER` / `_PASSWORD` / `_EXPECTED_ROLE` to `bob`/`bobpw`/`user` or `carol`/`carolpw`/`user` to verify non-admin mapping. Any missing environment variable causes an automatic skip, so CI is not broken.

### 7.4 Browser verification points

1. The Admin → Users → **LDAP** page should refill the saved config, and "Test connection" should show `Connected to the LDAP directory service`.
2. After signing out, a "Sign in with your Corp Directory account" hint appears below the password box on the login page (the name comes from `display_name`).
3. After signing in as `bob/bobpw`, you land at `/chat` and the left nav has **no** "Admin" section (role is `user`).

### 7.5 Full gate

```bash
make all     # format-all + lint + typecheck + test (including the dashboard build)
cd dashboard && npx tsc -b
```

Both must pass.

---

## 8. Troubleshooting

| Symptom | Error code / status | Cause and fix |
|---|---|---|
| Saving config returns 400 | `LDAP_BAD_REQUEST` | Check `detail`: URL missing `ldap://`/`ldaps://`, `user_filter` missing `{username}`, invalid attribute name, timeout not in 1–60 |
| "Test connection" reports the service account rejected | `bind_failed` | Wrong `bind_dn` or `bind_password`; the DN form must match the directory (`cn=` / `uid=` / `ou=`) |
| "Test connection" reports the search rejected | `search_failed` | `user_base_dn` out of scope, or the service account lacks search rights on that subtree (glauth needs `[[users.capabilities]] action="search"`) |
| Login returns 502 | `LDAP_UNAVAILABLE` | Server address/port unreachable, service-account password rotated, firewall or certificate verification failure (disable `verify_tls` for self-signed test certificates) |
| Login returns 403 not provisioned | `LDAP_USER_NOT_PROVISIONED` | Enable `auto_provision`, or create a same-named account in Octop first |
| Login returns 401 | `AUTH_FAILED` | Wrong password; the username is not found under `user_filter` (check `username_attribute` and the filter); or multiple entries were resolved with no exact match |
| Login succeeds but the user is not an admin | — | The user is not in `admin_groups`; confirm the directory actually returns `memberOf` (OpenLDAP needs the `memberof` overlay). A group change does **not** auto-elevate; change the role in Octop |
| Display name is empty | — | The directory does not expose that attribute (glauth's `cn` is such a case; use `givenName` instead) |
| Change password returns 400 | `PASSWORD_NOT_SET` | A directory account simply has no local password; this is expected |
| Bind password was lost | — | Omitting `bind_password` on `PUT` keeps the old value; if the Fernet key (`secrets.sso_fernet`) changed, re-enter it |

---

## 9. Production readiness checklist

1. **Service account**: create a read-only search account granted read access to the `user_base_dn` subtree; do not use a domain-admin account.
2. **Transport security**: prefer `ldaps://`, then `ldap://` + StartTLS; keep `verify_tls` on when the certificate is trusted.
3. **Filters**: adjust by directory type; AD commonly uses `(&(objectClass=user)(sAMAccountName={username}))`; OpenLDAP commonly uses `(&(objectClass=inetOrgPerson)(uid={username}))`.
4. **Group mapping**: confirm the directory returns `memberOf` (OpenLDAP needs the overlay), or accept manual admin grants.
5. **Attribute mapping**: `display_name_attribute` is best as `displayName` (AD) or `cn`/`displayName` (OpenLDAP).
6. **First rollout**: `auto_provision=true` eases importing; once stable, turn it off and have admins create accounts in Octop first.

---

## 10. Related files

| Path | Purpose |
|---|---|
| `src/octop/infra/auth/ldap/config.py` | Config model, validation, `extra` serialization, and group-name parsing |
| `src/octop/infra/auth/ldap/client.py` | `ldap3` client: service bind, search, user-bind verification |
| `src/octop/infra/auth/ldap/service.py` | Config read/write, account provisioning, role mapping |
| `src/octop/api/routers/auth_ldap.py` | The four HTTP endpoints |
| `src/octop/api/routers/auth.py` | Directory fallback at login (`_authenticate_ldap`) |
| `dashboard/src/pages/Admin/Users/LdapPanel.tsx` | Admin config form |
| `tests/support/ldap_fake.py` | Fake directory for tests (replaces `ldap3.Connection`) |
| `tests/live/test_ldap_live.py` | End-to-end tests against a real directory |
