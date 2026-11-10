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
# ~/.tauri/gitgel.key, or $TAURI_SIGNING_PRIVATE_KEY), uploaded next to the zip in the tap release,
# and the tap's gitgel/latest.json (the app's update endpoint) is pointed at it in the cask's
# commit.
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

TAP_REPO="gokberkakdeniz/homebrew-tap"
TAP_DIR="${GITGEL_TAP_DIR:-../homebrew-tap}"
CASK="Casks/gitgel.rb"
TAP_TAG="gitgel-$VERSION"
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
INSTALL_NOTE=$'<hr>\n\nSigned and notarized by Apple.'
BREW_NOTE=$'<hr>\n\nInstall with Homebrew:\n```bash\nbrew install --cask gokberkakdeniz/tap/gitgel\n```'
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
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP" --clobber
  gh release edit "$TAG" --notes "$NOTES"$'\n\n'"$INSTALL_NOTE" >/dev/null
else
  gh release create "$TAG" "$ZIP" \
    --target "$HEAD_SHA" \
    --title "Gitgel $VERSION" \
    --notes "$NOTES"$'\n\n'"$INSTALL_NOTE"
fi
# gh creates the tag on GitHub only; bring it into the local repo too.
git fetch -q origin "refs/tags/$TAG:refs/tags/$TAG"

echo "Uploaded $(basename "$ZIP") to $TAG: $(gh release view "$TAG" --json url --jq .url)"

# Homebrew tap: the zip and the update first, then the cask and latest.json that point at them.
TAP_NOTES="$NOTES"$'\n\n'"$BREW_NOTE"
if gh release view "$TAP_TAG" --repo "$TAP_REPO" >/dev/null 2>&1; then
  gh release upload "$TAP_TAG" "$ZIP" "$UPDATE" --repo "$TAP_REPO" --clobber
  gh release edit "$TAP_TAG" --repo "$TAP_REPO" --notes "$TAP_NOTES" >/dev/null
else
  gh release create "$TAP_TAG" "$ZIP" "$UPDATE" \
    --repo "$TAP_REPO" \
    --title "Gitgel $VERSION" \
    --notes "$TAP_NOTES"
fi
SHA256="$(shasum -a 256 "$ZIP" | awk '{ print $1 }')"
sed -i '' -E \
  -e "s/^  version \".*\"$/  version \"$VERSION\"/" \
  -e "s/^  sha256 \".*\"$/  sha256 \"$SHA256\"/" \
  "$TAP_DIR/$CASK"
mkdir -p "$TAP_DIR/$(dirname "$LATEST")"
VERSION="$VERSION" NOTES="$FEED_NOTES" \
  URL="https://github.com/$TAP_REPO/releases/download/$TAP_TAG/$(basename "$UPDATE")" \
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
  ' >"$TAP_DIR/$LATEST"
git -C "$TAP_DIR" add -- "$CASK" "$LATEST"
if git -C "$TAP_DIR" diff --cached --quiet; then
  echo "Cask already at $VERSION"
else
  git -C "$TAP_DIR" commit -q -m "gitgel $VERSION"
  git -C "$TAP_DIR" push -q
  echo "Cask and update feed at $VERSION: brew upgrade --cask gitgel, or the app updates itself"
fi
