# Scripts

Run the commands below from the **repository root**.

## Install Octop (end users)

Installs Octop into an isolated virtualenv (`~/.octop/venv`) and creates a
`~/.octop/bin/octop` wrapper that is added to your PATH.

### One-line remote install (recommended)

| Platform | Command |
|------|------|
| macOS / Linux | `curl -fsSL https://raw.githubusercontent.com/onlinegill/Octop/main/scripts/install.sh \| bash` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/onlinegill/Octop/main/scripts/install.ps1 \| iex` |
| Windows (cmd) | Download `…/scripts/install.bat` and run it, or use the local scripts below |

### Local scripts (in-repo)

| Platform | Command |
|------|------|
| macOS / Linux | `bash scripts/install.sh` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File scripts/install.ps1` |
| Windows (cmd) | `scripts\install.bat` |

### Common options

```bash
# Install the latest version from PyPI (default)
bash scripts/install.sh

# Pin a specific version
bash scripts/install.sh --version 0.1.0

# Install an optional extra (downloads Playwright Chromium)
bash scripts/install.sh --extras browser

# Install from a local source checkout (dev / offline)
bash scripts/install.sh --from-source
bash scripts/install.sh --from-source /path/to/orca

# Use a specific PyPI mirror to speed up dependencies
bash scripts/install.sh --mirror https://pypi.org/simple
```

Windows PowerShell equivalents: `-Version`, `-FromSource`, `-SourceDir`, `-Extras`.

### Environment variables

| Variable | Description |
|------|------|
| `OCTOP_HOME` | Install root, default `~/.octop` |
| `OCTOP_REPO` | Git clone URL used by `--from-source` when no local directory is given |
| `OCTOP_PYPI_MIRROR` | PyPI mirror (same as `--mirror`) |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Playwright browser download mirror (only with `--extras browser`) |

Playwright Chromium is not downloaded by default. Add `--extras browser` when you
need remote browser automation, or install it on demand from the dashboard /
`python -m playwright install chromium`. If the system already has Chrome /
Chromium, the download is skipped even with `--extras browser`.

After install:

```bash
octop init    # initialize the database and admin user
octop run     # start the service -> http://127.0.0.1:8088
```

---

## Build a PyPI wheel

First build the frontend (output goes into `src/octop/dashboard/`, matching the
`outDir` in `dashboard/vite.config.ts`), then package the wheel.

```bash
bash scripts/wheel_build.sh
```

Windows:

```powershell
powershell -File scripts/wheel_build.ps1
```

Output: `dist/*.whl`, `dist/*.tar.gz`

Before releasing, make sure the `octop-harness`, `octop-gateway` and similar
dependencies in `pyproject.toml` are published to PyPI (`[tool.uv.sources]` only
applies to local uv development; pip/PyPI ignore it).

---

## Platform notes

- **macOS / Linux**: `install.sh` can install uv automatically and create the
  venv; Playwright Chromium is only downloaded with `--extras browser` (skipped
  when a system Chrome exists).
- **Windows**: use `install.ps1` or `install.bat`; features that need a
  non-blocking stdout such as the PTY terminal are
  limited on Windows (see the compatibility analysis).

The full cross-platform compatibility analysis lives in the project docs or the
PR description.
