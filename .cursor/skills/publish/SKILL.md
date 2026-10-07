---
name: publish
description: >-
  Publish the Octop Python package: cut a release branch from develop, bump
  version, update CHANGELOG, open a PR to main; after merge, Actions tag on
  main (PyPI / Docker Hub + GHCR) and sync main into develop. Use when the user asks
  to publish, release, bump version, cut a release, or run /publish.
disable-model-invocation: true
---

# Publish

Automate the complete release flow for the Octop Python package.

**Announce at the start:** "Publishing version {VERSION} using the publish skill."

## Configuration

The following settings have defaults and can be overridden in the project's `.cursor/skills/publish/SKILL.md`.

| Setting | Default | Description |
|--------|--------|------|
| `CHANGELOG_FILE` | `CHANGELOG.md` | Path relative to the repository root; skipped if the file does not exist |
| `VERSION_FILE` | `pyproject.toml` | The file containing the version number |
| `VERSION_PATTERN` | `^\s*version\s*=\s*"[^"]+"` | Regular expression matching the version line |
| `README_GLOB` | `README*.md` | READMEs containing the shields.io version badge; all are upgraded in sync |
| `INIT_VERSION_FILE` | `src/octop/__init__.py` | The file containing the `__version__` runtime constant (skipped with a notice if missing) |
| `TAG_PREFIX` | `v` | Git tag prefix; workflows listen for `v*` and produce tags like `v0.1.14` |
| `REMOTE` | `origin` | Git remote name |
| `INTEGRATION_BRANCH` | `develop` | Daily integration branch; releases must be cut from its latest tip |
| `TARGET_BRANCH` | `main` | Target branch for the merge request (production source of truth) |
| `RELEASE_BRANCH_PREFIX` | `release/` | Release branch name prefix |

## Invocation

```
/publish 0.1.14
```

The target version is the only required argument; everything else comes from configuration or is auto-detected.

## Release flow

> **Hard ordering constraint:** merge the PR into `main` first, then tag and push `v*` on the **main tip**.  
> **Never** push a production tag before the release branch has merged into `main`.

### Step 1 — Read configuration and confirm the version

1. Get the repository root: `git rev-parse --show-toplevel`
2. Record the current branch as `{original_branch}`.
3. `git fetch {REMOTE} {INTEGRATION_BRANCH} {TARGET_BRANCH}`
4. Read the current version from `VERSION_FILE` (on the integration tip you are about to base on):
   ```bash
   git show {REMOTE}/{INTEGRATION_BRANCH}:pyproject.toml | grep -E '^\s*version\s*=\s*"[^"]+"'
   ```
5. Check for uncommitted changes:
   ```bash
   git status --short
   ```
   If the working tree is not clean: **abort** and ask the user to commit or stash first. A release must not carry unrelated dirty files.
6. Find the most recent git tag:
   ```bash
   git tag --sort=-creatordate | head -1
   ```
   If there is no tag, treat this as the first release (use all commits from the repository start to HEAD in step 3).
7. Show the confirmation:

```
Current version (pyproject.toml @ develop): X.Y.Z
Target version:                             A.B.C
Last release tag:                           vX.Y.Z (YYYY-MM-DD)
Release branch:                             release/A.B.C
Integration base:                           develop
Merge target:                               main
Tag timing:                                 after merging into main (no tag on the release branch first)

Confirm release X.Y.Z → A.B.C? [y/N]
```

If the user does not type `y` to confirm, abort immediately.

### Step 2 — Create the release branch from develop

```bash
git checkout -B {RELEASE_BRANCH_PREFIX}{version} {REMOTE}/{INTEGRATION_BRANCH}
```

If a release branch with the same name already exists locally or remotely, abort:
```
✗ Branch {RELEASE_BRANCH_PREFIX}{version} already exists.
Delete it manually, then run /publish again.
```

### Step 3 — Analyze changes and generate a CHANGELOG draft

1. Get the commits since the last tag (relative to the current release HEAD, i.e. the develop tip):
   ```bash
   git log {last_tag}..HEAD --oneline
   # For the first release:
   git log --oneline
   ```

2. If no commits are found:
   ```
   ⚠ No new commits since the last release tag ({last_tag}).
   Continue? [y/N]
   ```
   Abort if the user does not confirm.

3. Classify by commit prefix and generate Keep a Changelog entries.

   **The CHANGELOG content must be written in English.** Summarize each commit as a concise English bullet — do not translate commit messages verbatim. Merge related commits where appropriate.

   Classification rules:
   - Starts with `feat:` or `feat(` → **Added**
   - Starts with `fix:` or `fix(` → **Fixed**
   - Starts with `refactor:` or `perf:` → **Changed**
   - Contains `!:` or a `BREAKING CHANGE:` line in the body → **Changed**, prefixed with `**Breaking:**`
   - Starts with `docs:` → **Changed**
   - Starts with `chore:`, `test:`, `ci:` → ignore (infrastructure noise)
   - Any other commit → **Changed**
   - Removed features → **Removed**
   - Security fixes → **Security**

   Output format:
   ```markdown
   ## [A.B.C] - YYYY-MM-DD

   ### Added
   - English description of the added features

   ### Fixed
   - English description of the fixes

   ### Changed
   - English description of the behavior changes

   ### Removed
   - English description of what was removed

   ### Security
   - English description of the security fixes
   ```
   Omit empty categories. Use ISO 8601 for the date (today's date). Keep a blank line between the date line and the first category, and between categories.

4. Show the draft to the user and ask for confirmation:
   ```
   CHANGELOG draft:

   {draft}

   Add to CHANGELOG.md? [y/N/edit]
   ```
   - `y` → continue
   - `n` → abort
   - `edit` or other feedback → ask the user "What should change?" — wait for the reply, regenerate, and show the confirmation again. Loop until `y` or `n`.

5. If `CHANGELOG_FILE` does not exist, skip this step (no warning needed).

### Step 4 — Update files, commit, and push the release branch

Perform in order:

**4a. Update the CHANGELOG:**

In `CHANGELOG_FILE`, find the `## [Unreleased]` heading and insert the new version entry after it (keeping `[Unreleased]` empty):

```markdown
## [Unreleased]

## [A.B.C] - YYYY-MM-DD
### Added
- ...
```

If the `## [Unreleased]` heading does not exist, insert the new entry after the `# Changelog` heading line (or at the top of the file if there is no heading).

**4b. Bump the version number (sync all version sources):**

The release version must stay consistent across multiple files. Bump each of the following in order:

1. `VERSION_FILE` (`pyproject.toml`) — the single source of truth for the wheel / PyPI:
   ```bash
   grep -n '^\s*version\s*=\s*"[^"]+"' pyproject.toml
   # Replace "X.Y.Z" with "A.B.C" on that line using the Edit tool
   ```
2. All READMEs matching `README_GLOB` that contain the shields.io version badge:
   ```bash
   # Discover the files to upgrade (do not only edit README.md)
   grep -l 'shields.io/badge/version-' README.md README_*.md 2>/dev/null
   # For each file that matches:
   grep -n 'shields.io/badge/version-' {file}
   # Replace `version-X.Y.Z-orange` with `version-A.B.C-orange` using the Edit tool
   ```
   The current repository includes at least `README.md`; skip any file without a badge.
   If nothing matches, show a notice and continue (do not abort).
3. `INIT_VERSION_FILE` (`src/octop/__init__.py`) — the `__version__` runtime constant:
   ```bash
   grep -n '__version__' src/octop/__init__.py
   # Replace `__version__ = "X.Y.Z"` with `"A.B.C"` using the Edit tool
   ```
   Skip with a notice if the file does not exist (do not abort).
4. The `version=` fields of the two FnOS manifests (keep them consistent with `pyproject.toml`; `scripts/build-fpk.sh` also injects the version again when packaging, but the repository source files must be updated first so the store listing / manual checks do not show a stale number):
   ```bash
   grep -n '^version=' fnos/docker/manifest fnos/native/manifest
   # Replace both `version=X.Y.Z` with `version=A.B.C` using the Edit tool
   ```
   Both files must be updated. If a file is missing, show a notice and continue (do not abort).

**4c. Commit:**

```bash
git status --short
```

- If there are changes: stage and commit:
  ```bash
  git add -A
  git commit -m "chore: release {version}"
  ```
- If the working tree is already clean: nothing to commit, skip.

**4d. Push the release branch:**
```bash
git push -u {REMOTE} {RELEASE_BRANCH_PREFIX}{version}
```

Abort if the push fails.

### Step 5 — Open the Pull Request into main (merge first, auto-tag after)

Using the `gh` CLI:

```bash
gh pr create \
  --base {TARGET_BRANCH} \
  --head {RELEASE_BRANCH_PREFIX}{version} \
  --title "chore: release {version}" \
  --body "$(cat <<'EOF'
{CHANGELOG entries generated in step 3}

## Release checklist
- [ ] CI green
- [ ] Merge this PR into main
- [ ] After merge, GitHub Action auto-pushes v{version} tag on main tip
EOF
)"
```

- On success, show the PR URL and state clearly:
  - Do not tag manually before merging;
  - The release is published automatically after the merge (the tag is created automatically).
- If `gh` fails: abort (nothing has been released yet) and prompt to create the PR manually:
  `{RELEASE_BRANCH_PREFIX}{version}` → `{TARGET_BRANCH}`

### Step 6 — After the merge, the Action tags on the main tip

1. Ask the user whether the PR has merged, or poll:
   ```bash
   gh pr view {pr_url} --json state,mergedAt
   ```
   Wait until merged; there is no need to tag locally.

2. After the merge:
   - `auto-tag-on-release.yml` reads the version from the merged `main`'s `pyproject.toml` and pushes `{TAG_PREFIX}{version}`.
   - If the tag already exists, the Action skips it and logs this.

3. Prompt the user to confirm in Actions:
   - `Auto Tag On Release Merge` succeeded;
   - `Release` and `Docker Publish` triggered by the `v*` tag and passed;
   - `Sync Main Into Develop` syncs `main` back into `develop` after the GitHub Release is published.

### Step 7 — Delete the release branch; develop is synced by the Action

1. Delete the remote and local release branch:
   ```bash
   git push {REMOTE} --delete {RELEASE_BRANCH_PREFIX}{version}
   git branch -D {RELEASE_BRANCH_PREFIX}{version}
   ```
   Warn on failure (non-fatal) and prompt for manual deletion.

2. **develop sync**: after the GitHub Release is published successfully, `sync-main-to-develop.yml` automatically opens a `main → develop` PR and, when there are no conflicts, merges it with a **merge commit**.
   - If it is already fast-forward with no diff, the Action skips it.
   - On conflicts or branch-protection blocks, the Action leaves the PR and warns; handle it manually.
   - The skill does not need to create the sync PR manually (unless the Action fails).

### Step 8 — Check out the original branch

```bash
git checkout {original_branch}
```

Make sure the user is not left on the release / temporary checkout when the flow ends.

## Error handling reference

| Scenario | Behavior |
|------|------|
| `VERSION_FILE` not found | Abort: "VERSION_FILE not found: {path}" |
| No version line matched in the file | Abort: "No version line matching {VERSION_PATTERN} found in {VERSION_FILE}" |
| Working tree not clean | Abort: clean up before releasing |
| No git tag (first release) | Use full history; announce "first release" |
| No commits since the last tag | Warn and ask whether to continue |
| Release branch already exists | Abort and give the delete command |
| Step 4 push fails | Abort: files were updated locally but not pushed |
| Step 5 PR creation fails | Abort (no tag yet / nothing released) |
| Step 6 tagging manually before merge | **Forbidden** — hard red line |
| Step 6 tag already exists | Abort and give the delete command |
| Step 6 tag pushed but the Action fails | Non-fatal: prompt to Re-run in Actions |
| Step 7 branch delete or sync PR fails | Warn and give the manual command |

## Red lines

**Never:**
- Push a production `v*` tag on a release / feature branch **before** merging into `main`
- Upload to PyPI directly before pushing the tag (publishing is handled by the GitHub Action)
- Push / merge `develop` directly into `main` (must go through a PR)
- Skip the user confirmation in step 1
- Skip the CHANGELOG confirmation in step 3
- Continue after any step fails (except the cleanup/sync warnings in step 7)
- Leave the user on the release branch when the flow ends
- Keep a shipped `release/*` around as a long-lived branch

**Always:**
- Cut the release from the latest `{REMOTE}/{INTEGRATION_BRANCH}`
- Merge into `{TARGET_BRANCH}` first, then let the Action tag on the main tip
- Delete `release/*` after release; `main → develop` is synced automatically by `sync-main-to-develop.yml` (fix manually only on failure)
- Show the full error output before aborting
- Keep `[Unreleased]` empty after inserting the new version entry
- Upgrade every README containing the shields.io version badge (`README.md`, etc.), not just one
- Keep the `version=` fields in `fnos/docker/manifest` and `fnos/native/manifest` in sync, not just `pyproject.toml`
- After pushing the tag, prompt the user to watch the GitHub Actions release result
