#!/usr/bin/env bash
# Builds Gitgel.app, zips it and uploads the zip to the GitHub release <version>, creating the
# release (and its tag, on GitHub) when it does not exist yet. Run with `pnpm release`.
#
# Then publishes it to the Homebrew tap (`brew install --cask gokberkakdeniz/tap/gitgel`): this
# repository is private, so brew cannot download from its releases; the zip also goes to the
# public tap repository's release gitgel-<version>, and the cask there is updated and pushed.
# The tap is a clone of that repository next to this one, or at $GITGEL_TAP_DIR.
#
# In-app updates: the build is also packed as a signed `.app.tar.gz` (the updater key, by default
# ~/.tauri/gitgel.key, or $GITGEL_UPDATER_KEY), uploaded next to the zip in the tap release, and
# the tap's gitgel/latest.json (the app's update endpoint) is pointed at it in the cask's commit.
#
# Signing: the build is signed with the Developer ID Application certificate in the keychain and
# notarized (the ticket stapled to the app) with the Apple ID in the keychain item gitgel-notary
# (account = Apple ID, password = an app-specific password); the team id is the certificate's.
# A plain `pnpm tauri build` stays ad-hoc signed and needs neither.
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
UPDATER_KEY="${GITGEL_UPDATER_KEY:-$HOME/.tauri/gitgel.key}"
UPDATE="$BUNDLE/Gitgel-$VERSION-macos-$ARCH.app.tar.gz"
LATEST="gitgel/latest.json"

[[ -f "$UPDATER_KEY" ]] || die "no updater key at $UPDATER_KEY; restore it or set GITGEL_UPDATER_KEY"
SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -nE 's/.*"(Developer ID Application: .*)"$/\1/p' | head -1)"
[[ -n "$SIGNING_IDENTITY" ]] || die "no Developer ID Application certificate in the keychain"
TEAM_ID="$(sed -nE 's/.*\(([A-Z0-9]+)\)$/\1/p' <<<"$SIGNING_IDENTITY")"
[[ -n "$TEAM_ID" ]] || die "no team id in \"$SIGNING_IDENTITY\""
NOTARY_ITEM="gitgel-notary"
NOTARY_APPLE_ID="$(security find-generic-password -s "$NOTARY_ITEM" 2>/dev/null | sed -nE 's/^ *"acct"<blob>="(.*)"$/\1/p')"
[[ -n "$NOTARY_APPLE_ID" ]] || die "no notary password; run: security add-generic-password -s $NOTARY_ITEM -a <apple id> -w"
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

# The updater artifacts (Gitgel.app.tar.gz and its .sig) are made only here, so a plain
# `pnpm tauri build` needs no key.
rm -f "$BUNDLE/macos/Gitgel.app.tar.gz" "$BUNDLE/macos/Gitgel.app.tar.gz.sig"
BUILD_CONFIG="$(node -e '
  const signingIdentity = process.argv[1];
  console.log(JSON.stringify({ bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity } } }));
' "$SIGNING_IDENTITY")"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${GITGEL_UPDATER_KEY_PASSWORD:-}" \
  APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" APPLE_TEAM_ID="$TEAM_ID" APPLE_ID="$NOTARY_APPLE_ID" \
  APPLE_PASSWORD="$(security find-generic-password -s "$NOTARY_ITEM" -w)" \
  pnpm tauri build --bundles app --config "$BUILD_CONFIG"
[[ -f "$BUNDLE/macos/Gitgel.app.tar.gz.sig" ]] || die "the build made no signed update"
codesign --verify --deep --strict "$APP" || die "the app's signature does not verify"
xcrun stapler validate -q "$APP" || die "no notarization ticket stapled to the app"
spctl --assess --type execute "$APP" || die "Gatekeeper rejects the app"
cp "$BUNDLE/macos/Gitgel.app.tar.gz" "$UPDATE"

# ditto keeps the bundle's macOS metadata (symlinks, permissions) intact.
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP" --clobber
else
  gh release create "$TAG" "$ZIP" \
    --target "$HEAD_SHA" \
    --title "Gitgel $VERSION" \
    --notes "macOS build ($ARCH), signed with Developer ID and notarized."
fi

echo "Uploaded $(basename "$ZIP") to $TAG: $(gh release view "$TAG" --json url --jq .url)"

# Homebrew tap: the zip and the update first, then the cask and latest.json that point at them.
if gh release view "$TAP_TAG" --repo "$TAP_REPO" >/dev/null 2>&1; then
  gh release upload "$TAP_TAG" "$ZIP" "$UPDATE" --repo "$TAP_REPO" --clobber
else
  gh release create "$TAP_TAG" "$ZIP" "$UPDATE" \
    --repo "$TAP_REPO" \
    --title "Gitgel $VERSION" \
    --notes "Gitgel $VERSION for macOS ($ARCH). Install with: brew install --cask gokberkakdeniz/tap/gitgel"
fi
SHA256="$(shasum -a 256 "$ZIP" | awk '{ print $1 }')"
sed -i '' -E \
  -e "s/^  version \".*\"$/  version \"$VERSION\"/" \
  -e "s/^  sha256 \".*\"$/  sha256 \"$SHA256\"/" \
  "$TAP_DIR/$CASK"
mkdir -p "$TAP_DIR/$(dirname "$LATEST")"
VERSION="$VERSION" \
  URL="https://github.com/$TAP_REPO/releases/download/$TAP_TAG/$(basename "$UPDATE")" \
  SIG="$BUNDLE/macos/Gitgel.app.tar.gz.sig" \
  node -e '
    const fs = require("fs");
    const { VERSION, URL, SIG } = process.env;
    const latest = {
      version: VERSION,
      pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      platforms: { "darwin-aarch64": { url: URL, signature: fs.readFileSync(SIG, "utf8").trim() } },
    };
    process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
  ' >"$TAP_DIR/$LATEST"
git -C "$TAP_DIR" add -- "$CASK" "$LATEST"
if git -C "$TAP_DIR" diff --cached --quiet; then
  echo "Cask already at $VERSION"
else
  git -C "$TAP_DIR" commit -q -m "gitgel $VERSION"
  git -C "$TAP_DIR" push -q
  echo "Cask and update feed at $VERSION: brew upgrade --cask gitgel, or the app updates itself"
fi
