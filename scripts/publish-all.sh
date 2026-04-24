#!/usr/bin/env bash
#
# Publish every package to the npm registry in dependency order.
#
# Usage:
#   npm run publish:all              # real publish
#   npm run publish:all -- --dry-run # preflight everything without uploading
#
# Prerequisites:
#   - `npm login` must have been run (registry auth lives in ~/.npmrc)
#   - Your npm user must have publish rights to the @quave scope
#   - Working tree should be clean (we refuse to publish dirty state)

set -euo pipefail

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
fi

# Core first — adapters depend on it via ^2.0.0.
PACKAGES=(
  "@quave/migrations"
  "@quave/migrations-mongodb"
  "@quave/migrations-postgres"
  "@quave/migrations-redshift"
)

# Preflight
if ! npm whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in to npm. Run \`npm login\` first." >&2
  exit 1
fi

if [[ -z "$DRY_RUN" ]] && ! git diff-index --quiet HEAD --; then
  echo "ERROR: working tree is dirty. Commit or stash before publishing." >&2
  exit 1
fi

NPM_USER=$(npm whoami)
echo "Logged in as: $NPM_USER"
if [[ -n "$DRY_RUN" ]]; then
  echo "DRY RUN — nothing will be uploaded."
fi
echo

for pkg in "${PACKAGES[@]}"; do
  echo "--- $pkg ---"
  version=$(node -p "require('./packages/${pkg#@quave/}/package.json').version")
  echo "  version:  $version"

  # Refuse if this version is already on the registry (non-dry-run only).
  if [[ -z "$DRY_RUN" ]] && npm view "$pkg@$version" version >/dev/null 2>&1; then
    echo "  SKIP: $pkg@$version is already published."
    echo
    continue
  fi

  # `prepublishOnly` inside each package runs `npm run clean && npm run build`.
  npm publish -w "$pkg" $DRY_RUN
  echo
done

echo "Done."
