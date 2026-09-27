# Gitgel

A read-only macOS app for reviewing branches and worktrees across several git repositories,
without checking anything out. Built for looking at what coding agents (Cursor, Codex,
Claude Code) left in their worktrees.

- Reads git through libgit2 (the `git2` crate, bundled). It never runs the git binary and never
  writes to a repository: no checkout, stash, commit, fetch or index writes.
- Updates on its own from file-system events (FSEvents), plus a full rescan when the window
  gains focus and on the refresh button. No polling.

## Install

```bash
brew install --cask gokberkakdeniz/tap/gitgel
```

Apple silicon only. Updates come with `brew upgrade`. The cask lives in
[gokberkakdeniz/homebrew-tap](https://github.com/gokberkakdeniz/homebrew-tap), next to the
downloadable builds.

## Prerequisites

- macOS with Xcode Command Line Tools (`xcode-select --install`)
- Rust (stable; the exact version is pinned in `src-tauri/rust-toolchain.toml`)
- Node 20+ and pnpm (`corepack enable pnpm` or `brew install pnpm`)

## Develop

```bash
pnpm install
pnpm tauri dev
```

Checks: `pnpm build`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml` and
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (the clippy
config bans every git2 API that writes).

## Build

```bash
pnpm tauri build --bundles app
```

The app is written to `src-tauri/target/release/bundle/macos/Gitgel.app`. It is ad-hoc signed
(`bundle.macOS.signingIdentity: "-"`), not notarized. On another Mac, the first launch of a
downloaded copy is blocked: open it once, then allow it under System Settings → Privacy &
Security → Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Gitgel.app`.

To publish it: `pnpm release` builds the app, zips it and uploads the zip to the GitHub release
`<version>` (the version in `package.json`) with the `gh` CLI, creating the release
if needed. It needs a clean, pushed working tree; after new commits, bump the version first.
It then publishes the same zip to the Homebrew tap: a release `gitgel-<version>` in
`gokberkakdeniz/homebrew-tap`, and the cask's version and checksum, committed and pushed. The
tap is expected as a clean clone at `../homebrew-tap` (or `$GITGEL_TAP_DIR`).

## Files

- Config: `~/Library/Application Support/com.gitgel.desktop/config.json` (only the app writes it)
- Log: `~/Library/Logs/com.gitgel.desktop/Gitgel.log` (up to 3 × 2 MB). Every scan, review, file
  read and file-watch round logs one line with its step timings. **Help › Show Logs in Finder**
  writes all of it, with the app and libgit2 versions, to `~/Downloads/Gitgel-logs-<time>.log`.

## Test repositories

`scripts/make-fixtures.sh` builds throwaway repositories in `~/gitgel-fixtures` (or
`$GITGEL_FIXTURES`) covering worktrees, detached HEADs, stacked, merged and squash-merged
branches. Unlike the app, this script uses the git CLI and writes, but only inside the folder
it creates and marks. Read it before running it the first time.

```bash
scripts/make-fixtures.sh                 # (re)create everything
scripts/make-fixtures.sh delete-branch   # delete `to-be-deleted` (branch deleted state)
scripts/make-fixtures.sh remove-repo     # move web-app away (repo missing state)
scripts/make-fixtures.sh restore-repo    # move it back
```

## macOS folder access

macOS asks for permission when a repository lives in a protected folder such as `~/Desktop` or
`~/Documents`. An unsigned build may ask again after each rebuild.
