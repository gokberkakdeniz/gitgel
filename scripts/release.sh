#!/usr/bin/env bash
# Builds Gitgel.app, zips it and uploads the zip to the GitHub release <version>, creating the
# release (and its tag, on GitHub) when it does not exist yet. Run with `pnpm release`.
#
# Then publishes it to the Homebrew tap (`brew install --cask gokberkakdeniz/tap/gitgel`): this
# repository is private, so brew cannot download from its releases; the zip also goes to the
# public tap repository's release gitgel-<version>, and the cask there is updated and pushed.
# The tap is a clone of that repository next to this one, or at $GITGEL_TAP_DIR.
#
# The version is the app's (package.json, via src-tauri/tauri.conf.json). The build must match a
# pushed commit, so the
# working tree has to be clean and HEAD pushed. Re-running for the same version replaces the zip,
# as long as the release still points at HEAD; after new commits, bump the version first.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not installed"
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub; run: gh auth login"

# tauri.conf.json may hold the version itself or point at a file that does ("../package.json").
VERSION="$(node -p '
  const path = require("path");
  const conf = "./src-tauri/tauri.conf.json";
  const v = require(conf).version;
  v.endsWith(".json") ? require("./" + path.join("src-tauri", v)).version : v;
')"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "not a version: $VERSION"
TAG="$VERSION"
ARCH="$(uname -m)"
BUNDLE="src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Gitgel.app"
ZIP="$BUNDLE/Gitgel-$VERSION-macos-$ARCH.zip"

TAP_REPO="gokberkakdeniz/homebrew-tap"
TAP_DIR="${GITGEL_TAP_DIR:-../homebrew-tap}"
CASK="Casks/gitgel.rb"
TAP_TAG="gitgel-$VERSION"

[[ -z "$(git status --porcelain)" ]] || die "uncommitted changes; commit them first"
HEAD_SHA="$(git rev-parse HEAD)"
[[ -n "$(git branch -r --contains "$HEAD_SHA")" ]] || die "HEAD is not pushed; push it first"

# An existing tag must already point at this commit.
REMOTE_TAG_SHA="$(git ls-remote origin "refs/tags/$TAG^{}" "refs/tags/$TAG" | awk 'NR==1 { print $1 }')"
if [[ -n "$REMOTE_TAG_SHA" && "$REMOTE_TAG_SHA" != "$HEAD_SHA" ]]; then
  die "$TAG already points at ${REMOTE_TAG_SHA:0:7}, not HEAD (${HEAD_SHA:0:7}); bump the version in package.json"
fi

# The tap is checked before building, so a release never stops half-way for it.
[[ "$ARCH" == arm64 ]] || die "the cask is for Apple silicon (arm64), this Mac is $ARCH"
[[ -f "$TAP_DIR/$CASK" ]] || die "no $CASK in $TAP_DIR; clone $TAP_REPO there or set GITGEL_TAP_DIR"
[[ -z "$(git -C "$TAP_DIR" status --porcelain)" ]] || die "uncommitted changes in $TAP_DIR"
git -C "$TAP_DIR" pull -q --ff-only
[[ -n "$(git -C "$TAP_DIR" branch -r --contains HEAD)" ]] || die "$TAP_DIR has unpushed commits"

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
    --notes "macOS build ($ARCH), ad-hoc signed, not notarized. The first time: open Gitgel.app, then System Settings → Privacy & Security → Open Anyway. Or in Terminal: xattr -dr com.apple.quarantine /Applications/Gitgel.app"
fi

echo "Uploaded $(basename "$ZIP") to $TAG: $(gh release view "$TAG" --json url --jq .url)"

# Homebrew tap: the zip first, then the cask that points at it.
if gh release view "$TAP_TAG" --repo "$TAP_REPO" >/dev/null 2>&1; then
  gh release upload "$TAP_TAG" "$ZIP" --repo "$TAP_REPO" --clobber
else
  gh release create "$TAP_TAG" "$ZIP" \
    --repo "$TAP_REPO" \
    --title "Gitgel $VERSION" \
    --notes "Gitgel $VERSION for macOS ($ARCH). Install with: brew install --cask gokberkakdeniz/tap/gitgel"
fi
SHA256="$(shasum -a 256 "$ZIP" | awk '{ print $1 }')"
sed -i '' -E \
  -e "s/^  version \".*\"$/  version \"$VERSION\"/" \
  -e "s/^  sha256 \".*\"$/  sha256 \"$SHA256\"/" \
  "$TAP_DIR/$CASK"
if git -C "$TAP_DIR" diff --quiet -- "$CASK"; then
  echo "Cask already at $VERSION"
else
  git -C "$TAP_DIR" commit -q -m "gitgel $VERSION" -- "$CASK"
  git -C "$TAP_DIR" push -q
  echo "Cask updated to $VERSION: brew upgrade --cask gitgel"
fi
