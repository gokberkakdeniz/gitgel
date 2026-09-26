#!/usr/bin/env bash
# Builds Gitgel.app, zips it and uploads the zip to the GitHub release <version>, creating the
# release (and its tag, on GitHub) when it does not exist yet. Run with `pnpm release`.
#
# The version comes from src-tauri/tauri.conf.json. The build must match a pushed commit, so the
# working tree has to be clean and HEAD pushed. Re-running for the same version replaces the zip,
# as long as the release still points at HEAD; after new commits, bump the version first.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not installed"
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub; run: gh auth login"

VERSION="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
TAG="$VERSION"
ARCH="$(uname -m)"
BUNDLE="src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Gitgel.app"
ZIP="$BUNDLE/Gitgel-$VERSION-macos-$ARCH.zip"

[[ -z "$(git status --porcelain)" ]] || die "uncommitted changes; commit them first"
HEAD_SHA="$(git rev-parse HEAD)"
[[ -n "$(git branch -r --contains "$HEAD_SHA")" ]] || die "HEAD is not pushed; push it first"

# An existing tag must already point at this commit.
REMOTE_TAG_SHA="$(git ls-remote origin "refs/tags/$TAG^{}" "refs/tags/$TAG" | awk 'NR==1 { print $1 }')"
if [[ -n "$REMOTE_TAG_SHA" && "$REMOTE_TAG_SHA" != "$HEAD_SHA" ]]; then
  die "$TAG already points at ${REMOTE_TAG_SHA:0:7}, not HEAD (${HEAD_SHA:0:7}); bump the version in src-tauri/tauri.conf.json, package.json and src-tauri/Cargo.toml"
fi

pnpm tauri build --bundles app

# ditto keeps the bundle's macOS metadata (symlinks, permissions) intact.
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP" --clobber
else
  gh release create "$TAG" "$ZIP" \
    --target "$HEAD_SHA" \
    --title "Gitgel $VERSION" \
    --notes "Unsigned macOS build ($ARCH). After unzipping, right-click Gitgel.app → Open the first time, since it is not notarized."
fi

echo "Uploaded $(basename "$ZIP") to $TAG: $(gh release view "$TAG" --json url --jq .url)"
