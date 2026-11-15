#!/usr/bin/env bash
# Builds Gitgel.app, zips it and uploads the zip to the GitHub release <version>, creating the
# release (and its tag, on GitHub) when it does not exist yet. Run with `pnpm release`.
#
# In-app updates: the build is also packed as a signed `.app.tar.gz` (the updater key, by default
# ~/.tauri/gitgel.key, or $TAURI_SIGNING_PRIVATE_KEY) and uploaded next to the zip with a
# `latest.json` that points at it; the app's update endpoint is the newest release's
# `latest.json` (releases/latest/download).
#
# Homebrew (`brew install --cask gokberkakdeniz/tap/gitgel`): the cask in the tap is fixed
# (`version :latest`) and downloads the newest release's `Gitgel-macos-<arch>.zip`, a copy of the
# zip under a name without the version. Nothing is published to the tap.
#
# Versions up to 0.2.5 read the update feed from the tap (`gitgel/latest.json` there). While
# that file still points into the tap, a release moves it once to this release's update, so
# those installs update and then follow the new endpoint. It needs the tap's clone next to this
# repository, or at $GITGEL_TAP_DIR; without one the step is skipped with a warning.
#
# Signing: the build is signed with the Developer ID Application certificate in the keychain and
# notarized (the ticket stapled to the app) with an App Store Connect API key, in Tauri's variables:
# $APPLE_API_KEY_PATH (by default ~/.private_keys/AuthKey_<key id>.p8), $APPLE_API_KEY (by default
# the key id from the file's name) and $APPLE_API_ISSUER (the team's issuer id, never in the repo).
# Only the key's path goes on notarytool's command line, never a secret.
# A plain `pnpm tauri build` stays ad-hoc signed and needs neither.
#
# Release notes: the version's section of CHANGELOG.md (SPEC §12 "Release notes") is the text of
# both GitHub releases, and the last 10 sections are latest.json's `notes`.
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

REPO="gokberkakdeniz/gitgel"
# The same zip under a name without the version, for the cask's fixed URL.
ZIP_LATEST="$BUNDLE/Gitgel-macos-$ARCH.zip"
FEED="$BUNDLE/latest.json"
TAP_DIR="${GITGEL_TAP_DIR:-../homebrew-tap}"
UPDATER_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/gitgel.key}"
UPDATE="$BUNDLE/Gitgel-$VERSION-macos-$ARCH.app.tar.gz"
LATEST="gitgel/latest.json"

CHANGELOG="CHANGELOG.md"
# A version's section of the changelog, without its heading and the blank lines around it.
section() {
  awk -v head="## $1 " '/^## / { if (on) exit; on = index($0, head) == 1; next } on' "$CHANGELOG" |
    sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
}
NOTES="$(section "$VERSION")"
grep -q '^- ' <<<"$NOTES" || die "no notes for $VERSION in $CHANGELOG; write its section first"
# Under the notes, after a rule: how it is signed (this repo) or how to install it (the tap).
INSTALL_NOTE=$'<hr>\n\nSigned and notarized by Apple. Install with Homebrew:\n```bash\nbrew install --cask gokberkakdeniz/tap/gitgel\n```'
# The sections the update feed carries, newest first, headings included.
FEED_NOTES="$(awk '/^## / { n++ } n >= 1 && n <= 10' "$CHANGELOG")"

# Tauri takes the key itself or its path; a path is read here, as before.
[[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" || -f "$UPDATER_KEY" ]] || die "no updater key at $UPDATER_KEY; restore it or set TAURI_SIGNING_PRIVATE_KEY"
[[ -f "$UPDATER_KEY" ]] && UPDATER_KEY="$(cat "$UPDATER_KEY")"
# By the certificate's SHA-1: codesign no longer finds a name with non-ASCII letters (the "ö").
SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -nE 's/^ *[0-9]+\) ([0-9A-F]{40}) "Developer ID Application: .*"$/\1/p' | head -1)"
[[ -n "$SIGNING_IDENTITY" ]] || die "no Developer ID Application certificate in the keychain"
NOTARY_KEY="${APPLE_API_KEY_PATH:-$(ls "$HOME"/.private_keys/AuthKey_*.p8 2>/dev/null | head -1)}"
[[ -f "$NOTARY_KEY" ]] || die "no App Store Connect API key; put AuthKey_<key id>.p8 in ~/.private_keys or set APPLE_API_KEY_PATH"
NOTARY_KEY_ID="$(basename "$NOTARY_KEY" .p8)"
NOTARY_KEY_ID="${APPLE_API_KEY:-${NOTARY_KEY_ID#AuthKey_}}"
NOTARY_ISSUER="${APPLE_API_ISSUER:-}"
[[ -n "$NOTARY_ISSUER" ]] || die "no App Store Connect issuer id; set APPLE_API_ISSUER"
[[ -z "$(git status --porcelain)" ]] || die "uncommitted changes; commit them first"
HEAD_SHA="$(git rev-parse HEAD)"
[[ -n "$(git branch -r --contains "$HEAD_SHA")" ]] || die "HEAD is not pushed; push it first"

# An existing tag must already point at this commit.
REMOTE_TAG_SHA="$(git ls-remote origin "refs/tags/$TAG^{}" "refs/tags/$TAG" | awk 'NR==1 { print $1 }')"
if [[ -n "$REMOTE_TAG_SHA" && "$REMOTE_TAG_SHA" != "$HEAD_SHA" ]]; then
  die "$TAG already points at ${REMOTE_TAG_SHA:0:7}, not HEAD (${HEAD_SHA:0:7}); bump the version in package.json"
fi

[[ "$ARCH" == arm64 ]] || die "the cask and the update feed are for Apple silicon (arm64), this Mac is $ARCH"

# The tap's old feed, while it still points into the tap (see the top): checked before building,
# so a release never stops half-way for it.
MOVE_TAP_FEED=
if [[ -f "$TAP_DIR/$LATEST" ]]; then
  [[ -z "$(git -C "$TAP_DIR" status --porcelain)" ]] || die "uncommitted changes in $TAP_DIR"
  git -C "$TAP_DIR" pull -q --ff-only
  [[ -n "$(git -C "$TAP_DIR" branch -r --contains HEAD)" ]] || die "$TAP_DIR has unpushed commits"
  if grep -q 'homebrew-tap/releases/download' "$TAP_DIR/$LATEST"; then MOVE_TAP_FEED=1; fi
else
  echo "release: no tap clone at $TAP_DIR; its old update feed is left as it is" >&2
fi

# The updater artifacts (Gitgel.app.tar.gz and its .sig) are made only here, so a plain
# `pnpm tauri build` needs no key.
rm -f "$BUNDLE/macos/Gitgel.app.tar.gz" "$BUNDLE/macos/Gitgel.app.tar.gz.sig"
BUILD_CONFIG="$(node -e '
  const signingIdentity = process.argv[1];
  console.log(JSON.stringify({ bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity } } }));
' "$SIGNING_IDENTITY")"
TAURI_SIGNING_PRIVATE_KEY="$UPDATER_KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
  APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" \
  APPLE_API_KEY_PATH="$NOTARY_KEY" APPLE_API_KEY="$NOTARY_KEY_ID" APPLE_API_ISSUER="$NOTARY_ISSUER" \
  pnpm tauri build --bundles app --config "$BUILD_CONFIG"
[[ -f "$BUNDLE/macos/Gitgel.app.tar.gz.sig" ]] || die "the build made no signed update"
codesign --verify --deep --strict "$APP" || die "the app's signature does not verify"
xcrun stapler validate -q "$APP" || die "no notarization ticket stapled to the app"
spctl --assess --type execute "$APP" || die "Gatekeeper rejects the app"
cp "$BUNDLE/macos/Gitgel.app.tar.gz" "$UPDATE"

# ditto keeps the bundle's macOS metadata (symlinks, permissions) intact.
rm -f "$ZIP" "$ZIP_LATEST"
ditto -c -k --keepParent "$APP" "$ZIP"
cp "$ZIP" "$ZIP_LATEST"

# The update feed: this version, its notes and where its signed update is.
VERSION="$VERSION" NOTES="$FEED_NOTES" \
  URL="https://github.com/$REPO/releases/download/$TAG/$(basename "$UPDATE")" \
  SIG="$BUNDLE/macos/Gitgel.app.tar.gz.sig" \
  node -e '
    const fs = require("fs");
    const { VERSION, NOTES, URL, SIG } = process.env;
    const latest = {
      version: VERSION,
      notes: NOTES,
      pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      platforms: { "darwin-aarch64": { url: URL, signature: fs.readFileSync(SIG, "utf8").trim() } },
    };
    process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
  ' >"$FEED"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP" "$ZIP_LATEST" "$UPDATE" "$FEED" --clobber
  gh release edit "$TAG" --notes "$NOTES"$'\n\n'"$INSTALL_NOTE" >/dev/null
else
  gh release create "$TAG" "$ZIP" "$ZIP_LATEST" "$UPDATE" "$FEED" \
    --target "$HEAD_SHA" \
    --title "Gitgel $VERSION" \
    --notes "$NOTES"$'\n\n'"$INSTALL_NOTE"
fi
# gh creates the tag on GitHub only; bring it into the local repo too.
git fetch -q origin "refs/tags/$TAG:refs/tags/$TAG"

echo "Released $VERSION: $(gh release view "$TAG" --json url --jq .url)"
echo "The app updates itself; brew install --cask gokberkakdeniz/tap/gitgel gets this version"

# Once: installs that still read the tap's feed are sent to this release.
if [[ -n "$MOVE_TAP_FEED" ]]; then
  cp "$FEED" "$TAP_DIR/$LATEST"
  git -C "$TAP_DIR" add -- "$LATEST"
  git -C "$TAP_DIR" commit -q -m "gitgel $VERSION: the update feed moves to the gitgel repository"
  git -C "$TAP_DIR" push -q
  echo "The tap's old update feed now points at $VERSION"
fi
