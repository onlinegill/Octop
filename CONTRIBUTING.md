# Contributing to Octop

Thank you for your interest in contributing! Octop is the control-plane application in the [Octop Harness](https://github.com/onlinegill) ecosystem.

## Getting started

**Prerequisites:** Python 3.12+, Node.js 18+, [uv](https://docs.astral.sh/uv/)

```bash
git clone https://github.com/onlinegill/Octop.git octop
cd octop
make install          # backend dev dependencies
make install-hooks    # once per clone: pre-commit runs make all + dashboard build
make all              # format-all + backend lint + typecheck + test (ship bar)
```

For frontend work (separate terminal):

```bash
make dev-frontend     # Vite dev server
make lint-frontend
make typecheck-frontend
make check-all        # full stack quality gate
```

## Development workflow

| Command | Description |
|---------|-------------|
| `make install` | Install Python dev dependencies |
| `make install-hooks` | Point git at `.githooks` (pre-commit: `make all` + dashboard build) |
| `make all` | `format-all` + backend lint + typecheck + test |
| `make check-all` | Full stack quality gate |
| `make dev` | Start frontend + backend dev servers |
| `make build` | Build dashboard + Python wheel |

## Branching

| Branch | Role |
|--------|------|
| `main` | Production source of truth; GitHub default branch; only release / hotfix merges |
| `develop` | Daily integration; **open feature PRs against `develop`** |
| `release/x.y.z` | Temporary release snapshot; deleted after the version ships |
| `hotfix/*` | Emergency fix from `main`; merge to `main` and back to `develop` |

```
feature/* ──PR──► develop ──► release/x.y.z ──PR──► main ──tag v*──► publish
hotfix/* ──PR──► main (+ tag) and ──PR──► develop
```

**Rules:**

- Never push `develop` directly to `main` — ship only via `release/x.y.z` → `main` (or hotfix → `main`). Do **not** open `develop` → `main` bulk merges; they fork history and break post-release sync.
- Merge `release/x.y.z` → `main` with a **merge commit** (not squash). Squash drops shared ancestry with `develop`.
- Production `v*` tags are created **on `main` after** the release PR merges — not on the release branch before merge.
- After a release, `main` must stay an **ancestor** of `develop`. GitHub Actions runs `sync-main-to-develop.yml` (merge first; on conflict, a `chore/sync-develop-after-*` PR). Do not open legacy `head=main` → `develop` PRs.

## Pull requests

1. Fork (if needed) and create a feature branch from **`develop`**
2. Open the PR with base **`develop`** (not `main`, unless it is a release or hotfix)
3. Add or update tests for behavior changes — CI runs on **Linux and Windows**; follow the cross-platform rules in [AGENTS.md](AGENTS.md) §7 (prefer `tmp_path` / `pathlib`, `fake_bin_path` for mocked binaries, `posix_only` for Unix-only cases)
4. Ensure `make install-hooks` is enabled locally; run `make all` (backend) or `make check-all` (full stack) before submitting — pre-commit enforces the same gate
5. Update `CHANGELOG.md` when user-facing behavior changes
6. Open a PR with a clear description and test plan

See [AGENTS.md](AGENTS.md) for module boundaries and coding conventions.

## Releases

1. Cut `release/x.y.z` from latest `develop` (version bump + CHANGELOG on that branch)
2. Open PR: `release/x.y.z` → `main` and merge when green
3. Tag `v<version>` on **main tip** and push — GitHub Actions builds, publishes to PyPI, and creates the GitHub Release
4. Delete `release/x.y.z`; Actions syncs `main` → `develop` (or opens `chore/sync-develop-after-*` if merge conflicts / branch protection)

Agent-assisted publish: `.cursor/skills/publish` (`/publish <version>`).

### Hotfix

Branch from `main` → PR into `main` (tag if shipping a patch) → PR into `develop`.
