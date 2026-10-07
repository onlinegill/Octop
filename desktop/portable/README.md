# Octop portable (green) bundle (multi-platform)

Unzip and run: a bundled portable CPython plus Octop and its dependencies, launched via `start.sh` / `start.bat`.  
It does **not** depend on the system Python and does **not** include Wails / a desktop shell — it opens the Dashboard in your browser.  
First launch goes through the normal upstream setup wizard (this directory has **no** OOB / UI trimming).

## Decoupled from upstream

Everything lives in:

- `desktop/portable/**` (scripts / templates / this directory's Makefile)
- `.github/workflows/octop-desktop.yml` (multi-platform CI)
- `desktop/portable/.gitignore` (`/release/`, `/runtimes/`, `/wheels/` etc. ignore build artifacts)
- `tests/unit/test_green_launch.py` (launch.py PATH / addsitedir)

It does **not** modify `src/`, `dashboard/`, `pyproject.toml`, `uv.lock`, or the root `Makefile`.  
When merging upstream, only watch those paths; day to day use:

```bash
make -f desktop/portable/Makefile green
```

Dependency versions must follow the repo-root `uv.lock`: `package.sh` uses
`uv export --frozen`, and after packing run `desktop/portable/verify_imports.py`
to check key package pins and imports (including the `langchain-openai` / `langchain-core` pairing),
avoiding intermittent "same install, different environment" failures from version mismatches or native-extension load errors.
Platform overrides (`cryptography==46.x` for `darwin-amd64` / `windows-arm64`)
are passed into the verification too, avoiding false mismatches against 49.x in the lock.

## Artifact layout

Public filename: `Octop-portable-<plat>-<version>.zip`. The zip's inner directory is still:

```
Octop-<plat>/
  runtime/       # python-build-standalone
  packages/      # Octop + dependencies (site-packages, relocatable)
  launch.py      # launch bootstrap (site.addsitedir / Windows pywin32)
  start.sh       # macOS / Linux
  start.bat      # Windows
  README.txt
  data/          # created automatically on first run (user data)
```

Supported platforms: `darwin-arm64` `darwin-amd64` `linux-amd64` `linux-arm64` `windows-amd64` `windows-arm64`.

## Build (from the repo root)

Requires: `uv`, `curl`, `zip` (optional), Node (to build the frontend).

```bash
# One shot: current host platform (frontend + portable CPython + zip)
make -f desktop/portable/Makefile green

# Or step by step:
make build-frontend                  # existing upstream target
bash desktop/portable/bootstrap-runtime.sh
bash desktop/portable/package.sh
```

Local one-shot rebuild (nvm 24):

```bash
bash desktop/portable/rebuild.sh
```

When cross-assembling other platforms, packages **with C extensions** must be built on the target ABI:

| Target | Recommended approach |
|------|----------|
| Current host | `make -f desktop/portable/Makefile green` |
| Linux (from macOS/Windows) | `make -f desktop/portable/Makefile green-linux` |
| Windows | run the same `green` on Windows / CI |

### Offline bundle

```bash
bash desktop/portable/vendor-wheels.sh          # prefetch wheels per the current uv.lock
OCTOP_GREEN_OFFLINE=1 bash desktop/portable/package.sh
```

The offline cache must come from the **current branch's** `uv.lock`; do not reuse an old fork's wheel directory.

### macOS Intel (`darwin-amd64`) note

The pinned `cryptography` 49.x **no longer ships** a macOS x86_64 / universal2 wheel. If it is allowed to compile from sdist it links against the build machine's Homebrew `/usr/local/opt/openssl@3`, and user machines without that library fail to start.

The green packaging scripts already:

1. Pin `cryptography==46.0.3` for the `darwin-amd64` override (which still has a `macosx_*_universal2` wheel)
2. Use `--only-binary cryptography` on all platforms, forbidding source builds
3. Run an `otool` check after packaging and reject Homebrew/MacPorts absolute paths
4. Cover `cryptography.fernet` with a smoke import

### Windows / pywin32

`mcp` / `docker` transitively depend on `pywin32` on win32. The packaging script:

1. Explicitly runs `uv pip install pywin32` if `packages/pywin32_system32` is missing
2. Copies `pywintypes*.dll` / `pythoncom*.dll` into `runtime/`
3. `launch.py` uses `site.addsitedir` to process `.pth` and `os.add_dll_directory`

Do **not** set `PYTHONPATH=packages` (it skips `.pth` and causes `No module named pywintypes`).

`windows-arm64` additionally excludes `psycopg-binary` / `sqlite-vec` which have no wheel, and pins `cryptography` to `46.0.0` (only that version ships a `win_arm64` wheel).

## CI

[`.github/workflows/octop-desktop.yml`](../../.github/workflows/octop-desktop.yml) produces zips on 6 runners:

`linux-amd64` `linux-arm64` `darwin-arm64` `darwin-amd64` `windows-amd64` `windows-arm64`

Actions use the GitHub upstream PBS (`PBS_BASE_URL`), and local builds default to the same GitHub upstream. Artifacts are uploaded with `archive: false` to avoid zip-in-zip.

## Electron shell

The shell only consumes `Octop-portable-<plat>-<version>.zip` (the inner directory is still `Octop-<plat>/`); do not bundle the green package into the asar. See
[`AGENT_ELECTRON_INTEGRATION.md`](AGENT_ELECTRON_INTEGRATION.md).
