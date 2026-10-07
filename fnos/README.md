# Octop — FeiNiu (fnOS) package

This directory contains everything needed to package [onlinegill/Octop](https://github.com/onlinegill/Octop) as a FeiNiu fnOS `.fpk` install package, plus GitHub Actions that auto-sync upstream and auto-build.

## First use (initial account)

Set the admin account in the install wizard: username and password are required, display name and email are optional. The password must be at least 8 characters and contain both letters and digits (matching the app-side password policy; overly common passwords such as `Octop123` are rejected, and invalid input is reported immediately during install).

The password is chosen by the user and is no longer auto-generated. If you forget it, open FeiNiu "File Manager", go to the Octop data directory under the app share, and read `octop-login.txt` (the app "Settings" window shows the current directory). That file only backs up the password from install or an app "Settings" change; **it is not updated after a web UI password change**.

> If you changed the password under the web console "avatar menu → Change password", log in with the web password.

### Official CLI management

After a native install the official CLI is registered on PATH automatically (`/usr/local/bin/octop` → `octop-cli`), so once you SSH into FeiNiu you can use all official management commands (running as root or octop-native works best):

```bash
octop --help            # all official CLI subcommands
octop version
octop provider list     # model providers
octop agent list        # experts/agents
octop user list         # user management
octop user passwd <username> --password <new-password>   # offline password change (the app "Settings" window uses this too)
octop skills --help     # skills management
octop backup --help     # backup/restore
```

> Note: do not run `octop run` by hand (it would fight the service instance managed by the FeiNiu app center for port 8089); the web service is always started/stopped by the app center.

## Two kinds of packages

The repo produces **three** `.fpk` files to cover different deployment preferences and CPU architectures:

| Variant | Package name | Size | How it runs | Dependencies |
|------|------|------|----------|------|
| **Docker variant (recommended, especially on ARM)** | `Octop-fnos-docker-<ver>.fpk` | ~340 KB | FeiNiu pulls `ghcr.io/onlinegill/octop:<this package version>` (`amd64` / `arm64` multi-arch); no re-pull on restart | Host needs Docker and access to `ghcr.io` |
| **Native x86_64** | `Octop-fnos-native-<ver>.fpk` | ~200 MB | Reuses FeiNiu "Python 3.12" + the package's core dependencies and frontend | No Docker needed |
| **Native ARM64** | `Octop-fnos-native-arm64-<ver>.fpk` | ~200 MB | Same, with aarch64 site-packages; do not install on x86 | No Docker needed; use when an ARM FeiNiu has no Docker |

- The **Docker variant** is implemented as a FeiNiu `docker-project`: the package only contains `docker-compose.yaml` and the wizard config, and FeiNiu pulls the image from GHCR at runtime. x86 / ARM FeiNiu share this one FPK and Docker pulls the matching image layers for the local architecture. Prefer this one on ARM FeiNiu. The image already bundles the `desktop` desktop control and the frontend; Playwright Chromium is not preinstalled and can be installed on demand from the console.
- The **native variant** is implemented as a FeiNiu native `app`: the interpreter reuses the FeiNiu "Python 3.12" developer tools; the package holds the Octop core dependencies and frontend. If the expert shell / skills need to run `node` / `npx`, they reuse FeiNiu's installed Node.js (not force-installed). Extension `.so` files are tied to the CPU architecture, so x86 and ARM each get their own build; installing the wrong architecture errors out at install or startup.

> These packages ship with the regular release on the **`v*` GitHub Release** (for example [v0.9.31](https://github.com/onlinegill/Octop/releases/latest)): `Octop-fnos-docker-<ver>.fpk` / `Octop-fnos-native-<ver>.fpk` / `Octop-fnos-native-arm64-<ver>.fpk`.

## Directory layout

```
fnos/
├── README.md
├── docker/                 # Docker variant (docker-project)
│   ├── manifest            # app metadata (platform=all / name/version/desktop entry, etc.)
│   ├── ICON.PNG / ICON_256.PNG
│   ├── LICENSE             # reuses the repo-root LICENSE (MIT)
│   ├── cmd/                # lifecycle scripts (main / install_callback / config_callback, etc.)
│   ├── config/
│   │   ├── privilege       # permission declarations (docker-octop user)
│   │   └── resource        # resource declarations (docker-project + data share)
│   ├── wizard/
│   │   ├── install       # install wizard (create account + what to do next)
│   │   ├── config        # app "Settings" window (change password only, no plaintext password shown)
│   │   ├── upgrade       # upgrade notes (does not change the web password)
│   │   └── uninstall     # uninstall wizard (data cleanup options)
│   ├── app/
│   │   ├── docker/
│   │   │   └── docker-compose.yaml   # references ghcr.io/onlinegill/octop:<version>; mounts TRIM_DATA_SHARE_PATHS
│   │   └── ui/
│   │       ├── config                # desktop icon entry
│   │       └── images/icon-{64,256}.png
│   └── Dockerfile          # builds the image from repo source, installs the desktop extra (no Chromium)
└── native/                 # native variant (non-Docker FeiNiu native app)
    ├── manifest            # platform=all + native app metadata
    ├── cmd/                # lifecycle scripts (main / install_callback / config_callback)
    ├── config/
    │   ├── privilege       # permission declarations (root, for sudo / remote desktop, etc.)
    │   └── resource        # data-share + usr-local-linker
    ├── app/
    │   ├── bin/octop       # launcher (reuses FeiNiu Python 3.12, starts octop init/run)
    │   ├── wizard/config.template   # "Settings" window form template (renders the current username into the installed package's wizard/config)
    │   └── ui/             # desktop icon entry
    └── wizard/             # install/config/uninstall/upgrade wizards
```

## How it works

1. **Release pipeline**: a `v*` tag runs `release.yml` (PyPI + GitHub Release) and `docker-publish.yml` (GHCR / Hub) in parallel; once the Release succeeds it auto-`workflow_dispatch`es this workflow.
2. **Image reuse**: images are no longer rebuilt; `ensure-image` polls for `ghcr.io/onlinegill/octop:{version}` (the amd64+arm64 manifest pushed by docker-publish). The Docker `.fpk` only packages compose and pulls that image at runtime.
3. **Wheel reuse**: the native variant prefers downloading `octop-*.whl` from the same-version GitHub Release (`v*`); if missing it falls back to building the frontend + wheel from source.
4. **Package build**: the `fpk` / `native` / `native-arm64` jobs package with `scripts/build-fpk.sh`. Official fnpack only ships linux-amd64, so the ARM native variant first installs aarch64 `site-packages` on `ubuntu-24.04-arm`, then returns to the amd64 runner to package. Artifacts are attached to the same `v*` GitHub Release (alongside the wheel and desktop packages).

## Build the .fpk locally (no Docker needed)

```bash
bash scripts/build-fpk.sh            # Docker variant + native variant for the current machine
bash scripts/build-fpk.sh docker     # Docker variant only  → dist/Octop-fnos-docker-<version>.fpk
bash scripts/build-fpk.sh native     # native variant only  → dist/Octop-fnos-native-<version>.fpk
FPK_ARCH=arm64 bash scripts/build-fpk.sh native   # ARM native variant (aarch64 site-packages must be in place)
```

A `.fpk` is a "double-layer gzip tar": the outer layer contains `app.tgz / cmd / config / wizard / ICON.PNG / ICON_256.PNG / LICENSE / manifest`, and the inner `app.tgz` contains the `app/` contents.

## Installing on FeiNiu

1. In FeiNiu "App Center → Settings → Manually install app" choose the matching `.fpk`:
   - **Prefer**: Docker installed (including ARM FeiNiu) → `Octop-fnos-docker-<version>.fpk` (x86 / ARM universal)
   - Do not want Docker, x86_64 FeiNiu → `Octop-fnos-native-<version>.fpk`
   - Do not want Docker, ARM64 FeiNiu → `Octop-fnos-native-arm64-<version>.fpk` (do not install on x86)
2. Set the admin username and password in the install wizard (display name and email optional), and read "what to do next".
3. Wait until the app center shows "Running", then click "Open", or open the Docker variant at `http://<device-IP>:8088` / the native variant at `http://<device-IP>:8089` in a browser and log in with the account you just set.
4. After login configure the API key under the console "Settings → Models". The Docker variant pulls the image matching this package version from `ghcr.io` on first run (the device needs access to GitHub Container Registry); wait for the download to finish, and restarts will not re-pull. Container data is mounted on the FeiNiu `data-share` (`TRIM_DATA_SHARE_PATHS`, usually `/volX/@appshare/octop/data`) and persists across app restarts. The native variant needs no image pull. Playwright Chromium is not preinstalled; install it on demand from the console when you need remote browsing.

> Docker variant port `8088`, native variant port `8089` (FeiNiu port mapping and the desktop icon follow this). The `desktop` desktop control is installed by default in the Docker image.
