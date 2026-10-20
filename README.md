<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Gitgel icon">
</p>

<h1 align="center">Gitgel</h1>

<p align="center">
  Review branches and worktrees across all your git repositories, without checking anything out.
</p>

<p align="center">
  macOS · Apple silicon · <a href="LICENSE">MIT</a>
</p>

---

Coding agents (Cursor, Codex, Claude Code) leave their work in branches and worktrees spread
over many repositories. Gitgel shows all of it in one window, so you can see what changed and
review it without switching branches.

## Features

- **Branches:** every active branch and worktree of your repositories in one list, with its
  commits ahead, changed files and uncommitted changes.
- **Review:** a branch's diff against its base, its uncommitted changes and its commits, in a
  Monaco diff view.
- **Projects:** group branches from several repositories into one piece of work and review them
  together.
- **Git actions:** stage, commit, amend, stash, discard, fetch, pull, push, rebase, cherry-pick,
  revert, squash, and create, check out or delete branches.
- **AI commit messages** from Claude Code, Codex, Cursor or Apple Foundation Models.
- **Scripts:** your own shell commands in a branch's menu, with live output.
- **Command palette:** ⌘P jumps to a project, worktree or branch; ⇧⌘P runs a command.
- Updates live as files change, and updates itself.

## How it treats your repositories

- Gitgel reads git through [libgit2](https://libgit2.org) and never writes through it.
- Every change to a repository is a git action you click. It runs your own `git` with a fixed
  command, and its output is shown.
- It never fetches on its own; only the Fetch button does.
- No checkout is needed to review a branch.

## Install

```bash
brew install --cask gokberkakdeniz/tap/gitgel
```

Or download the zip from the [releases](https://github.com/gokberkakdeniz/homebrew-tap/releases).

New versions show up in the sidebar and in **Gitgel › Check for Updates…**, and install with one
click.

## Build from source

You need:

- macOS with Xcode Command Line Tools (`xcode-select --install`)
- Rust (the version is pinned in `src-tauri/rust-toolchain.toml`)
- Node 20+ and pnpm (`corepack enable pnpm` or `brew install pnpm`)

Run in development:

```bash
pnpm install
pnpm tauri dev
```

Build the app:

```bash
pnpm tauri build --bundles app
```

The app is written to `src-tauri/target/release/bundle/macos/Gitgel.app`. A local build is not
notarized, so macOS blocks it on other Macs.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run:

```bash
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The clippy config fails the build if a git2 API that writes is used.

- `docs/SPEC.md` describes how the app works: screens, architecture and git rules.
- `docs/TASKS.md` lists planned work.
- Use pnpm, not npm or yarn.

### Test repositories

`scripts/make-fixtures.sh` creates sample repositories in `~/gitgel-fixtures` (or
`$GITGEL_FIXTURES`): worktrees, detached HEADs, stacked, merged and squash-merged branches,
stashes. It uses the git CLI, but only writes inside the folder it creates.

```bash
scripts/make-fixtures.sh                 # create or recreate everything
scripts/make-fixtures.sh delete-branch   # delete the `to-be-deleted` branch
scripts/make-fixtures.sh remove-repo     # move web-app away (missing repo)
scripts/make-fixtures.sh restore-repo    # move it back
```

### Releasing

`pnpm release` signs, notarizes and publishes a version. It needs the maintainer's keys; see
`docs/SPEC.md` §12.

## Files

- Settings: `~/Library/Application Support/com.gitgel.desktop/config.json`
- Logs: `~/Library/Logs/com.gitgel.desktop/Gitgel.log`. **Help › Show Logs in Finder** saves
  them, with version details, to `~/Downloads` for bug reports.

## Troubleshooting

**macOS asks for folder access.** This happens when a repository is in a protected folder such
as `~/Desktop` or `~/Documents`. A local build may ask again after each rebuild.

## License

[MIT](LICENSE)
