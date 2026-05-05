#!/usr/bin/env bash
#
# Hermetic end-to-end test for `mink upgrade` and the cli-self-update task.
#
# Packs the local repo as `@drewpayment/mink@${OLD_VERSION}` (a deliberately
# downgraded version), installs it in a clean node:20-slim container, then
# runs the upgrade against the real npm registry and verifies the version
# bumps to the latest published release.
#
# This exercises:
#   - registry round-trip via fetch()
#   - semver comparison detecting that older < latest
#   - package-manager auto-detection (will pick npm in this image)
#   - the actual `npm install -g` spawn
#   - post-install version verification
#   - self-update.log writes
#
# Requires: docker, node/npm, bun. Run from anywhere inside the repo.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

OLD_VERSION="${OLD_VERSION:-0.9.0}"
IMAGE="${IMAGE:-node:20-slim}"

echo "==> Building dist/cli.js"
(cd "$ROOT" && bun run build > /dev/null)

echo "==> Staging repo and pinning version to ${OLD_VERSION}"
mkdir -p "$TMP/repo"
# Copy only what npm pack would include, plus package.json. The 'files' field
# in package.json controls what ends up in the tarball, so this is enough.
cp "$ROOT/package.json" "$TMP/repo/"
cp "$ROOT/README.md" "$TMP/repo/" 2>/dev/null || true
cp "$ROOT/LICENSE" "$TMP/repo/" 2>/dev/null || true
mkdir -p "$TMP/repo/dist" "$TMP/repo/src"
cp "$ROOT/dist/cli.js" "$TMP/repo/dist/"
cp -R "$ROOT/src/." "$TMP/repo/src/"
[ -d "$ROOT/skills" ] && cp -R "$ROOT/skills" "$TMP/repo/" || true
[ -d "$ROOT/agents" ] && cp -R "$ROOT/agents" "$TMP/repo/" || true
[ -d "$ROOT/dashboard/out" ] && { mkdir -p "$TMP/repo/dashboard"; cp -R "$ROOT/dashboard/out" "$TMP/repo/dashboard/"; } || true

node -e "
  const f=require('fs');
  const p='$TMP/repo/package.json';
  const pkg=JSON.parse(f.readFileSync(p,'utf8'));
  pkg.version='${OLD_VERSION}';
  // Drop the postinstall — bun isn't on the slim image and we already shipped
  // a pre-built dist/cli.js. The published tarball that gets installed during
  // the upgrade still has its own postinstall (which silently no-ops without bun).
  if (pkg.scripts) delete pkg.scripts.postinstall;
  f.writeFileSync(p, JSON.stringify(pkg, null, 2));
"

(cd "$TMP/repo" && npm pack --silent > "$TMP/tarball-name")
TARBALL_NAME=$(cat "$TMP/tarball-name")
mv "$TMP/repo/$TARBALL_NAME" "$TMP/mink-test.tgz"
echo "    packed: $TARBALL_NAME"

echo "==> Running upgrade test in $IMAGE"
docker run --rm \
  -v "$TMP/mink-test.tgz:/mink.tgz:ro" \
  "$IMAGE" bash -ec '
    set -e

    echo "--- installing local tarball as starting version ---"
    npm install -g /mink.tgz --silent

    echo
    echo "Before upgrade:"
    mink --version

    echo
    echo "--- mink upgrade --check ---"
    mink upgrade --check

    echo
    echo "--- mink upgrade --yes ---"
    mink upgrade --yes

    echo
    echo "After upgrade:"
    AFTER=$(mink --version | head -1)
    echo "$AFTER"

    echo
    echo "--- ~/.mink/self-update.log ---"
    cat ~/.mink/self-update.log

    echo
    BEFORE_VERSION="'"${OLD_VERSION}"'"
    if echo "$AFTER" | grep -q "mink $BEFORE_VERSION$"; then
      echo "FAIL: version did not change from $BEFORE_VERSION"
      exit 1
    fi
    echo "PASS: version bumped from $BEFORE_VERSION → $(echo "$AFTER" | sed "s/^mink //")"
  '

echo "==> Done"
