#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=== Fetching upstream updates from TencentCloud/Octop ==="
git remote add upstream https://github.com/TencentCloud/Octop.git 2>/dev/null || true
git fetch upstream main

echo "=== Merging upstream main ==="
git checkout main
git merge upstream/main -m "chore(sync): merge upstream TencentCloud/Octop updates" --allow-unrelated-histories || {
  echo "Conflict occurred during merge. Auto-resolving in favor of sanitization..."
  git checkout --ours dashboard/src/utils/localePrefs.ts 2>/dev/null || true
  git checkout --ours dashboard/src/pages/Agent/Channels/components/constants.ts 2>/dev/null || true
  git checkout --ours src/octop/infra/connectors/catalog.py 2>/dev/null || true
  git checkout --ours src/octop/infra/connectors/gateway/registry.py 2>/dev/null || true
  git checkout --ours src/octop/infra/db/migrate.py 2>/dev/null || true
  git checkout --ours src/octop/api/routers/setup.py 2>/dev/null || true
  git add -A
  git commit -m "chore(sync): auto-resolve conflicts preserving English/sanitization" || true
}

echo "=== Re-applying English & Non-China sanitization rules ==="
python3 scripts/sanitize_non_chinese.py

if ! git diff-index --quiet HEAD; then
  echo "=== Committing sanitization ==="
  git add -A
  git commit -m "chore(sanitize): remove China-hosted services and enforce English defaults"
  git push origin main
  echo "=== Successfully updated and pushed to origin/main ==="
else
  echo "=== Already up to date and clean ==="
fi
