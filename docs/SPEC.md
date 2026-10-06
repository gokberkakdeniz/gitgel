# Gitgel — spec

This is the single source of truth for Gitgel: what the product does, how it looks and behaves,
the architecture, the shared types and the git rules. It describes the app as it is now, plus
parts marked `(planned, Tn.m)` that an open task in `docs/TASKS.md` will add.
`design/screens/*.dc.html` hold the visual reference for each screen (§11).

---

## 0. How to work on this project

### Sources

1. This file. It describes the current behaviour; where the reference screens differ from it,
   this file wins.
2. `design/screens/*.dc.html`: colours, sizes, spacing and copy of each screen. They are in a
   design-tool format (HTML with `{{holes}}`, `<sc-for>`, `<sc-if>` and a `renderVals()` script)
   and do not render standalone. Read them for values only; never copy the template syntax.
   Much of the styling lives in the strings inside `renderVals()`. Sample data and code in them
   are fake.

### Rules

- **Reads through git2, writes through the git CLI.** Everything Gitgel reads comes from git2
  (libgit2); the git binary is never run to read. Everything that changes a repository (the stash
  and sync actions, §15) is a **git action**: the user's `git`, started only by a click, with a fixed
  command line built in `src-tauri/src/scripts/git.rs` and run like a script (§14: login shell,
  pty, toast, output panel, rescan when it ends). Values (a message, folders) go in `GITGEL_*`
  environment variables, never into the command text. `std::process::Command` is banned in app
  code; the exceptions are `src-tauri/src/apps.rs`, which starts the terminal the user set in
  Settings (WezTerm, or an Other command), and `src-tauri/src/updates.rs`, which relaunches
  Gitgel with `open -n` after an update. Scripts and git actions run in a pty (`portable-pty`,
  `src-tauri/src/scripts/run.rs`). git2 is used only under `src-tauri/src/git/`; other modules
  use the functions there and the types in §8.
- **git2 never writes.** The app never calls a git2 API that writes to a repository: no checkout,
  set_head, commit, stash, reset, merge, cherry-pick, revert, branch/reference/tag
  create/delete/rename, worktree add/prune/lock, index writes, blob/odb writes, fetch/push or
  config writes. `update_index` is never enabled on diff or status options. `src-tauri/clippy.toml`
  enforces this at compile time (§10). A new write is a new git action, never a git2 call.
- **pnpm only.** Never npm, npx or yarn; no `package-lock.json` or `yarn.lock`. Add packages
  with `pnpm add -E <pkg>` (`pnpm add -D -E` for dev); one-off CLIs with `pnpm dlx`.
- Versions are exact: no `^`/`~` in `package.json`, `=X.Y.Z` in `Cargo.toml`. Before adding a
  package, check it is really needed; if so install the current stable version and pin it.
- **Tauri 2**, not Tauri 1: `invoke` comes from `@tauri-apps/api/core`, the window from
  `getCurrentWindow()` (`@tauri-apps/api/window`), permissions live in
  `src-tauri/capabilities/*.json`, plugins are `tauri-plugin-*` crates and `@tauri-apps/plugin-*`
  packages. A Rust command parameter `repo_id` is sent as `repoId` from JS.
- UI copy is English and matches the reference screens exactly (singular/plural included). Labels
  (buttons, in-app menu items) never end in "…", even when they open a dialog; only progress
  text does ("Scanning repositories…"). The native menu bar follows the macOS HIG instead:
  "…" on items that ask for more before they finish (Settings…, Check for Updates…). Code,
  identifiers and comments are English.
- Do not invent features the spec does not describe. If something is undefined, pick the
  simplest behaviour and mention it at the next checkpoint.
- After every task these must pass:
  - `pnpm build` (tsc + vite)
  - `pnpm test` (vitest)
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

  For UI work, also open the screen with `pnpm tauri dev` and compare it with its `.dc.html`.

### Tasks

Tasks and their status are in `docs/TASKS.md`. Its top section says how a task is written and
how it is completed.

### Keeping this file current

This file describes the app as it is, plus what open tasks will add:

- A design change updates the sections it affects **before** it is built, and marks each new or
  changed part with `(planned, Tn.m)` where the reader would otherwise take it as built. The task
  in `docs/TASKS.md` then points at those sections instead of repeating them.
- The agent that builds the task removes those markers and changes nothing else here, unless
  what was built differs from the text (then the text is corrected to match, and the difference
  is mentioned at the checkpoint).
- Edit in place: change the lines that changed, keep the section order and headings, do not
  rewrap untouched paragraphs. Numbered section references (§4, §10 …) are used from code
  comments and `CLAUDE.md`, so sections are never renumbered; new top-level sections go at the
  end of this file.

---

## 1. Product

**Goal:** a macOS desktop app for reviewing branches and worktrees across several git
repositories from one place, without checking anything out. It reads without writing; it changes
a repository only when asked to (the stash and sync actions, §15), through the git CLI. Built for looking at what coding
agents (Cursor, Codex, Claude Code) leave in their worktrees. Not for the App Store: releases
are Developer ID signed and notarized, no sandbox.

**Concepts**

- **Repo:** a git repository the user added once (global list in Settings).
- **Branch:** the basic unit. Worktree information is never stored; it is recomputed on each scan.
- **Worktree:** a folder where a branch (or a detached HEAD) is checked out. Agent worktrees can
  live anywhere under home, outside the repo.
- **Project:** a piece of work that spans several repos. It has a stable `id` and a unique name
  (case-insensitive, trimmed); the name is display-only. It holds **entries**: repo + branch, or
  repo + worktree path for a detached HEAD.
- **Base:** the ref a branch is diffed against. Found from the default order
  (`origin/HEAD → main → master`, editable in Settings). The user can change it; the choice is
  stored **per branch** and applies wherever that branch appears. Without a stored choice, when
  the default name exists both locally and as a remote-tracking branch (`master` and
  `origin/master`), the branch uses whichever of the two shares the most history with it — the
  **nearest default** (§10 "Nearest default"). The UI always names the ref
  actually used, e.g. `origin/master`.
- **Script:** a shell command the user defines in Settings › Scripts and runs from a branch's
  menu, with the branch as context (§14). It runs as the user's own process.
- **Stash:** an entry of the repository's stash stack (`stash@{n}`), one stack per repository
  shared by all its worktrees. Gitgel lists and reviews them, and stashes, applies, pops and
  drops through git actions (§15).
- **Active branch:** checked out in a worktree, or committed in the last N days (Settings,
  default 14) and ahead of its base (or with a base picked by hand, even when not ahead of it:
  otherwise picking a base at its own tip would hide it; user decision 2026-09-28).
- **Base branch:** the branch whose name matches the repo's default base (e.g. `main`). It is
  compared with its upstream (the configured one, else `origin/<name>`) and is always listed, as
  the first row of its repo. Without a usable upstream (none, or one with no
  common ancestor, e.g. after a force-push) only its working tree is shown; that is not "base
  missing".
- **History:** a branch's commits, newest first, each one reviewable on its own (§16).

**Screens:** Branches (including the first-run empty state), Project, Review, History (§16), Add palette (⌘K), Settings.

**Out of scope:** writing to repositories beyond the git actions (§15; a user's script may do
anything), review comments, GitHub/PR integration, fetching on its own (only the Fetch button fetches), force-push, launching agents, multiple
windows, LSP, the git CLI for reading (even as a fallback), agent labels, a light theme,
configurable refresh.

---

## 2. Architecture decisions

| Topic | Decision |
|---|---|
| Git access | **git2** (libgit2 bindings), `vendored-libgit2` (static, no system libgit2 or OpenSSL), default features (ssh/https) off, for every read. Writes are git actions (§0): the user's `git` through their login shell, as scripts run. Reading never needs git, so the app works on a Mac without it; there is no "git not found" screen: a git action then fails and its toast shows the shell's message. |
| Repository objects | One `git2::Repository` per repo or worktree path, kept in a pool, never reopened per request. `Repository` is not `Sync`, so each sits in its own `Mutex`. |
| Refresh | **File watching** (`notify-debouncer-full`, FSEvents, 300 ms debounce). **No polling, no timers.** An event recomputes only the affected repo or worktree; the backend pushes the result to the frontend as an event. A full rescan runs when the window gains focus and on the refresh button (which also rereads every working tree). Refresh is not configurable and no UI text mentions it. Details in §10. |
| Performance | Results are cached so that a branch whose tip and base did not move is never recomputed, and a working tree is reread only after the watcher reports a change in it (§10 "Caches"). A full scan runs repos in parallel and emits each repo as soon as it is done, only if its result changed. Every scan, review, file read and watch round logs one line with its step timings (`src-tauri/src/timing.rs`). |
| Base | Stored per branch: `branchBases["<repoId>:<branch>"]`. |
| Deleted branches | Entries keep `lastKnownTip` (SHA + when it was last seen), so a deleted branch can still show its last diff while the commit exists. |
| Review | One screen for a whole project, files grouped per entry, one mode toggle. Single-branch review is the same screen with one group. |
| Settings | Sections in a list: General (theme, terminal, update checks), Repositories (repos, default base order, active threshold), Scripts (the user's scripts) and Shortcuts (read-only). Diff layout, context (changes only / whole file, lines around changes) and ignore-whitespace live in Review's view menu, font size in View › Font Size; all are stored in the config. |
| Scripts | User shell commands run from branch menus (§14): `$SHELL -l -c`, context in `GITGEL_*` env vars; every run in a pty (`portable-pty`) with a toast that opens its output panel (drawn with `@xterm/xterm`); Show when conditions in CEL, evaluated in the frontend. |
| Config owner | Only Rust reads and writes the config. The frontend never writes files; every change is a Tauri command. |
| Config path | `~/Library/Application Support/com.gitgel.desktop/config.json` (Tauri `app_data_dir()`). |
| Logs | `tauri-plugin-log` → `~/Library/Logs/com.gitgel.desktop/Gitgel.log`, up to 3 × 2 MB. Git errors are logged with `log::warn!`. Debug level (watch rounds) only in dev builds. Every line ends with the process's memory footprint. |
| Package manager | pnpm, version pinned in `package.json` `packageManager`. |
| Frontend | React + TypeScript + Vite, state in zustand. Backend data arrives two ways: **push** (config and scan result live in a store, updated by backend events) and **request/response** (review, project view, file contents, base options, commit changes) through a small `useInvoke` hook that refetches when a related repo event arrives. No React Query. Styling: CSS Modules + CSS variables. Fuzzy search: fuse.js. |
| Diff | `@monaco-editor/react` + `monaco-editor`, bundled locally (`loader.config({ monaco })`), never from a CDN. |
| Fonts | Instrument Sans, Source Serif 4, JetBrains Mono via `@fontsource/*`, bundled. The app works offline. |
| Bundle id | `com.gitgel.desktop` (must not end in `.app`). |
| Distribution | `pnpm release` builds, zips and uploads to GitHub releases and updates the Homebrew cask and the update feed (§12). Release notes come from `CHANGELOG.md`. |
| Updates | `tauri-plugin-updater`, driven from Rust (`updates.rs`): the only network access. Checks the tap's `gitgel/latest.json` at launch and on window focus, at most every 6 hours; installs a signed build on request and restarts through LaunchServices (`open -n`), so the new version comes to the front focused; the window also takes focus when it is first shown (§12 "Updates"). |

---

## 3. Project structure

```
gitgel/
├─ CLAUDE.md
├─ CHANGELOG.md                   # release notes, newest first; written at release (§12)
├─ design/screens/*.dc.html       # visual reference (read-only)
├─ docs/PROGRESS.md               # this file
├─ scripts/make-fixtures.sh       # test repositories (§12)
├─ scripts/release.sh             # `pnpm release` (§12)
├─ index.html  package.json  pnpm-lock.yaml  .nvmrc  vite.config.ts  tsconfig*.json
├─ src/
│  ├─ main.tsx                    # font imports, Monaco setup
│  ├─ App.tsx                     # layout, route switch, global shortcuts, drop overlay
│  ├─ styles/   tokens.css  tokens.ts  global.css
│  ├─ lib/      types.ts  ipc.ts  events.ts  useInvoke.ts  format.ts  paths.ts  entryKey.ts
│  │            shortcuts.ts  addRepos.ts  draft.ts  projects.ts  projectSort.ts  useFolderDrop.ts  theme.ts
│  │            useCopy.ts  changelog.ts (CHANGELOG.md parsed, version compare)
│  ├─ state/    nav.ts  ui.ts  data.ts
│  ├─ components/                 # Button, IconButton, Pill, Checkbox, Switch, Input, Kbd,
│  │                              # Popover, Menu, Modal, Toast, Segmented, Select, SettingsNav,
│  │                              # KindBadge, Banner, ResizeHandle (+ useStoredWidth), UpdateModal, WhatsNewModal, AboutModal,
│  │                              # ReleaseNotes, List (+ List.story.tsx: dev-only /#list), icons.tsx (Icon by name),
│  │                              # Sidebar/, BaseMenu/, ProjectPicker/, PageHeader/, ...
│  ├─ screens/  Branches/  Project/  Review/  History/  Settings/  Palette/  AddRepos/
│  │            # Review/stashes.ts: which stashes a review lists (§15)
│  │            # Review/parts.tsx: view menu, change navigation, file row, diff view settings
│  │            #   (shared with History, §16)
│  │            # History/: the History screen and its list rows (§16)
│  ├─ stash/    # §15 writing stashes: actions.ts (git actions), StashAction + StashDialog (P4), StashTargetMenu
│  │            # (Apply to / Pop to, P5), DropStashModal (P6)
│  ├─ sync/     # §15 sync (W4a): sync.ts (what Fetch / Pull / Push can do, labels), SyncButtons
│  │            # (History header buttons, SyncItems: the branch menus' group)
│  ├─ scripts/  # §14: when.ts (CEL), runs.ts (running scripts store, toasts), ScriptsMenu,
│  │            # ScriptEditor, ImportScripts, RunDialog, OutputPanel, ScriptIcon, DragHandle,
│  │            # useReorder, describe.ts
│  └─ monaco/   setup.ts  theme.ts  language.ts  DiffView.tsx  changeNav.ts
└─ src-tauri/
   ├─ Cargo.toml  Cargo.lock  rust-toolchain.toml  clippy.toml  tauri.conf.json  build.rs
   ├─ capabilities/default.json
   └─ src/
      ├─ main.rs  lib.rs          # lib.rs: run(), plugins, command registration
      ├─ menu.rs                  # app menu: Settings…, Check for Updates…, View › Font Size, Help items
      ├─ logs.rs                  # Help › Show Logs in Finder
      ├─ appearance.rs            # window theme and background before it is shown
      ├─ apps.rs                  # open items: installed editors/terminals, open a folder
      ├─ nearest.rs               # nearest default: local vs remote default base
      ├─ memory.rs                # frees libgit2 memory after full scans
      ├─ updates.rs               # in-app updates: check, install, restart
      ├─ scripts/   mod.rs  run.rs # the user's scripts: config, import/export; running, output, stop
      │             git.rs        # git actions: stash push / apply / pop / drop, fetch / pull / push (§0, §15)
      ├─ error.rs  state.rs  model.rs  config.rs  cache.rs  timing.rs
      ├─ commands.rs              # every #[tauri::command] (thin wrappers)
      ├─ git/                     # the ONLY place git2 is used
      │  ├─ mod.rs                # submodules + From<git2::Error>
      │  ├─ pool.rs               # Repository pool
      │  ├─ inspect.rs            # folder resolution (flow A2)
      │  ├─ refs.rs               # branches, default base, ref checks, tags, last fetch time
      │  ├─ worktrees.rs          # main + linked worktrees, ignore check
      │  ├─ diff.rs               # tree/workdir/commit diffs, FileChange conversion, blobs
      │  ├─ history.rs            # merge-base, ahead, revwalk, merged state, stack candidates,
      │  │                        # history pages and search (§16)
      │  ├─ stash.rs              # stash stack from the refs/stash reflog, a stash's changes
      │  └─ testutil.rs           # #[cfg(test)] only: throwaway repos in a TempDir
      ├─ scan.rs                  # branch/worktree discovery, entry summaries, stored scan
      ├─ watch.rs                 # file watching, event classification, targeted recompute
      ├─ review.rs  files.rs  base.rs  projects.rs  repos.rs
      ├─ history.rs               # a branch's history page, search, refs (§16)
```

---

## 4. Visual system

Two themes, dark and light, picked in Settings › General › Theme (§5):
System (default), Light or Dark. Warm neutrals, one cool accent. Tokens are CSS variables in
`src/styles/tokens.css` (`bg.sidebar` → `--bg-sidebar`, `text.muted` → `--text-muted`, …): dark
values on `:root`, light values on `:root[data-theme="light"]` (see "Light theme" below); the same
values per theme in `src/styles/tokens.ts` for Monaco. The reference screens use the same tokens:
each file defines `.theme-dark` / `.theme-light` in its `<style>` and uses `var(--…)`.

### Colour tokens

| Token | Value | Use |
|---|---|---|
| `bg.sidebar` | `#0e0d0c` | Sidebar, review file list (the left side is always darker than the right) |
| `bg.main` | `#141311` | Main content, review header, diff panes |
| `bg.sunken` | `#1a1917` | Inputs, sub-headers (file bar), modal footers, cards |
| `bg.band` | `#1c1b18` | Repo band on Branches |
| `bg.elevated` | `#211f1c` | Popovers, menus, modals, secondary buttons |
| `bg.track` | `#211f1c` | Segmented-control track (same as `bg.elevated` in dark, grey in light) |
| `bg.hover` | `#2a2825` | Hovered / selected rows in popovers and lists |
| `bg.sidebarActive` | `#24221f` | Active sidebar item |
| `bg.pressed` | `#383631` | Active segmented button, open menu trigger |
| `border` | `#302e2a` | Default 1px borders |
| `border.row` | `#262420` | Row dividers |
| `border.strong` | `#383631` | Band top edge, elevated button borders |
| `text.strong` | `#faf9f5` | Titles, branch names, primary text |
| `text.code` | `#e0ddd6` | Diff code |
| `text.body` | `#d8d4cc` | Body text |
| `text.muted` | `#a09d96` | Secondary text, labels, counts |
| `text.faint` | `#75726b` | Line numbers, "—" placeholders, dimmed folders only |
| `accent` | `#4f8fa3` | Primary button fill, focus ring, checkboxes, key icons. Text on it: `#141311` (`--on-accent`) |
| `accent.text` | `#7fb3c4` | Links, SHAs, "● N changed", text actions |
| `accent.hover` | `#a3cad6` | Link hover |
| `focus.ring` | `0 0 0 1px #4f8fa3, 0 0 0 3px rgba(79,143,163,0.25)` | Focused inputs |
| `success` | text `#8fcf9c` on `rgba(93,184,114,0.14)` | merged |
| `warning` | text `#e8c071` on `rgba(212,160,23,0.14)` | detached HEAD, base missing, commits from another branch |
| `danger` | text `#ee9a90` on `rgba(198,69,69,0.16)` | deleted, repo missing, destructive menu items |
| `danger.fill` | `#c64545`, white text | Delete confirm button |

### Diff colours

- Added line `rgba(93,184,114,0.15)`, marker `+` in `#8fcf9c`.
- Removed line `rgba(198,69,69,0.17)`, marker `−` in `#ee9a90`.
- Filler on the opposite side: `repeating-linear-gradient(135deg, #1c1b18 0 4px, #141311 4px 8px)`
  (overrides Monaco's `.diagonal-fill`).
- Folded unchanged region: `#1a1917`, text in `text.faint`. Monaco's own fold text is used
  (accepted deviation from the reference's "⋯ N unchanged lines").
- Current change (§5 Review): 3px accent bar `inset 3px 0 0 #7fb3c4` on its lines in both panes.

Monaco theme `gitgel-dark` (`src/monaco/theme.ts`, base `vs-dark`): background `#141311`, foreground
`#e0ddd6`, line numbers `#75726b` (active `#a09d96`), inserted line `#5db87226`, removed line
`#c645452b`, inserted text `#5db87240`, removed text `#c6454548`, diagonal fill `#1c1b18`,
unchanged region `#1a1917` / `#75726b`, border `#302e2a`, scrollbars `#383631`. Syntax colours:
keyword `#7fb3c4`, string `#e8c071`, number `#c5b2f2`, type `#93b8ee`, comment `#75726b` italic,
everything else `#e0ddd6`.

### File-kind badges

18px square, radius 5, mono 10px/500: A `#8fcf9c` on green tint, M `#e8c071` on amber tint,
R `#93b8ee` on `rgba(90,140,220,0.16)`, D `#ee9a90` on red tint, U (untracked) `#c5b2f2` on
`rgba(160,130,230,0.16)`, C (merge conflict, unmerged in the index) D's colours with a 1px inset
ring in its text colour; its folder label ends in ` · conflict`.

### Light theme

Same tokens, light values (`:root[data-theme="light"]`). The left side stays darker than the
right: the sidebar and the review file list are the darkest surfaces, content the lightest,
popovers and menus white. Everything not listed (traffic lights, fonts, sizes, radii, which token
each component uses) is the same as dark.

| Token | Dark | Light |
|---|---|---|
| `bg.sidebar` | `#0e0d0c` | `#f1efea` |
| `bg.main` | `#141311` | `#fbfaf7` |
| `bg.sunken` | `#1a1917` | `#f4f2ee` |
| `bg.band` | `#1c1b18` | `#eeebe5` |
| `bg.elevated` | `#211f1c` | `#ffffff` |
| `bg.track` | `#211f1c` | `#e9e6e0` |
| `bg.hover` | `#2a2825` | `#ebe8e1` |
| `bg.sidebarActive` | `#24221f` | `#e4e0d8` |
| `bg.pressed` | `#383631` | `#ffffff` (active segment, white on the grey track) |
| `border` | `#302e2a` | `#e2ded6` |
| `border.row` | `#262420` | `#ebe8e2` |
| `border.strong` | `#383631` | `#d5d0c7` |
| `text.strong` | `#faf9f5` | `#1d1c19` |
| `text.code` | `#e0ddd6` | `#2b2925` |
| `text.body` | `#d8d4cc` | `#3b3934` |
| `text.muted` | `#a09d96` | `#6e6a62` |
| `text.faint` | `#75726b` | `#99958c` |
| `text.disabled` | `#5c5a55` | `#b7b2a9` (disabled Forward, unchecked checkbox border) |
| `icon.disabled` | `#4a4843` | `#cbc6bd` (disabled ↑ ↓ step buttons) |
| `accent` | `#4f8fa3` | `#3a7b8f` |
| `accent.text` | `#7fb3c4` | `#2c6a7d` |
| `accent.hover` | `#a3cad6` | `#1f5566` |
| `on-accent` | `#141311` | `#ffffff` |
| accent tints (`selected-bg`, chips, rings) | `rgba(79,143,163,a)` | `rgba(58,123,143,a)`, same alphas |
| `success` | `#8fcf9c` on `rgba(93,184,114,0.14)` | `#2e7a45` on `rgba(46,140,78,0.14)` |
| `warning` | `#e8c071` on `rgba(212,160,23,0.14)` | `#8a6212` on `rgba(196,146,20,0.14)` |
| `danger` | `#ee9a90` on `rgba(198,69,69,0.16)` | `#b3463b` on `rgba(200,72,60,0.16)` |
| `danger.fill` | `#c64545`, white text | same |
| diff added / removed line | `rgba(93,184,114,0.15)` / `rgba(198,69,69,0.17)` | `rgba(46,140,78,0.15)` / `rgba(200,72,60,0.17)` |
| diff filler | `#1c1b18` / `#141311` stripes | `repeating-linear-gradient(135deg, #eeebe5 0 4px, #fbfaf7 4px 8px)` |
| folded region | `#1a1917` | `#f4f2ee` |
| kind badges A / M / D | success / warning / danger text on their 0.15 / 0.15 / 0.18 tint | same rule, light values |
| kind R | `#93b8ee` on `rgba(90,140,220,0.16)` | `#2f63a8` on `rgba(60,110,200,0.16)` |
| kind U | `#c5b2f2` on `rgba(160,130,230,0.16)` | `#6a4fb5` on `rgba(140,100,220,0.16)` |
| popover shadow | `0 16px 40px rgba(0,0,0,0.45)` | `0 16px 40px rgba(40,32,20,0.14)` |
| modal shadow / scrim | `rgba(0,0,0,0.5)` | `rgba(30,26,20,0.28)` |
| focus ring | `0 0 0 1px #4f8fa3, 0 0 0 3px rgba(79,143,163,0.25)` | `0 0 0 1px #3a7b8f, 0 0 0 3px rgba(58,123,143,0.25)` |

Contrast on `bg.main`: `text.muted` 5.2:1, `accent.text` 5.8:1, white on `accent` 4.8:1.
`text.faint` is only for line numbers and placeholders.

Monaco `gitgel-light` (base `vs`), switched with `monaco.editor.setTheme`: background `#fbfaf7`,
foreground `#2b2925`, line numbers `#99958c` (active `#6e6a62`), inserted line `#2e8c4e26`,
removed line `#c8483c2b`, inserted text `#2e8c4e40`, removed text `#c8483c40`, diagonal fill
`#eeebe5`, unchanged region `#f4f2ee` / `#99958c`, border `#e2ded6`, scrollbars `#d5d0c7`.
Syntax: keyword `#2c6a7d`, string `#8a6212`, number `#6a4fb5`, type `#2f63a8`, comment `#99958c`
italic, everything else `#2b2925`.

### Type

| Role | Font | Size |
|---|---|---|
| UI text | Instrument Sans (400/500/600) | 13px default, 14px sidebar and empty-state body |
| Page titles | Source Serif 4, 400, letter-spacing −0.3px | 22px; review header 18px; settings sections 18px; empty-state titles 28px |
| Code, branch names, paths, SHAs, counts, shortcuts | JetBrains Mono | 11–13px; diff 12px / 20px line height |
| Section labels | Instrument Sans 11px, 500, uppercase, letter-spacing 0.06em | `text.muted` |

### Shape and size

- Radius: 8 buttons, inputs, rows · 10 segmented control · 12 popovers, menus, cards · 16 modals
  and palette · 9999 pills.
- Sidebar 260px. Page headers (Branches, Project, Review, Settings) 64px: title serif 22px + 12px
  muted subtitle (2px apart), 28px left and 16px right padding (the space above the 32px
  controls), actions 10px apart in one order: refresh first, the screen's own controls in the
  middle, edit (pencil or ⋯) last.
- Buttons 32px (modal 36px, empty-state primary 40px). Sidebar rows 40px. Review file rows 30px.
- Popover shadow `0 16px 40px rgba(0,0,0,0.45)`; modal shadow `0 24px 60px rgba(0,0,0,0.5)`;
  modal scrim `rgba(0,0,0,0.5)`.
- Icons: 1.6–1.8px stroke outline SVGs in `src/components/icons.tsx`, copied from the reference
  screens (§11). No emoji. The full set is `Icon.dc.html` (Icons page of the canvas,
  `IconsSpec.dc.html`); components take an icon by its name there, and the names match
  `icons.tsx` (`SidebarIcon` → `sidebar`, `MoreVerticalIcon` → `more-vertical`).

### Shared components

Each has its own artboard in `design/screens/` (`Button.dc.html`, `Menu.dc.html`, …) that the
screens mount, and a variants board beside it (`ButtonSpec.dc.html`, `MenuSpec.dc.html`, …, as
`InputSpec.dc.html`), so a screen never draws its own copy.

- `Button`: `primary` (accent fill, `--on-accent` text, 600), `secondary` (`bg.elevated`, 1px
  border, `text.strong`), `ghost`, `danger` (`danger.fill`), `link` (`accent.text`); optional
  `kbd` hint on the right in mono 11px. Also 28px (Locate), `chevron` for a dropdown trigger and
  `active` for its open state (`bg.pressed`, `border.strong`); a modal's Cancel is a plain
  `secondary`. Icon-only buttons are `IconButton` (28 plain, 24 in compact list rows, 32 boxed).
  A copy button (the output panel's Copy, Copy SHA) says it worked: for 1.5 s its icon becomes `check` and
  it turns `success.text`, a labelled one reading "Copied" (`useCopy`, `src/lib/useCopy.ts`).
- `PageMenu`: the ⋮ (`more-vertical`) 32px boxed `IconButton` (`aria-label` "More actions") that
  ends the Review and History headers; a 240px `Menu`, right-aligned under it, with the page's
  less used actions.
- `Pill`: `success | warning | danger | neutral`, 11px/500, padding 3px 10px. Neutral: `#d8d4cc`
  on `#302e2a`. Also `accent` (`accent.text` on `rgba(accent,0.14)`), `size="sm"` (16px tall,
  padding 0 7px: Branches line 2, a badge next to a name), `mono` (exit codes, SHAs) and a
  clickable form (Review's "Whitespace ignored"). Also `outline`: `text.faint` in
  a 1px dashed `border.strong` ring, transparent, for a thing that is gone (a stash's deleted
  branch).
- `List`: a card of rows (`List.dc.html`, `ListRow.dc.html`,
  `ListSpec.dc.html`): `bg.sunken`, 1px border, radius 12 (10 for a narrow list), 1px
  `border.row` rules between rows and none after the last. `density` regular (min 48px, padding
  8px 10px 8px 12px, gap 10) or compact (34px, padding 0 6px 0 12px, gap 8). A row, left to right,
  every part optional: a drag `handle`; a `lead` (mono 11 faint `index` · 16px slot with a 14px
  line `icon` · 28px boxed `tile`); line 1: mono 12 muted `prefix`, `title` (13px, or mono 12
  `text.code`; weight 400 or 500; a fixed `titleWidth` so a `detail` column lines up), sm `Pill`
  `badges`, a mono 12 muted `detail` that takes the rest (ellipsis); line 2: a mono 11 muted `sub`
  line of sm mono Pills and texts with `·` between; a 12px `aside` (muted, faint, warning,
  danger); `actions` (`Button`s, 24px compact / 28px regular, a `Switch`, a md `Pill`), which
  `actionsOnHover` hides until the row is hovered or holds focus. `active` (hovered, or its menu
  is open): `bg.hover`; `off` dims the tile (0.45) and the title (`text.muted`). Around the card:
  an optional disclosure `heading` above it (12px chevron, 12px/500 label, mono 11 muted count;
  4px above the card; collapsing hides the card and that gap), one muted row when it is empty, and a last row with a link button
  ("+ Add …") that becomes a 28px mono `Input` while adding. Used by Settings › Repositories,
  Default base and Scripts; no screen draws its own card list.
- `Checkbox`: a drawn 16px box, radius 4: accent fill with an 11px check when on, 1.5px
  `border.strong` when off; optional `label` (13px `text.strong`), a 12px muted `sub` line, and
  `card` (a `bg.sunken` box, radius 12, padding 12px 14px).
- `Switch`: turns a thing on or off at once, with no Save (a `Checkbox` picks
  options in a form or rows to act on). A 28×16 track, radius 8, 12px knob: `accent` with the knob
  right when on, `bg.track` with a 1px `border.strong` outline and the knob left when off. No
  label of its own: an aria-label and a tooltip (`Switch.dc.html`, `SwitchSpec.dc.html`).
- `Select`: `bg.elevated`, 1px border, radius 8, 32 or 36px, a 12px chevron 12px from the right;
  a native `<select>` (Settings › Terminal) with an optional 14px leading icon; focused: accent
  border + 2px ring. The listbox trigger with a faint placeholder (`Select.dc.html` without
  options: the script inputs) comes with the Scripts work.
- `Input`: every text field (filters, Settings, New project name). `bg.sunken`, 1px border,
  radius 8, `size` 28 / 30 (default) / 32 / 36; focused: accent border + 2px `rgba(accent,0.2)`
  ring; `invalid`: the same in danger. `leftIcon` / `rightIcon` slots (muted, 11px: a 13px search
  icon, a `⌘K` hint, a match count); either slot takes any icon of the set, and the hint text
  becomes its own `rightText` (and a control before the text its `leftText`); `mono` for branches, files, paths and commands;
  `clearable` (filters): while it has text it keeps the accent border and ends with an 18px round
  ✕, and Esc clears it before anything else. In-place editors (page titles, the sidebar rename)
  are not `Input`s.
- `Popover`: positioned under an anchor rect, kept inside the viewport (flips above; when it fits
  on neither side it takes the roomier one and scrolls, since the webview cannot draw outside the
  window), `bg.elevated`, radius 12, popover shadow; outside click and Esc close it.
- `Menu`: padding 6, items 8px 10px, radius 8, active item `bg.hover`; `danger`, `hint`, `sub`
  lines and dividers; ↑/↓ move between the enabled items. Items may carry an icon on the left:
  a 16px slot, gap 10; line icons are 14px, stroke 1.8, `text.muted` (danger
  items: `danger.text`); an item with a `sub` line keeps the icon beside its first line.
  Also section labels (11px uppercase muted), radio items with a check slot, checkbox items, a
  12px `desc` line, a mono 11px `kbd` hint, faint captions and a segmented row: Review's View
  menu is built from these.
- `Modal`: scrim, `bg.elevated`, radius 16, positioned from the top; Esc closes it. The top
  52px of the scrim is a drag region, so the window still moves while a modal is open. A modal
  with a footer has a way out there too (Cancel, or Close when there is nothing to cancel), even
  when its header has a ✕.
  `ModalHeader`: serif 22px title, a 13px muted sub line (mono 11px for repo / branch or a path),
  padding 20px 24px 14px, optional ✕; `ModalFooter`: `bg.sunken`, padding 14px 24px, a 12px
  muted note (or a lead link button) on the left, optionally after a `lead` button at the far
  left, buttons on the right, primary last.
- `Toast`: bottom centre, `#2a2825` on `#383631` border, radius 12; one at a time. Optional
  status icon (spinner, success, failed), a mono part before the message and a mono sub line.
  A toast with a status (a script run) ends with a 24px ✕ (12px icon, `text.muted`, `bg.pressed`
  on hover) that dismisses it.
- `Segmented`: padding 3, gap 2, `bg.elevated`, radius 10; buttons 26–28px, 12px/500; active
  `bg.pressed` + `text.strong`; a mono 11px count after the label. Also `bordered` (on
  `bg.elevated` surfaces), `xs` (22px mono buttons inside a menu) and radio semantics in forms.
- `SettingsNav`: Settings' 200px section list (§5 Settings).
- `Banner`: `warning | neutral`, padding 9px 20px, 12px, bottom border.
- `Kbd` keycaps: see Settings (§5).

### Window

1280 × 800 (min 1100 × 680), overlay title bar with hidden title; the native traffic lights sit
top-left (≈70px kept free). Title rows (sidebar top row, page headers) carry
`data-tauri-drag-region` on the element itself, never on buttons or inputs, and not on the
Project title (a click renames it). The default webview context menu is disabled except in
inputs, textareas and the diff.

---

## 5. Screens

### Sidebar (`Sidebar.dc.html`)

- 260px, `bg.sidebar`, right border `border.row`. Hidden on Review (except a review opened from
  the project list); the header then shows a show-sidebar button next to the traffic lights.
- **Top row** (52px, drag region): traffic-light space, 28px icon buttons: sidebar toggle, Back,
  Forward (disabled colour `#5c5a55` when history does not allow it).
- **Nav** (40px rows, radius 10, 14px; active `bg.sidebarActive` + `text.strong`):
  **New project** (24px round `#302e2a` "+"; starts flow C) and **Branches** (branch icon, mono
  12px count of all active branches on the right).
- **Projects** label (14px `text.muted`) with two icon buttons:
  - Search turns the label row into a 32px "Search" input (name contains; Esc closes).
  - Sort/filter opens a menu: "Sort by name" / "Sort by date created" (default: creation order),
    remembered in `localStorage` (`gitgel.projectSort`).
- **Project list:** 40px rows, 7px hollow circle (1.5px border; `#e0ddd6` when active, else
  `#75726b`) + name with ellipsis, no counts. Click opens the project's review (project scope,
  sidebar kept shown, Back aria-label "Back"), or its page while it has no entries; the review's
  pencil opens the page. The active one (on its page or its project review) gets
  `bg.sidebarActive`. Right-click opens the project menu (Rename / Delete project); Rename or a
  double-click turns the whole row into the field in place (`bg.sunken`, inset 1px accent
  outline, the name where it was and selected, no navigation): ↵ saves, Esc or leaving the field
  cancels, a name conflict turns the outline danger with the message as its tooltip. A draft
  project (flow C) shows as an active row at the end.
- **Update row** (only while a newer version is known, above the footer): 36px button, margin
  8px 10px 10px, radius 10, `rgba(accent, 0.12)` with a 1px `rgba(accent, 0.3)` border,
  `accent.text` 13px: 16px arrow-up-in-circle icon + "Update to <version>" (title "You have
  <current>"). A click downloads, checks and
  installs it, then the app restarts; meanwhile "Updating… N%" (disabled). A failure turns it
  danger: "Update failed · Retry", the error as its title.
- **Footer** (56px, top border `#2a2825`): a 36px link row (folder icon + "N repositories",
  "1 repository") → Settings. On footer hover the row gets `bg.sunken` and a 32px "+" button
  appears (aria-label "Add repository", title "Add repository"; hidden but space kept
  otherwise) that opens the folder picker and the add-repositories sheet. The gear → Settings is
  on the far right (`bg.sidebarActive` while on Settings).

### Branches (`Main.dc.html`)

Every active branch, whether or not it is in a project, and each repo's base branch.

- **Header** (64px, drag region): title "Branches"; subtitle `N repos · M branches · K stashes`
  ("1 repo", "1 branch", "1 stash"): what is listed now (scope and filter applied; base rows
  not counted; the stash part only above 0); refresh button; **All / Not in a project** segmented control with counts; filter
  field.
  - "All" (default) lists every active branch. "Not in a project" hides rows that are in any
    project and repo bands left empty. Counts ignore the text filter. The choice is remembered in
    `localStorage` (`gitgel.branches.scope`). If nothing is left: centred serif 22px "Every active
    branch is in a project". The sidebar count always shows all active branches. Base branch rows
    are left out of every count except the band's, and "Not in a project" still
    lists them.
  - Filter field: 200 × 32px, `bg.sunken`, search icon, placeholder "Search",
    `Kbd` "⌘K" (⌘K focuses it). It is a real filter, word-based: `-`, `/`, `_`, `.` count as
    spaces, and every typed word must appear in the branch name or SHA, the worktree path or the
    repo name, in any order, case-insensitive ("to be" finds `to-be-deleted`, "feat queue" finds
    `feat/job-queue`). Esc clears it.
- **Columns:** grid `16px minmax(0,1fr) 104px 24px`, column-gap 8, padding 10px 16px 10px 28px
  (the list keeps a 10px scrollbar gutter; the header row adds it to its right padding so the
  headings line up), section-label style: [checkbox] Branch · Projects (right-aligned) · [⋮].
  The branch name gets all the room the other columns leave.
- **Repo band** per repo: `bg.band`, top border `border.strong`, bottom border `border`, padding
  10px 16px 10px 6px; a 12px muted collapse chevron (in the left padding, so the folder icon
  stays over the checkbox column), folder icon in accent, 15px/600 repo name, mono 11px muted
  path, its row count on the right (12px muted, tooltip "N branches"), ending where the Projects column does (32px in); 14px between
  bands. Repos with no rows are hidden, except when focused from a repo link
  (then "0 branches"). A missing repo shows a danger pill "path not found" (→ Settings); a repo
  git2 cannot open shows a danger "git error" pill.
  - Chevron, icon, name and path are one button that collapses the band: its rows and stashes
    hide, the band and its count stay. ⌥-click collapses every band when the clicked
    one is open, and opens them all otherwise. Collapsed bands are remembered per repo in
    `localStorage` (`gitgel.branches.collapsedRepos`); they open while filtering, and a band
    focused from a repo link opens.
  - **Pin**: a 24px icon button with a 13px `pin` icon in the ⋮ column, after the count
    (tooltip "Pin to top" / "Unpin"). It shows while the band is hovered or the button has
    focus, and always on a pinned band, where it is `accent.text`. Pins are kept in the config
    (`pinnedRepos`); removing a repo drops its pin.
- **Row** (same grid, bottom border `border.row`):
  - Checkbox: visible only on the hovered row; once anything is selected, all are visible.
  - **Branch** cell, three lines (gap 3), so every row has the same height:
    1. The mono 13 `text.strong` name (short SHA for a detached HEAD), the only link (opens
       single-branch review; tooltip the full name). Too long for the cell, it is cut in the
       middle: the start shrinks with "…" and the end (at most the last 16 characters, from after
       a `-`, `/`, `_` or `.`) always shows, so names that differ only at the end stay apart.
    2. A 15px mono 11 muted line: `base <base> · <diff> · <age>` (faint `·`; only the base is cut
       with "…" when the line runs out of room), then the state pill, then a danger sm pill
       `N conflicts` (`1 conflict`; tooltip "Merge conflicts in the working tree") when its
       working tree has unmerged files.
       - Diff: ahead · files · uncommitted as `↑4 / 9 / 3`, the ` / ` separators `text.faint`.
         Ahead carries ` ↓N` when the base has N commits the branch does not (it needs a
         rebase): `↑4 ↓2 / 9 / 3`. Uncommitted is 500 `accent.text` when above 0, faint
         otherwise, and "—" when the branch is not checked out; ahead or files unknown show "—".
         Tooltip: `4 ahead · 2 behind · 9 files · 3 uncommitted` (no "behind" part at 0; `· not
         checked out` instead of the uncommitted part).
       - Age: the tip commit's age, or, when the branch has uncommitted changes (staged,
         unstaged or untracked) edited after it, the newest modification time of those files
         (tooltip "Last change to uncommitted files").
       - State pill (compact: 11px/500 UI font, padding 0 7px): "merged" (success, tooltip
         `merged into <base>`), "detached HEAD" (warning), "base missing" (warning, opens the base
         menu), "git error" (danger, tooltip = error); nothing otherwise.
    3. A 15px mono 11 line: a 12px terminal icon (`accent.text`) and the `~` path where the
       branch is checked out (tooltip `Checked out in <~path>`), or, not checked out, the same
       icon and a "—" in `text.faint` (tooltip "The branch is not checked out anywhere.").
  - **Projects cell** (26px, radius 8, padding 0 9px, 12px, right-aligned in its column):
    - In no project: faint "—". On the hovered or focused row it becomes an outlined "+ Add" in
      `accent.text`, which opens the project picker (flow B) under the cell, right-aligned.
      While the picker is open the cell is accent-filled and the row `bg.elevated`.
    - In 1+ projects: a chip "1 project" / "N projects" (`bg.elevated`, 1px border, 10px
      chevron; tooltip lists the names). Click opens a 270px menu: label "In N projects", one row
      per project (hollow dot + name + muted "→", opens it), divider, `accent.text` "+ Add to
      another project" (opens the picker without the projects the branch is already in). While
      open the chip is `bg.pressed` with a `#4a4741` border and the row `bg.elevated`. ↑/↓/↵/Esc
      work.
    - Right after an add the cell shows the new count with an accent outline and
      `rgba(79,143,163,0.12)` fill for ~2 s. In "Not in a project" the row leaves the list.
  - **Row menu**: a 24px vertical "⋮" button (`aria-label` "Branch options"), shown on
    the hovered or focused row and while its menu is open (then `bg.pressed`, row
    `bg.elevated`). It opens a 260px menu, right-aligned under the button (right-clicking
    anywhere on the row opens it at the pointer): "Copy branch name"
    (hidden for a detached HEAD), then the open items as in the Project entry menu (with a divider
    between the two groups); icons as there; then the Sync group (§15 "Sync"); then the Scripts
    group (§14, flow N1–N2). ↑/↓/↵/Esc
    work.
  - Hover `bg.sunken`; selected `rgba(79,143,163,0.10)`.
- **Base branch row** (`HistH1.dc.html`): the repo's base branch (§1) is always
  the first row of its band, whatever its age or work, so every repo that can be read has a band.
  It differs from other rows:
  - Same background as other rows (the pill and History button set it apart); no checkbox (the
    column is left empty). It cannot be selected.
  - After the name, a compact `outline` pill "base". The name opens History (§16) on it, tooltip
    `Show history of <name>`.
  - Line 2 as other rows, against its upstream: `base origin/main · ↑0 ↓3 / 0 / 2 · 4m` (↓ as of
    the last fetch); without a usable upstream the base part is left out and ahead / files are
    "—". Never the "merged" pill.
  - Projects cell: a 26px "History" button (12px history icon, 12px `accent.text`, `bg.elevated`,
    1px `border`, radius 8; tooltip `Commit history of <name>`) that opens History.
  - The row menu is the same as other rows', except that "Open review" (split icon) takes the
    place of "Open history" (its name already opens History): Review of the branch against its
    upstream.
- **Open history**: every other row menu has "Open history" (history icon) right
  under "Copy branch name" (first for a detached HEAD, which opens the history of its SHA). It
  opens History (§16) on the row's branch.
- **Stashes** of the repo under its rows (flow P1, §15).
- Repos sorted by their newest row, rows newest first (by the age shown). Pinned repos come
  first, in the order they were pinned (a missing one too), then the rest as above.
- While the first scan runs: muted "Scanning repositories…" (the list fills in repo by repo).
  With repos but no rows: serif 22px "No active branches" and "Branches checked out in a worktree
  or committed in the last D days show up here."
- Esc clears the selection, otherwise the filter.
- **Empty state** (no repos): subtitle "Nothing to review yet", no refresh or filter; centred 40px
  accent branch icon, serif 28px "No repositories yet", 14px copy, 40px primary
  "Add repository" (multi-folder picker), 12px muted "or drop folders onto this window".
- **Selection bar** (flow H), bottom centre when 1+ rows are selected: "N branches selected"
  (13px/500) + 12px muted "across M repos", divider, secondary "Add to project ▾" (the project
  picker, opening above the bar), primary "New project", ✕ clears.
- **Project picker** (300px popover): "Search" input, projects (name + 12px muted
  "N entries"), and a `#2a2825` footer "+ New project" in `accent.text`. "+ New project"
  turns it in place into a 320px form: serif 18px "New project", "Name" input (focused), "First
  entry" + mono 11 `<repo> / <branch> · base <base>`, Cancel / primary "Create & add ↵". A name
  conflict marks the input invalid with a 12px danger message and disables the button.
- **Toast** after an add: `<branch> added to <Project>` (or `N branches added to <Project>`),
  "Undo" (28px, `#383631`; removes the entries, and deletes the project if the add created it)
  and "Open project →". Disappears after 6 s.

### Review (`Diff.dc.html`)

One screen for both scopes:

- **Project scope** (a sidebar project with entries, Project → "Review changes" or ⌘R, or a
  project row's branch link): title =
  project name, subtitle `X of Y changed` (X = groups with a file in
  any mode).
- **Branch scope** (a Branches row): title = branch (short SHA if detached), subtitle
  `<repo>`; `<repo> · last known state` when opened
  on a deleted branch's last tip. One group.

Layout:

- The sidebar is hidden while on Review and restored on leaving, except when the review was
  opened from the sidebar's project list: then it stays shown. When the user shows it (the
  header's show-sidebar button or the sidebar toggle), Review sits next to it
  (`ReviewSidebar.dc.html`, board L2): the header drops the traffic-light space and the
  show-sidebar button and Back / Forward (all live in the sidebar's top row) and starts with the
  title at 28px, as the other page headers; the file list narrows to 280px; nothing else
  changes. **Header** (a page header, `bg.main`, drag region): with the sidebar hidden,
  traffic-light space, show-sidebar button, Back (aria-label "Back to Branches" / "Back to
  project" / "Back") and Forward at 16px padding; the title + subtitle (project scope: the title
  renames the project in place like the Project page's); right, as History's (the page's own
  controls, then the ⋮ menu last): segmented **Committed / Uncommitted / All**, each with its
  file count summed over all groups, then the **page menu** (⋮, `PageMenu`): "Stash"
  (§15; not in the stash scope), in branch scope "Open history" (`history`, ⌥H; the branch's
  History, or going back to it when Review was opened from there; not for a last known state),
  "Refresh" (full rescan), and in project scope "Edit project"
  (`pencil`), which opens the project page (going back to it when Review was opened from
  there).
- Default mode Committed; Uncommitted if there are no committed changes but some uncommitted.
  Switching mode resets the selection to that mode's first file. Groups with no files in the
  mode are hidden, except the one group of a branch review (its menu, with "Change base", stays reachable).
- **Left file list** (310px, 280px beside the sidebar; `bg.sidebar`, padding 8, scrolls), one
  group per entry (two entries from the same repo are two groups):
  - **Resizing**: its right border is a drag handle (8px hit area, `col-resize`; a 2px accent
    line on hover, focus and drag); 220–640px, ←/→ by 16px when focused, double-click resets.
    The width is remembered on this machine (`localStorage`) and used with or without the sidebar.
  - **File filter** (flow D8): a clearable mono `Input` at the top of the list, above the
    groups (margin-bottom 6, sticky): search icon, placeholder "Search", and on the right `Kbd`
    "⌘K" while empty, or `N files` (`aria-live`) plus the ✕ while it has text. ⌘K focuses it (Review only; the Branches ⌘K is unchanged).
    - Matching: the text is split on spaces; a file matches when every term appears in its
      path (`dir/name`, case-insensitive; a rename's old path counts). It filters the files of
      the current mode (and of the picked commit, when an entry is scoped to one).
    - Each visible file row highlights the first matching term in the name and in the folder
      (`rgba(accent, 0.24)` background, radius 3, `text.strong`). Groups with no match are
      hidden; collapsed groups open while filtering. Line 2 of a group shows 11px muted
      `n of m` before its +/− (which stay the whole group's totals). The "not reviewable" line
      is hidden while filtering. The Committed / Uncommitted / All counts do not change.
    - No match: under the field, 13px `No files match “<text>”`, 12px muted
      `Searched paths in <mode> files of every entry.` and a "Clear filter" text button.
    - Keys in the field: ↵ opens the first match (at its first change); Esc clears the text
      (a second Esc leaves the field).
    - The selected file does not change while typing; if it is filtered out, the diff keeps
      showing it. Change navigation (⌥↓ / ⌥↑, "next file") moves through the visible files only;
      from a filtered-out file it goes to the first / last visible one.
    - The text survives mode switches, commit picks and refreshes; leaving Review clears it.
  - Line 1: collapse chevron + 14px/600 repo name (ellipsis), then right-aligned mono 11 green
    `+add` and red `−del` (del hidden when 0). A small spinner shows while that group recomputes
    after a base change. While the header is hovered or keyboard-focused, or its menu is open,
    the totals give way to a 22×20 "⋮" button (`aria-label` "Branch options"; `bg.pressed` while
    open).
  - Line 2 (indent 20): mono 12 branch (ellipsis), the conflicts pill, and on the right mono 11
    muted upstream state (§15 "Sync": `origin ↑2 ↓1`, `origin` when level, `not on origin · ↑3`;
    tooltip with the counts), replaced by `n of m` while filtering.
  - **Entry menu** (260px, right-aligned under "⋮"; right-clicking the header opens it at the
    pointer): "Change base" (sub `base <ref>`, plus ` · set for this branch` when the base is
    custom) opens the Base menu at the same anchor; then the Branches row menu without "Open
    review": "Copy branch name", "Open history" (back label "Back to Review"), the open items,
    the Sync group (§15 "Sync"), then the Scripts group as the Branches menu (the Project menu in a project review). The
    header has no base control: the entry bar shows the base in use.
  - Commit chip (when the entry is scoped to one commit, see below).
  - Stacked warning (margin 0 8px 6px 28px, padding 7px 10px, radius 8, warning tone):
    `N of M commits come from <branch>. A different base may fit better.`
  - File rows (30px, indent 28, radius 8, selected `bg.hover`): kind badge, mono 12 file name,
    mono 11 dimmed folder (ellipsis; renames `dir ← old/path`, untracked `dir · untracked`),
    `+N` / `−N`.
  - Project scope, if some entries cannot be reviewed: one line under a top border, 12px muted
    `N entries not reviewable ·` + link "Open project".
  - Opening from a project row focuses that entry: its first file is selected and the other
    groups are collapsed.
- **Entry bar** (padding 12px 18px, bottom border): 14px/600 repo name (link: goes to Branches,
  scrolls to that repo's band and highlights it briefly), mono 12 branch (link: opens its History,
  §16; tooltip `Show history of <branch>`), a mono 11 muted range only when it adds something
  (`working tree <~path>` in Uncommitted, `<parent>..<sha>` with a commit picked), and on the
  right 12px muted `N commits ahead of <base>`, the base a link to its History, then
  ` · <upstream state>` (Uncommitted:
  `HEAD ↔ working tree`). Links take `accent.hover` on hover.
- **Commit list** (max ≈132px, scrolls; hidden in Uncommitted): rows with mono 12
  `accent.text` short SHA, subject, and mono 11 muted age. When some listed commits are not on the
  remote, a dashed **upstream line** (18px, mono 10 muted `origin/<branch> · above: not pushed`
  between two 1px dashed `border.strong` rules) sits above the newest commit the remote has (the
  upstream's `mergeBase`); none when every listed commit is pushed or none is. Commits that belong to another branch
  (stacked) are at 60% opacity with a mono 11 warning pill naming the branch.
- **One commit at a time** (flow D7): every commit row is a button (`role="option"`, tooltip
  "Show only this commit"). Clicking one scopes **that entry** to the commit's own changes,
  diffed against its first parent (merge commits too; a root commit against an empty tree).
  - The row gets `#2a2825` and `inset 2px 0 0 #7fb3c4`, subject 500; stacked rows can be picked
    too (85% opacity when picked).
  - Entry bar: range `parent..sha`, "Commit n of N" (oldest = 1), a ↑ ↓ pair for newer / older
    commit (disabled at the ends; ⌥⇧↑ / ⌥⇧↓) and a 28px "Show all commits" button (accent text,
    `#302e2a` border).
  - Left list: under the branch line a chip (`rgba(79,143,163,0.14)`, radius 7): mono 11 short
    SHA in `#a3cad6`, 12px subject with ellipsis, ✕ ("Show all commits"). The group's files and
    `+/−` are the commit's; while they load the previous list stays, dimmed (no spinner).
  - The compare label reads `parent ↔ sha`.
  - Picking a commit opens its first file at its first change. Clicking the picked row again,
    the chip's ✕ or "Show all commits" returns to the whole branch, keeping the current file if
    the branch lists it.
  - Other entries are not affected; the segmented counts stay whole-branch totals. Switching to
    Uncommitted clears every commit scope; in All the commit alone is shown. The selection is
    per visit (not saved). If the branch tip moves and the commit is no longer listed (rebase,
    amend), the scope is dropped silently.
  - Change navigation, Split / Unified and Ignore whitespace work the same inside a commit.
- **File bar** (padding 5px 10px 5px 18px, `bg.sunken`): mono 12 path, 12px muted compare
  label (`merge-base ↔ <branch>`, `HEAD ↔ working tree`, `merge-base ↔ working tree` in All for a
  checked-out entry, `parent ↔ sha` for a commit), the whitespace chip, then on the right the
  view button, a divider and change navigation.
- **Diff:** Monaco diff editor, read-only, **Split** (side by side, default) or **Unified**
  (removed lines shown as view zones above the added ones; line-number columns may differ from
  the reference, accepted). Unchanged regions fold according to the view menu's **Context**
  (default: changes only, 3 lines around each change; Whole file shows everything). No minimap, overview ruler, sticky scroll or
  context menu; `useInlineViewWhenSpaceIsLimited: false`. The editor is created once; changing
  file, layout or whitespace updates it in place. Binary files show muted "Binary file not
  shown"; files over 1 MiB "File is too large to show (over 1 MB)".
- **Diff view menu:** the view button (split or unified icon + "Split" / "Unified" + chevron;
  28px, `#211f1c`, open state `#2a2825` with accent border) opens a 300px menu (`role="menu"`,
  right-aligned under the button): "Layout" label, `menuitemradio`
  Split / Unified (⌥V), divider, **Context** ("Context" label, `menuitemradio`
  "Changes only" (⌥C), then an indented row "Lines around changes" (12px muted, starts at the
  label column) with a small segmented 3 / 5 / 10 on the right (track `bg.track`, padding 2,
  radius 7; buttons min 28 × 22, mono 11, active `bg.pressed` + `text.strong`), then
  `menuitemradio` "Whole file" (⌥C); while Whole file is picked the lines row is at 45% opacity
  and inert; picking a number also selects Changes only), divider, `menuitemcheckbox` "Ignore whitespace" with "Hide lines where only indentation or trailing
  spaces changed" (⌥W). Every row
  has a 16px indicator column (accent check for the picked layout, a checkbox for whitespace),
  the label, and the shortcut right-aligned; no icons inside the menu. Picking a layout closes
  the menu; the checkbox leaves it open. All of them are global and saved in the config.
- **Context** (flow D9): Changes only passes Monaco `hideUnchangedRegions:
  { enabled: true, contextLineCount: N, minimumLineCount: 3, revealLineCount: 20 }` with N = 3, 5
  or 10; Whole file passes `enabled: false`. A folded region is expanded by clicking it (Monaco's
  own control); a changed setting re-folds the current file. ⌥C toggles Changes only ↔ Whole
  file, keeping N. It does not affect the file list, counts or change navigation.
- **Ignore whitespace** only changes which lines Monaco marks (`ignoreTrimWhitespace`, always
  passed explicitly because Monaco's default is on) and the change counter. It never hides a
  file and never changes the list's `+/−`. While on, a "Whitespace ignored" chip (20px pill,
  `rgba(79,143,163,0.16)`, `#a3cad6`, tooltip "Show whitespace changes (⌥W)") sits after the
  compare label; clicking it turns the option off. Toggling it returns to the first change.
- **Jump between changes** (flow D4): counter "Change i of n" (`aria-live="polite"`, tabular
  numbers) and a ↑ ↓ pair. The current change has the 3px accent bar in both panes; jumping
  scrolls it to the top third of the view. At the last change of a file, ↓ turns accent
  (`rgba(79,143,163,0.18)`, `#a3cad6` icon), its tooltip becomes "Next (⌥↓)", the
  counter adds muted "· next file <name>", and pressing it opens the next file in list order
  (expanding a collapsed group) at its first change. ↑ at the first change does the same
  backwards and lands on the previous file's last change. Disabled only at the very first / last
  change of the whole list ("First change" / "Last change"). Scrolling by hand moves "current" to
  the first change in view. Picking a file lands on its first change. A file with no line
  changes (binary, too large, rename only) shows "No line changes" ("Only whitespace changed"
  when whitespace is ignored), and ↑ ↓ go straight to the neighbouring file.
- **Uncommitted mode:** the commit list is hidden; a warning banner under the header says which
  working trees are shown: `Working tree at <~path>` (branch) or
  `Uncommitted changes across N checked-out entries` (project).
- **Conflicts:** in every mode (not while a stash is shown), when an entry's working tree has
  unmerged files, a danger banner above that one: `1 file has merge conflicts. Resolve it in your
  editor or terminal; Gitgel shows the conflict markers in the Uncommitted layer.` (`N files have
  merge conflicts in M entries. Resolve them …` for several); the group's line 2 has the same
  danger sm `N conflicts` pill as its Branches row (P7). The files are `C` in the
  Uncommitted and All lists; their diff is HEAD ↔ the working tree file with its markers.
- **Base menu** (340px popover, from a Review group's "Change base", the Project table's Base button or a
  "base missing" pill): "Search" input; **Suggested** (mono 13 name +
  `Contains N of the M commits shown`); **Default** (see "Default and remote rows" below);
  **Other branches**; **Remote branches**; **Tags** when the filter
  matches some; a "Use <shortSha>" row when the filter is a 7–40 hex SHA that resolves. Empty
  sections are hidden; ↑/↓/↵/Esc work. After a choice only that group recomputes (the others keep
  their data) and a neutral banner says `Base set to <base>` (the uncommitted banner takes precedence; the banner goes
  away when leaving the screen).
- **Default and remote rows** (flows E4–E6):
  - **Selection** (user decision 2026-09-28, replacing the `auto` / `current` pills and the "Use
    automatic default" button): every row has a 16px leading check column, as in the diff view
    menu; the base in use gets an `accent.text` check (`aria-selected`), in every section — the
    stored custom base, else the Automatic row. No pills and no "current" notes. The row
    highlight (`bg.hover`) is only the keyboard / hover row; the menu opens with it on the
    checked row.
  - Default header: `Default` + 11px `text.faint` `from <source>` (e.g. `from origin/HEAD`).
  - First row **Automatic** (13px sans): second line 12px muted `uses <ref>` (the ref the
    nearest-default rule picks now), on the right `N commits` against it; tooltip "Uses whichever
    of the two shares the most history with this branch". Picking it clears the stored base
    (`set_branch_base(key, null)`), so it is also the way back from any stored base, even when a
    candidate row is disabled.
  - Then one row per default candidate, only when there are two (the local branch and its
    remote-tracking twin, `master`, `origin/master`, local first), to pin one by hand: mono 13
    name; on the right 12px muted `N commits` (the entry's commits on top of that candidate), or
    `same as <other>` when both point at the same commit. A candidate with no common ancestor is
    disabled (45% opacity, skipped by ↑/↓, tooltip "No common ancestor with this branch") and its
    note reads `no common ancestor`. With a single candidate the section is the Automatic row
    only.
  - Picking a candidate row stores it as the custom base, like any other row.
  - **Remote branches** (after Other branches, before Tags): remote-tracking branches
    (`refs/remotes/*`, without `*/HEAD` and without the Default candidates), same row style as
    Other branches. The one whose short name equals the entry's branch comes first, with a muted
    `same name` note. Filtered by the menu input like the other sections; hidden when empty.
  - The entry menu's "Change base" and the entry bar always show the ref in use
    (`base origin/master`, `ahead of origin/master`); "set for this branch" still means
    "stored custom base" only.
- Empty states: "No committed changes" / "No uncommitted changes" / "No changes". Branch scope
  on an entry that cannot be reviewed: "This branch no longer exists", "Repository not found",
  "Base missing: …".
- The review refreshes in place when a related repo changes (the open file stays selected if it
  is still listed).
- **Stashes** under the file list, and the stash scope opened from Branches (flows P2–P3, §15).

### Project (`Projects.dc.html`)

- **Header** (a page header): the title (a click or F2 renames; on hover it shows its field box,
  `bg.sunken` with a 1px border, tooltip "Rename project"); subtitle
  `N entries across M repos` / `1 entry · <repo>` / `Empty`; right: refresh, secondary "Add
  entries ⌘K", primary "Review changes" (disabled when empty; ⌘R), "⋯" (32px; open `bg.pressed`
  + `#4a4741` border).
- **Table:** grid `104px minmax(0,1fr) 160px 56px 56px 116px 160px 32px`, padding 12px 28px, row
  border `border.row`: Repo · Branch · Base · Ahead · Files · Uncommitted · State · ⋯.
  - Repo: serif 15px; click goes to Branches and highlights that repo's band.
  - Branch: mono 13 link → project review focused on that entry.
  - Base: button (mono 12, `bg.elevated`, radius 8, ellipsis + chevron) → base menu.
  - Ahead `↑N` or "—"; Files or "—"; Uncommitted and State as on Branches, plus danger pills
    "branch deleted" (opens the entry menu) and "repo path not found" (→ Settings).
  - Broken entries (deleted branch, missing repo) stay in the list at 60% opacity. States are
    labels, never error screens, modals or toasts.
- **Entry menu** (260px; the row is `bg.elevated` and the button `bg.pressed` while open):
  - Every item has an icon: history (View last known state), branch (Point to
    another branch…), copy (Copy branch name), minus-in-circle (Remove from project); open items
    as below.
  - "View last known state" (deleted branches only), with mono 11 muted
    `tip <shortSha> · seen <age> ago`; disabled with `tip <shortSha> · no longer in the repository`
    when the commit is gone. Opens single-branch review on that tip.
  - "Point to another branch": a branch picker (local branches of the entry's repo); repoints
    the entry and refreshes its last known tip.
  - "Copy branch name" (hidden for detached entries).
  - After the open items, the Sync group (§15 "Sync"), then the Scripts group for scripts shown
    in the Project entry menu (§14);
    there `branch.project` and `GITGEL_PROJECT` are the project's name (none in a draft).
  - **Open items**: divider, "Open in Finder" (the worktree folder, or the repository folder
    when the branch is not checked out), then "Open in <App>" for
    each installed editor, in this order: Cursor, VS Code, Windsurf, Zed, Sublime Text, then one
    item for the terminal chosen in Settings › General ("Open in Terminal", "Open in iTerm2",
    "Open in WezTerm", or the Other app's or command's name). Editors that are not installed are
    not listed. Each item's icon is the app's own macOS icon, 16px, drawn grayscale
    (`filter: grayscale(1)`), Finder's too; without one, a terminal line icon.
    A pick closes the menu; a failure is logged (`log::warn!`), nothing is shown.
    - Items that cannot be used are left out, not shown disabled. A branch that is not checked
      out still opens its repository folder, and the menu's closing note says "Not checked out"
      (it covers the worktree scripts too,
      §14). A missing repo or a deleted branch has nothing to open: no open items, and the note
      says "Repository not found" / "Branch deleted" (a gone detached worktree counts as deleted). A chosen terminal
      that is not installed is left out and the note says "<Name> not installed". The note is 12px `warning.text`, line-height 1.45, padding
      6px 10px 4px, with a 14px circle-i icon.
    - One note at most per menu, at its very end after a divider (below Remove from project in
      the Project entry menu), never inside a group. A group left empty takes its divider with
      it (no divider at either end of a menu or twice in a row).
  - Divider, danger "Remove from project".
- **Project menu** (230px; also on the sidebar's right-click): "Rename" (hint "F2"), divider,
  danger "Delete project".
- **Rename:** the title becomes an in-place input in the title's own box (at least 340px wide,
  30px, padding 0 6px, 1px border, serif 22px, `bg.sunken`), so the name does not move; only the
  border turns accent, no ring; text selected; the subtitle stays. A name conflict
  (case-insensitive, itself excluded) turns the border and subtitle danger: `A project named "X" already exists`; ↵
  then does nothing, as with an empty name. Esc or a click elsewhere cancels.
- **Delete confirm** (440px modal): serif 22px `Delete "Name"?`, "Removes the project and its N
  entries. Nothing on disk is touched." ("its 1 entry"), Cancel / danger "Delete project". Afterwards Branches.
- **Empty project:** centred serif 28px "No entries yet", "A project groups branches that belong
  to one piece of work, across any of your repositories.", 40px primary "Add branches ⌘K".
- A project that no longer exists (deleted elsewhere) sends the screen back to Branches.
- **Draft project** (flows C and H): not saved until named. Title in rename mode with the text
  selected; subtitle "Name your project" (from a selection:
  `N entries across M repos · name your project`); the sidebar shows it as an active
  row; rows come from the scan. ↵ with a valid name creates it; Esc, or going to another screen,
  discards it.

### Add palette (`Palette.dc.html`)

- Opens over the project it adds to (⌘K, "Add entries", "Add branches", the "add related" card);
  there is **no project picker**. Works for a draft project too.
- 620px dialog, centred, top 96px, radius 16, over the scrim. Search row 56px: search icon, 16px
  input (focused), 12px muted "fuzzy · all repos". List max 470px. Footer (`bg.sunken`):
  "N selected" … Cancel, primary "Add ↵".
- Groups: **Worktrees** (active entries checked out somewhere), **Active branches** (the rest of
  the active ones), **Older · found by search** (all other local branches; only while searching,
  at most 50).
- Row: checkbox, mono 13 branch, 12px muted meta (`api-server · ↑2 · 4 files · ● 1 uncommitted`,
  `mobile · ↑5 · 8 files · 3d ago`, `web-app · merged into main · 41d ago` with a success pill
  "merged"). Entries already in the project are disabled at 55% opacity with
  `<repo> · already in <Project>` and a neutral pill "in project".
- Search: fuse.js on `branch` (weight 2), `repoName`, `worktreePath`; threshold 0.35,
  `ignoreLocation`. Group order is kept.
- Keyboard: ↑/↓ move the active row (skipping disabled ones; active row `bg.hover`). Space marks
  the active row when the query is empty or while navigating with the arrows (otherwise it types
  a space, for searches like "feat queue"). ↵ adds the marked rows, or, if none are marked, the
  row reached with the arrow keys (a row under the mouse is not added). The "Add ↵" button adds
  only marked rows and is disabled when none are. Esc or a click outside closes the palette.

### Settings (`Settings.dc.html`)

- A page header, serif 22px "Settings". Under it, like VS Code's settings, a 200px section list
  (padding 16px 10px, 1px `border.row` on its right) and the chosen section's pane (scrolls on
  its own; content max 760px, padding 28px 32px 40px, groups 28px apart). Sections: 34px rows
  (radius 8, 13px, 16px muted icon, gap 10): **General** (sliders), **Repositories** (folder icon,
  repo count in mono 12 muted on the right), **Scripts** (prompt icon, script count; §14),
  **Shortcuts** (keyboard). The chosen one:
  `bg.sidebarActive`, `text.strong` 500, `aria-current="page"`; others hover `bg.sunken`.
  Settings opens on the section shown last (General at first; kept for the session).
  The sidebar's "N repositories" row and every "path not found" link open Repositories; the
  gear and ⌘, open the last one.
- **Repositories:** serif 18px heading; a `List`. Row: 500-weight name
  (96px), mono 12 muted path (ellipsis), a note (`base <defaultBase>`, "no base found", or a
  danger pill "path not found" + 28px "Locate", or "git error"), ✕ remove. "+ Add repository"
  (last row, `accent.text`) opens the folder picker and sheet (flow A).
  - Locate: the picked folder must be a repository (or resolve to one) not already added under
    another id; errors show as a failed toast with the picked folder under the message ("Not a git
    repository", "Already added as <name>"). Fixes every entry of that repo.
  - ✕ asks first only when projects use the repo: `Remove <name>?` · "Its N project entries are
    removed too. Nothing on disk is touched." · Cancel / danger "Remove". Removing drops the repo,
    its branch bases and its project entries.
  - Under the card, "Default base" ("Used when a branch has no base"; label level with the first
    row): an ordered list, one branch per row, so no separator is ever typed (flow M4/M5). A 280px
    compact `List` (radius 10); 34px rows: mono 11 faint position, mono 12 name (ellipsis),
    then ↑ / ↓ / ✕ (24px icon buttons, shown while the row is hovered or holds focus): move up,
    move down, remove. ↑ is disabled on the first row, ↓ on the last, ✕ when only one is left
    (the list is never empty). The last row "+ Add branch" (`accent.text` 500) becomes a 28px
    mono `Input` ("Branch name, e.g. develop"). ↵ adds the trimmed name at the end; a name already in the list ("<name> is already in
    the list") or not a valid ref name ("Not a valid branch name": `git check-ref-format` rules,
    e.g. spaces, `~ ^ : ? * [ \`, `..`, `@{`, `//`, a leading `-` or `/`, a trailing `/` or `.`,
    a part starting with `.` or ending in `.lock`) is not added: the field turns invalid and the
    line under the card says why in danger. Esc, or leaving the field empty, closes it. Each change is
    saved at once.
  - "Active threshold" ("Branches without a worktree are listed if committed within"): 60px
    right-aligned mono input + "days"; anything but an integer 1–365 restores the old value.
  - Changing either rescans every repo.
- **General:** serif 18px heading "General".
  - "Theme": a radiogroup of three tiles, gap 16 — **System** (default), **Light**, **Dark**.
    Tile: 120 × 72 mini-window preview (radius 9, clipped): a 32px sidebar strip with traffic
    lights and three lines, content with a title bar, three lines and an accent chip, drawn in
    that theme's colours; System is split diagonally (light top-left, dark bottom-right). 12px
    label under the tile. Selected: `0 0 0 2px accent` ring and `text.strong` 500 label; others
    `0 0 0 1px border` and a muted label. Arrow keys move the choice (radio semantics). Under the
    tiles, 12px muted: "System follows the macOS appearance and switches with it." A choice
    applies at once and is saved (`settings.appearance`).
  - "Terminal" ("Used by “Open in …” in the branch menus"): a 230 × 36px
    dropdown (native `<select>`, `bg.elevated`, 1px border, radius 8, 13px, 12px chevron at the
    right): "Automatic (<Name>)" (default: the first installed of iTerm2, WezTerm, Terminal),
    Terminal, iTerm2, WezTerm, "Other". Terminals that are not installed are disabled. At
    launch a chosen terminal that is not installed falls back to Automatic (an Other command
    cannot be checked, so it is left alone). Other shows under it, full width, a 36px mono input
    (placeholder `wezterm start --cwd %`, saved on blur/↵, trimmed; empty = Automatic) and a
    12px muted note: "A command, or an app name such as Ghostty. `%` becomes the worktree folder;
    the command runs in your login shell, in that folder." When the chosen app is not installed,
    a right-aligned 12px `warning` line: "<Name> is not installed; the menus show it disabled".
    Saved at once (`settings.terminal`, `settings.terminalCommand`).
  - "Check for updates" ("At launch and every 6 hours; a new version shows in the sidebar"): a
    checkbox, on by default (`settings.checkUpdates`). Off hides a found update; on checks at once.
- **Scripts:** see §14 "Settings › Scripts".
- **Shortcuts:** serif 18px heading "Keyboard shortcuts" + muted "Not editable yet"; four cards
  (`bg.sunken`, radius 12, padding 6px 0) in a `repeat(2, minmax(max-content, 1fr))` grid, gap 12
  (a narrow window scrolls instead of squeezing): **General**, **Branches and projects**,
  **Review**, **Lists and dialogs**. Group
  title 11px uppercase (padding 8px 14px 6px); rows min 34px, padding 0 14px: label (`#e0ddd6`,
  nowrap), optional 11px `#75726b` note, keycaps on the right. Keycap: min 22 × 22px, padding 0 6,
  `#211f1c`, 1px `#383631` border with a 2px bottom, radius 6, mono 11 `#faf9f5`; "/" between
  alternatives is 11px muted text, not a keycap. The list comes from `src/lib/shortcuts.ts` (§7).
- Nothing else: no refresh interval, focus refresh or git-binary settings.

### Add repositories sheet

- Modal, 600px wide, top 110px. Serif 22px "Add repositories". Subtitle: "N folders selected.
  Worktree folders resolve to their main repository." (no repos yet) or "N folders selected.
  Repositories already in Gitgel are skipped."
- One row per folder: 22px round icon (✓ success, ↪ warning, ✕ danger), mono 12 `~path`, 12px
  muted note:
  - repo: `Git repository · default base <base>` / `Git repository · no default base found`
  - worktree: `Worktree of <~repo> · adds the main repository`
  - subfolder: `Inside <~repo> · adds the repository root`
  - already added: `Already added · skipped`; a worktree of an added repo:
    `Worktree of <~repo> · already added, skipped`
  - repeated in the same batch: `Already in this list · skipped` (worktree:
    `Worktree of <~repo> · already in this list, skipped`)
  - not a repo: `Not a git repository · skipped`
- Footer (`bg.sunken`): Cancel and primary "Add N repositories" ("Add 1 repository"), counting
  only new repos; disabled when there are none.

### Drop overlay

Folders dropped anywhere, on any screen, open the sheet. While dragging over the window, above
everything and click-through: 2px inset accent border, `rgba(79,143,163,0.06)` wash and a
centred elevated pill (padding 12px 18px, radius 12, 1px accent border) with an 18px accent
folder-plus icon and 14px "Drop folders to add repositories". Drops are ignored while a modal is
open.

---

## 6. Flows

- **A · First run.** Branches is empty ("No repositories yet"). **Add repository** (multi-folder
  picker) or dropping folders opens the sheet, which checks each folder: ✓ git repository with
  its default base; ↪ worktree or subfolder, resolved to the main repository (duplicates
  skipped); ✕ not a repository, skipped. "Add N repositories" fills Branches.
- **A · More repositories later.** The sidebar footer's "+", Settings' "+ Add repository" and
  dropping folders on any screen all end in the same sheet.
- **B · Project from a Branches row.** "+ Add" in a row's Projects cell opens the project
  picker; pick a project, or "+ New project" → name form → "Create & add ↵". The row stays; its
  cell shows the new count; a toast offers Undo and "Open project →". A project page with one
  entry shows the "add related branches" card; ⌘K opens the palette for that project.
- **C · Empty project.** Sidebar "New project" or ⌘N opens a draft project ("Untitled project",
  "Untitled project 2", …) with the title in rename mode. ↵ saves; Esc discards it and goes
  back. "Add branches ⌘K" opens the palette; picks go into the draft.
- **D · Review.**
  1. Project → "Review changes" opens project review (Committed).
  2. Uncommitted applies to the whole project.
  3. A Branches row opens single-branch review.
  4. ↑ ↓ (⌥↑ / ⌥↓) jump between changes and continue into the next / previous file.
  5. The view button switches Split / Unified and Ignore whitespace (and the
     context: changes only with 3 / 5 / 10 lines, or the whole file — flow D9).
  6. With whitespace ignored, an indentation-only line is no longer a change and the chip shows.
  7. Clicking a commit shows only that commit's changes against its parent; ↑ ↓ (⌥⇧↑ / ⌥⇧↓)
     step through commits.
- **E · Stacked branch.** With base main, the entry lists another branch's commits dimmed and
  labelled, plus the warning note. The entry menu's "Change base" suggests that branch. After choosing,
  only that group recomputes and the banner confirms. The base is stored per branch.
- **F · Broken entries.** Labels, not errors: a deleted branch offers its last known state; a
  missing repo is fixed with Locate in Settings (fixes all its entries); "base missing" opens the
  base menu.
- **G · Rename / delete project.** As described under the Project screen.
- **H · Project from a selection.** Select rows on Branches; the selection bar offers "Add to
  project ▾" (the project picker) or "New project" (a draft project with those entries, title in
  rename mode, as in C).
- **I · Which projects a branch is in.** The Projects column counts them; clicking the count
  lists them and offers "+ Add to another project". The "Not in a project" filter shows only
  branches in no project.
- **N · Scripts**. Settings › Scripts lists the user's scripts (N5); "+ New
  script" or ✎ opens the editor (N6); Import previews a file first (N7). A branch's menu (Branches
  row or Project entry) lists the scripts whose Show when matches (N1); worktree scripts are
  left out when the branch is not checked out (N2). Running shows a toast (N3) and, for output
  clicking the toast opens the output panel (N4); "Open the output panel automatically" opens it
  as the script starts. When a script exits its repo is rescanned.
- **O · Script inputs.** A script with inputs opens the run dialog first (O1, O2); one with
  "Ask before running" and nothing to fill in asks in a short confirmation (O3); ⌘↵ runs it.
- **P · Stashes.** Each repo band on Branches lists its stash stack (P1); a stash opens the
  stash review (P3). Project and branch reviews list the stashes taken on their branches under
  the files (P2). Picking one shows what it holds, against the commit it was taken on. Stash
  stashes the review's entries (P4); Apply / Pop pick a worktree (P5); Drop asks first (P6).
  Each runs git like a script: a toast, and its output on click.
- **J · Open elsewhere.** The ⋯ menu of an entry (Project, Review) or
  row (Branches) opens its worktree folder in Finder or in an installed editor or terminal; a
  branch that is not checked out opens the repository folder instead, with a note saying so.

---

## 7. Keyboard shortcuts and menus

`src/lib/shortcuts.ts` is the list shown in Settings. It is not read by the handlers; each
handler carries a `Listed in lib/shortcuts.ts` comment, so change both together. ⌥ turns letters
into other characters, so ⌥ shortcuts check the physical key (`e.code`). Review shortcuts also
work while the diff has focus (registered as Monaco commands; the editor is read-only, so its
own ⌥↑/⌥↓/⌥⇧↑/⌥⇧↓ line actions are free).

| Group | Action | Keys | Where |
|---|---|---|---|
| General | New project | ⌘N | everywhere, unless a modal is open |
| | Back / Forward | ⌘[ / ⌘] (physical keys; ⌘ğ / ⌘ü on a Turkish Q layout), also ⌘← / ⌘→ outside text fields | everywhere |
| | Settings | ⌘, | app menu |
| | Font size | ⌘- / ⌘. , ⌘0 resets | View menu |
| | Close menu or dialog | Esc | topmost popover, menu, modal or palette; otherwise clears the selection or filter |
| Branches and projects | Focus filter | ⌘K | Branches; Review focuses the file filter |
| | Add branches | ⌘K | Project (opens the palette) |
| | Review changes | ⌘R | Project |
| | Rename project | F2 | Project |
| | Collapse or expand all repos | ⌥-click a repo band | Branches |
| Review | Next / previous change | ⌥↓ / ⌥↑ | continues into the next / previous file |
| | Newer / older commit | ⌥⇧↑ / ⌥⇧↓ | with no commit picked, ⌥⇧↓ picks the newest |
| | Split / Unified | ⌥V | |
| | Ignore whitespace | ⌥W | |
| | Review / History | ⌥H | the same branch's other page (also in the diff) |
| | Changes only / Whole file | ⌥C | |
| Lists and dialogs | Move | ↑ / ↓ | |
| | Mark row | Space | Add palette |
| | Run script | ⌘↵ | script run dialog |
| | Confirm | ↵ | |
| | Cancel | Esc | |

⌘R never reloads the webview (default prevented everywhere). Multi-select on Branches is by
checkbox only (no ⌘/⇧-click).

**App menu** (`src-tauri/src/menu.rs`, the standard macOS menus plus). The Gitgel menu reads
About Gitgel, divider, Settings… (⌘,), Check for Updates…, divider, Services, Hide, Quit.

- **Gitgel › About Gitgel**: opens the app's own **About** window (`AboutModal`, 340px, top 140,
  instead of the standard panel; `FlowU3.dc.html`): a ✕ (28px, top right), the 88px app icon,
  serif 30px "Gitgel", 13px muted `Version <version>` and the build time (`Oct 6, 2026, 8:40 PM`,
  `__BUILD_TIME__` from `vite.config.ts`), then full-width 40px secondary buttons "What's New"
  (closes About, opens What's New) and "Report an Issue" (`report_issue`: the issues page). Esc,
  a click outside or ✕ closes it.
- **Gitgel › Check for Updates…**: checks now, whatever the setting, and opens the
  **Software Update** window (`UpdateModal`, 360px, centered; Esc / Later closes it except while
  installing). It follows the backend's `update-check` event (`checking` → `upToDate` /
  `available` / `failed`); "Try Again" after a failed check calls `check_for_updates`. Top to
  bottom, centered: the 88px app icon (`src-tauri/icons/128x128@2x.png`, soft drop shadow), a
  serif 22px title, then by state:
  - checking: "Checking for updates…" and an indeterminate 4px accent bar; Cancel.
  - up to date: "You’re up to date", muted `Gitgel <version> is the newest version.`; OK.
  - available: "A new version is available", the versions as mono pills (`<current>` muted →
    `<new>` accent), then the release notes of every version newer than the current one, newest
    first, in a 200px scrolling box (`bg.sunken`, `border`, radius 10, padding 0 14px; the What's
    New body below at 12px, version mono 12, group titles 10px) when the feed has any; the window
    is 440px wide with them, and keeps them while downloading (`FlowU1.dc.html`
    29–59, data 83–99). Muted "Gitgel restarts to finish the update."; Later /
    **Update and Restart**. Installing shows the download bar (`Downloading… N%`, then `Installing…`) and
    disables both; a failed install shows its error and the primary becomes "Try Again".
  - failed: "Cannot check for updates" and the error (mono 11, danger tint); Close / Try Again.
  Buttons are 36px and share the width, the primary last.
- **Help › What's New** (first in Help, then a divider): opens the **What's New**
  window (`WhatsNewModal`): the release notes of `CHANGELOG.md`, bundled into the app at build
  time (Vite `?raw`), newest first, the running version's section first. Each version: its
  number (mono) and date, then the groups New / Improved / Fixed as bulleted lines; `code` spans
  render mono. A small parser in `src/lib/changelog.ts` reads `## <version> — <date>`,
  `### <group>` and `- ` lines; nothing else of Markdown is supported. Esc / OK closes it.
  It opens by itself once after an update: at startup, when `settings.lastSeenVersion` is older
  than the running version, or empty in a config that has repositories (versions before 0.1.17
  did not write it), it is shown and `lastSeenVersion` is set to it; on a fresh install (empty,
  no repositories) it is only set; over another modal it waits for the next launch. Look and sizes:
  `FlowU2.dc.html` (light twin on the canvas): 520px modal, top 80, max 640px; `ModalHeader`
  "What's New", sub `Gitgel <version>`; the notes scroll between a top `border` and a
  `ModalFooter` with primary "OK" (25–46). Each version (padding 18px 0, `border.row` between):
  mono 13/500 number, 12px muted date (`Oct 6, 2026`); groups gap 12: 11px uppercase
  `text.faint` title, 13px lines (line-height 1.5) after a 4px `text.faint` dot; `code` mono 12
  on `bg.hover`, radius 4 (data 54–93).
- **Gitgel › Settings…** (⌘,): emits `open-settings`; the frontend opens Settings unless a modal
  is open or Settings is already showing.
- **View › Font Size**: Decrease (⌘-), Increase (⌘.), Reset (⌘0). Zooms the whole window in steps
  50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200 %; saved as `settings.zoom` and applied at
  startup. ⌘- and ⌘. need no Shift on Turkish and US layouts.
- **Help › Discuss on GitHub** (after What's New and a divider; opens https://github.com/gokberkakdeniz/gitgel/discussions),
  **Search or Report an Issue on GitHub** (…/issues), divider, **Show Logs in Finder** (writes all
  logs with the app and libgit2 versions to `~/Downloads/Gitgel-logs-<time>.log` and reveals it).

---

## 8. Data model and shared types

TypeScript types are in `src/lib/types.ts`; the Rust equivalents in `src-tauri/src/model.rs`
use the same field names (`#[serde(rename_all = "camelCase")]` on structs, `snake_case` on enums,
`Option<T>` for nullable fields).

### Entry key

```ts
// src/lib/entryKey.ts; the same function exists in model.rs
entryKey = branch !== null ? `${repoId}:${branch}` : `${repoId}:@${worktreePath}`
```

The same key indexes `branchBases`.

### Config (on disk)

```ts
export interface RepoConfig { id: string; path: string }          // id: "r_" + 8 hex
export interface LastKnownTip { sha: string; seenAt: string }      // seenAt: ISO 8601 UTC
export interface EntryConfig {
  repoId: string;
  branch: string | null;         // null => detached HEAD worktree entry
  worktreePath: string | null;   // only set on detached entries
  lastKnownTip: LastKnownTip | null;
}
export interface ProjectConfig {
  id: string;                    // "p_" + 8 hex
  name: string;
  createdAt: string;             // ISO 8601 UTC
  entries: EntryConfig[];
}
export type DiffLayout = 'split' | 'unified';
export interface Settings {
  defaultBaseOrder: string[];    // default ["origin/HEAD", "main", "master"]
  activeDays: number;            // default 14
  diffView: DiffLayout;          // default 'split'
  ignoreWhitespace: boolean;     // default false
  diffContext: 'changes' | 'whole'; // default 'changes'
  diffContextLines: 3 | 5 | 10;  // default 3; anything else reads as 3
  zoom: number;                  // View › Font Size, percent; default 100
  terminal: 'auto' | 'terminal' | 'iterm' | 'wezterm' | 'other'; // default 'auto'
  terminalCommand: string;       // Other: a command (`%` = folder) or an app; default '' (T14.7)
  checkUpdates: boolean;         // Settings › General › Check for updates; default true
  lastSeenVersion: string;       // version whose What's New was shown; default ''
  appearance: 'system' | 'light' | 'dark'; // Settings › General › Theme; default 'system' (T10.1)
}
export interface Config {
  version: 1;
  repos: RepoConfig[];
  branchBases: Record<string, string>;   // entryKey -> base ref name
  projects: ProjectConfig[];
  settings: Settings;
  scripts: ScriptConfig[];               // §14, menu order
  pinnedRepos: string[];                 // repo ids pinned to the top of Branches, in pin order
}
export interface EntryRef { repoId: string; branch: string | null; worktreePath: string | null }
```

Settings fields added later default when missing (`#[serde(default)]`), so older config files
load. A broken config file is renamed to `config.broken-<unix>.json` and the app starts with the
defaults. Saves are atomic (`config.json.tmp` + rename). Every change goes through
`config::update`, which saves and emits `config-changed`.

### Scan and summaries

```ts
export type EntryState =
  | 'ok' | 'merged' | 'detached' | 'base_missing'
  | 'branch_deleted' | 'repo_missing' | 'git_error';

export interface EntrySummary {
  key: string;                   // entryKey
  repoId: string;
  repoName: string;              // basename of the repo folder
  branch: string | null;
  worktreePath: string | null;   // where it is checked out; null if not checked out
  headSha: string | null;        // current tip; null if deleted or the repo is missing
  shortSha: string | null;
  base: string | null;           // effective base ref: custom, else the nearest default
  baseIsCustom: boolean;
  ahead: number | null;
  behind: number | null;         // base commits the branch does not have
  files: number | null;          // files changed merge-base..tip
  add: number | null;
  del: number | null;
  uncommitted: number | null;    // null if not checked out
  conflicts: number;             // uncommitted files with merge conflicts (unmerged)
  lastCommitAt: number | null;   // committer time of the tip, unix seconds
  changedAt: number | null;      // newest uncommitted file mtime; only when newer than lastCommitAt
  state: EntryState;
  error: string | null;          // detail for git_error / base_missing
  upstream: Upstream | null;     // where it is pushed to (§15 "Sync"); null when detached, deleted or without a remote
}
export interface Upstream {      // as of the last fetch
  remote: string;                // e.g. "origin"
  name: string | null;           // remote-tracking branch ("origin/feat"); null: not on the remote
  ahead: number;                 // commits the remote lacks (on top of `name`, else of the base)
  behind: number;                // commits of `name` the branch lacks
  mergeBase: string | null;      // newest commit shared with `name`
}

export interface OtherBranch {   // palette "Older" group
  repoId: string; repoName: string; branch: string; lastCommitAt: number; merged: boolean;
}
export interface RepoScan {
  repo: RepoConfig;
  name: string;
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  defaultBase: string | null;        // e.g. "main"
  defaultBaseSource: string | null;  // matching defaultBaseOrder item, e.g. "origin/HEAD"
  baseBranch: string | null;         // local name of the base branch, always in `active`
  active: EntrySummary[];            // active branches + detached worktrees, newest first
  others: OtherBranch[];             // all other local branches except the base branch
  stashes: StashInfo[];              // the stash stack, newest first (§15)
}
export interface StashInfo {
  index: number;                     // n in stash@{n}; 0 is the newest
  sha: string;
  message: string;                   // text after "On <branch>: ", or the whole "WIP on …" line
  branch: string | null;             // taken on; null on a detached HEAD
  branchExists: boolean;
  base: string;                      // the commit it was taken on (first parent)
  files: number | null;              // null when its changes could not be read
  createdAt: number;
}
export interface ScanResult { repos: RepoScan[]; scannedAt: number }

export interface RepoUpdated {       // payload of `repo-updated`
  repoId: string;
  scan: RepoScan;                    // full current state; replaces the stored record
  reason: 'refs' | 'worktree' | 'rescan';
  worktreePath: string | null;       // the changed worktree when reason is 'worktree'
}
```

**Entry state.** Priority: `repo_missing` > `git_error` > `branch_deleted` > `base_missing` >
`detached` > `merged` > `ok`. `base_missing` when the base does not resolve ("base <name> not
found") or has no common ancestor with the tip ("no common ancestor"). `merged` =
`(ahead == 0 || squashMerged) && (uncommitted ?? 0) == 0`, so a fresh agent worktree with only
uncommitted changes is not "merged". **Squash merges:** with `ahead > 0`, take the paths the
branch changed (A, old and new paths of renames) and diff base ↔ tip limited to exactly A; no
delta means the changes are already in base. Unexpected git2 errors become `git_error` with the
message and a `log::warn!`; nothing panics (`unwrap`/`expect` only in tests).

### Review

```ts
export type DiffMode = 'committed' | 'uncommitted' | 'all';
export type FileKind = 'A' | 'M' | 'R' | 'D' | 'U' | 'C'; // C: unmerged (git2 Delta::Conflicted)
export interface FileChange {
  path: string;
  oldPath: string | null;        // R only
  kind: FileKind;
  add: number | null;            // null if binary
  del: number | null;
  binary: boolean;
  oldOid: string | null;         // null => left side empty (added / untracked)
  newOid: string | null;         // null => right side read from disk (worktree); empty for D
}
export interface CommitInfo {
  sha: string; shortSha: string; subject: string; committedAt: number;
  fromBranch: string | null;     // the other branch this commit belongs to (stacked)
}
export interface StackHint { branch: string; contains: number; total: number }
export interface ReviewGroup {
  entry: EntrySummary;
  mergeBase: string | null;
  files: Record<DiffMode, FileChange[]>;   // all three modes at once; the toggle is instant
  commits: CommitInfo[];                   // newest first, at most 200
  stackHint: StackHint | null;
}
export interface CommitChanges {           // one commit against its first parent
  sha: string;
  parent: string | null;                   // null => root commit (empty tree)
  files: FileChange[];
}
export interface StashChanges {            // a stash against its first parent; untracked = U
  sha: string;
  base: string;
  files: FileChange[];
}
// History (§16)
export interface HistoryCommit {
  sha: string; shortSha: string;
  subject: string;
  body: string;                   // the message after the subject, trimmed; '' when none
  author: string; authorEmail: string;
  committedAt: number;            // committer time, unix seconds
  parents: number;                // > 1: a merge commit
  inBase: boolean;                // reachable from the base asked for (below the base line)
}
export interface HistoryPage {
  rev: string;                    // as asked for
  tip: string | null;             // null => the rev does not resolve
  commits: HistoryCommit[];       // newest first (committer time), at most `limit`
  more: boolean;                  // the walk has more commits (or matches) past `limit`
  total: number | null;           // commits reachable from the tip; null while searching
  ahead: number | null;           // commits not in the base; null without a base
  mergeBase: string | null;       // tip ↔ base
  fetchedAt: number | null;       // FETCH_HEAD's modification time; null if never fetched
  upstream: Upstream | null;      // when rev is a local branch: where it is pushed to (§15 "Sync")
}
export interface HistoryRefs { branches: string[]; remotes: string[] }   // sorted; no */HEAD
export interface ReviewData {
  groups: ReviewGroup[];          // reviewable entries, in project order
  notInReview: EntrySummary[];    // project scope only
  totalEntries: number;
}
export type ReviewTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'branch'; repoId: string; branch: string | null;
      worktreePath: string | null; tipOverride: string | null }
  | { kind: 'stashes'; repoId: string };   // a repo's stash stack: no groups (§15)
export interface FilePair { original: string; modified: string; binary: boolean; tooLarge: boolean }
```

Reviewable states: `ok`, `detached`, `merged`. In project scope a `merged` entry with no files in
any mode, and every other state, goes to `notInReview`. Layers for an entry checked out in a
worktree: `uncommitted` = HEAD ↔ working tree (untracked included), `all` = merge-base ↔ working
tree; not checked out: `uncommitted = []`, `all = committed`. A base branch without an upstream
has only its working-tree layers.

### Other

```ts
export type FolderKind = 'repo' | 'resolved' | 'duplicate' | 'not_git';
export interface FolderCheck {
  input: string;                          // the path the user picked
  kind: FolderKind;
  repoPath: string | null;                // resolved main repository root
  via: 'worktree' | 'subdir' | null;      // how resolved/duplicate inputs were resolved
  duplicateOf: 'config' | 'batch' | null;
  defaultBase: string | null;
}
export interface BaseCandidate {
  name: string;                           // "master" or "origin/master"
  remote: boolean;
  ahead: number | null;                   // the entry's commits on top of it; null if unrelated
  sameAs: string | null;                  // the other candidate's name when both are one commit
  unrelated: boolean;                     // no common ancestor with the entry's tip
  auto: boolean;                          // the one the nearest-default rule picked
}
export interface BaseOptions {
  current: string | null;
  suggested: StackHint[];                 // descending by contains, contains > 0
  defaults: { source: string; candidates: BaseCandidate[] } | null; // local first
  branches: string[];                     // all local branches except the entry itself
  remotes: string[];                      // remote-tracking, same-name first
  tags: string[];
}
export interface ProjectView { project: ProjectConfig; entries: EntrySummary[] }
export interface OpenApp {
  id: string;                    // "vscode"; "finder"; "terminal" is the chosen terminal
  name: string;                  // "VS Code"
  icon: string | null;           // PNG data URL of the app's icon
  found: boolean;                // false only for a terminal that is not installed
}
export interface TerminalOption {
  choice: 'terminal' | 'iterm' | 'wezterm';
  name: string;                  // "Terminal"
  found: boolean;                // false when not installed; the dropdown disables it
}
```

### Errors

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError {
    #[error("git error: {0}")] Git(String),   // from git2::Error: message (class/code)
    #[error("not a git repository: {0}")] NotARepo(String),
    #[error("name conflict: {0}")] NameConflict(String),
    #[error("not found: {0}")] NotFound(String),
    #[error("forbidden: {0}")] Forbidden(String),
    #[error("io: {0}")] Io(String),
    #[error("invalid: {0}")] Invalid(String), // input the user can fix (a script without a name)
}
```

`invoke` rejects with `{ code: string; message: string }`.

### Frontend state

- `state/data.ts`: `config`, `scan` (by repo id), `scannedOnce`, `repoVersion[repoId]` (bumped on
  each `repo-updated`), `configVersion`. Scan records of repos no longer in the config are ignored.
  `openApps`: the installed apps for the open items, loaded with the config and
  again on every window focus (an app installed meanwhile appears) and when the terminal
  settings change. `terminalOptions`: the install state of Terminal/iTerm2/WezTerm for the
  Settings dropdown, loaded the same way.
- `state/nav.ts`: history router (`stack`, `index`; `push`, `replace`, `back`, `forward`). Routes:
  `branches` (optional `focusRepoId`), `project` (`projectId`, `'draft'` for a draft),
  `review` (`target`, `focusKey?`, `backLabel`), `settings`.
- `state/ui.ts`: sidebar visibility, Branches filter and scope, selection, draft project, palette,
  toast, add-repos sheet, open modal count.
- `useInvoke(fetcher, deps, { repoIds?, onConfig?, enabled? })`: refetches when deps change, when
  one of `repoIds` gets a `repo-updated`, or on `config-changed`; keeps the old data while
  reloading (no flicker); drops out-of-order and post-unmount responses.
- `src/lib/events.ts` is the only place backend events are listened to. It subscribes first,
  then loads the config and the scan (so nothing emitted in between is lost), rescans on window
  focus, and handles `open-settings`.

---

## 9. Tauri commands and events

All commands live in `src-tauri/src/commands.rs` as `async fn`, run git and disk work on
`spawn_blocking`, and return `Result<T, AppError>`. Typed wrappers are in `src/lib/ipc.ts`.

| Command | Arguments | Returns |
|---|---|---|
| `get_config` | – | `Config` |
| `inspect_folders` | `paths: string[]` | `FolderCheck[]` |
| `add_repos` | `paths: string[]` | `Config` |
| `get_scan` | – | `ScanResult` (stored result; full scan if none yet) |
| `rescan_all` | `force: boolean` | `ScanResult` (always scans; `force` also rereads every working tree) |
| `get_review` | `target: ReviewTarget` | `ReviewData` |
| `get_commit_changes` | `repoId, sha` | `CommitChanges` |
| `get_stash_changes` | `repoId, sha` | `StashChanges` |
| `get_history` | `repoId, rev, base: string\|null, query, limit` | `HistoryPage` (§16) |
| `get_history_refs` | `repoId` | `HistoryRefs` |
| `read_file_pair` | `repoId, worktreePath: string\|null, change: FileChange` | `FilePair` |
| `create_project` | `name, entries: EntryRef[]` | `ProjectConfig` |
| `rename_project` | `projectId, name` | `Config` |
| `delete_project` | `projectId` | `Config` |
| `add_entries` | `projectId, entries: EntryRef[]` | `Config` |
| `remove_entries` | `projectId, keys: string[]` | `Config` |
| `get_project_view` | `projectId` | `ProjectView` |
| `get_base_options` | `repoId, key` | `BaseOptions` |
| `set_branch_base` | `key, base: string\|null` | `Config` |
| `verify_ref` | `repoId, rev` | `string\|null` (full SHA) |
| `commit_exists` | `repoId, sha` | `boolean` |
| `repoint_entry` | `projectId, key, branch` | `Config` |
| `remove_repo` | `repoId` | `Config` |
| `set_repo_pinned` | `repoId, pinned` | `Config` (a pin goes after the earlier ones) |
| `locate_repo` | `repoId, path` | `Config` |
| `update_settings` | `settings: Settings` | `Config` |
| `get_open_apps` | – | `OpenApp[]` (in menu order; the terminal always, `found: false` when missing) |
| `get_terminal_options` | – | `TerminalOption[]` (Terminal/iTerm2/WezTerm with install state) |
| `open_folder` | `path, app: string` | `null` (`app`: an `OpenApp` id) |
| `save_script` | `script: ScriptConfig` | `Config` (a new id when `id` is empty; an unknown id is added back) |
| `delete_script` | `scriptId` | `Config` |
| `reorder_scripts` | `ids: string[]` | `Config` |
| `export_scripts` | `path` | `null` |
| `read_scripts_file` | `path` | `ScriptConfig[]` (ids empty) |
| `import_scripts` | `scripts: ScriptConfig[], replace: string[]` | `Config` |
| `run_script` | `script: ScriptConfig, entry: EntryRef, inputs: Record<string,string>, context: { base, project }` | `ScriptRun` (a running one for the same script and entry is returned instead of a second start) |
| `write_script_input` | `runId, data: string` | `null` |
| `stop_script` | `runId` | `null` |
| `get_script_run` | `runId` | `ScriptRun` with its buffered output and `bufferedEnd` |
| `resize_script` | `runId, cols, rows` | `null` (the run's pty) |
| `stash_push` | `entries: StashPush[]` (an `EntryRef` with `paths: string[] \| null`, `untracked`), `message: string` | `ScriptRun` (one git action for all entries, §15) |
| `stash_apply` | `repoId, index, sha, worktreePath, pop: boolean` | `ScriptRun` |
| `stash_drop` | `repoId, index, sha` | `ScriptRun` |
| `git_fetch` | `repoId` | `ScriptRun` (§15 "Sync") |
| `git_pull` | `entry: EntryRef, rebase: boolean` | `ScriptRun` |
| `git_push` | `entry: EntryRef` | `ScriptRun` |

Notes:

- Commands that affect a repo (`add_repos`, `remove_repo`, `locate_repo`, `set_branch_base`, and
  `update_settings` when the base order or threshold changed) rescan the affected repos, update
  the watch list and emit `repo-updated`.
- Project names: trimmed, not empty, unique case-insensitively (`NameConflict`). `create_project`
  and `add_entries` fill each entry's `lastKnownTip`; an entry already in the project is skipped.
- `set_branch_base` stores any ref, a Default candidate included; `null` (the Automatic row)
  removes the key from `branchBases`.
- `repoint_entry` fails if the new key is already in the project.
- `get_project_view` and project `get_review` refresh `lastKnownTip` when the tip moved or was
  seen over an hour ago, in one config write (no write when nothing changed).
- `read_file_pair`: blobs are read from the main repo (worktrees share its object DB). Either
  side over 1 MiB (checked with the blob header, not the content) → `tooLarge`, empty content.
  `binary` if the change is binary or either side has a NUL in its first 8000 bytes. Text is
  UTF-8 lossy. The right side comes from disk when `newOid` is null and the kind is not D: the
  worktree path must be one of the repo's known worktrees and the canonical file path must stay
  inside it (else `Forbidden`); symlinks show their link text; a file that just vanished is `""`.
- `update_settings` validates the base order (not empty) and threshold (1–365) and clamps
  `zoom` to 50–200.
- Open items, in `src-tauri/src/apps.rs`: a fixed list of `id`, name and bundle
  id — `cursor` Cursor `com.todesktop.230313mzl4w4u92`, `vscode` VS Code `com.microsoft.VSCode`,
  `windsurf` Windsurf `com.exafunction.windsurf`, `zed` Zed `dev.zed.Zed`, `sublime` Sublime Text
  `com.sublimetext.4`; `finder` Finder `com.apple.finder` first; terminals: Terminal `com.apple.Terminal`, iTerm2 `com.googlecode.iterm2`, WezTerm
  `com.github.wez.wezterm`, or the Other app (Settings › General), listed last with id
  `terminal`, always (with `found: false` when not installed; Automatic picks
  the first installed of iTerm2, WezTerm, Terminal). `get_open_apps` asks Launch Services for each bundle id
  (`NSWorkspace URLForApplicationWithBundleIdentifier:`), so apps outside `/Applications` are
  found too. Icons: `NSWorkspace iconForFile:` on the app's bundle, the 16pt
  representation (32px on Retina) encoded as PNG, cached per app path for the app's lifetime. `open_folder`
  accepts only an existing folder and a listed id; it opens the folder with
  `tauri-plugin-opener` (`open_path`, with the app's bundle path). No git.
  - Terminals: Terminal and iTerm2 open with `open_path`. WezTerm runs
    `<bundle>/Contents/MacOS/wezterm start --cwd <folder>`. Other: a single word or path that
    resolves to an app (name in `/Applications`, `/Applications/Utilities`,
    `/System/Applications`, `/System/Applications/Utilities`, `~/Applications`, with or without
    `.app`; an existing `.app` path; a bundle id) opens with `open_path`; anything else is a
    command: every `%` is replaced with the folder, single-quoted for the shell, and it runs as
    `$SHELL -l -c <command>` (`/bin/zsh` without `$SHELL`) with the folder as working directory,
    stdin/stdout/stderr null, not waited for (a thread reaps it). Its name is the app its first
    word names if one is found (icon too), else the first word.

| Event | Payload | When |
|---|---|---|
| `config-changed` | `Config` | every `config::update` (user actions, `lastKnownTip` refresh, font size) |
| `repo-updated` | `RepoUpdated` | after the watcher handles a change, and after a command or scan rescans a repo whose result changed |
| `open-settings` | – | Gitgel › Settings… (⌘,) |
| `open-about` | – | Gitgel › About Gitgel |
| `open-whats-new` | – | Help › What's New |
| `script-output` | `{ runId, data, end }` | output from a running script (`end`: bytes so far) |
| `script-exited` | `ScriptRun` | a script ended (exit code or signal) or could not start |

---

## 10. Git layer (git2)

### Setup and boundary

- Crate `git2`, `default-features = false`, `features = ["vendored-libgit2"]`.
- git2 is used only under `src-tauri/src/git/`. No git2 type leaks out: SHAs are hex `String`s,
  errors `AppError`, results the types in §8.
- `src-tauri/clippy.toml` turns every writing API into a compile error under `-D warnings`:
  - `std::process::Command::new` (allowed only in `apps.rs` for the terminal and in `updates.rs`
    for the relaunch after an update).
  - `git2::Repository::` `init`, `init_bare`, `init_opts`, `clone`, `clone_recurse`,
    `checkout_head`, `checkout_index`, `checkout_tree`, `set_head`, `set_head_detached`,
    `set_head_bytes`, `commit`, `commit_signed`, `branch`, `branch_from_annotated_commit`,
    `reference`, `reference_matching`, `reference_symbolic`, `reference_symbolic_matching`, `tag`,
    `tag_annotation_create`, `tag_lightweight`, `tag_delete`, `note`, `note_delete`, `stash_*`,
    `worktree`, `remote*`, `merge`, `cherrypick`, `revert`, `reset`, `reset_default`, `apply`,
    `cleanup_state`, `blob`, `blob_path`, `blob_writer`, `set_workdir`, `set_index`, `submodule`.
  - `Branch::delete/rename/set_upstream`, `Reference::delete/rename/set_target`,
    `Index::write/write_tree/write_tree_to/add_path/add_all/remove_path`,
    `Worktree::prune/lock/unlock`, `Remote::fetch/push/download`, `Odb::write`,
    `Config::set_*/remove`, `DiffOptions::update_index`, `StatusOptions::update_index`.
  - Types: `build::CheckoutBuilder`, `build::RepoBuilder`, `build::TreeUpdateBuilder`,
    `TreeBuilder`, `Rebase`.
  - The only exception is `git/testutil.rs` (`#[cfg(test)]`, inside its own `TempDir`).
- Writes are never made here: they are git actions (`scripts/git.rs`, §0, §15). Before one, the
  stash it names is checked here (`stash@{n}` still points at the SHA the screen showed).

### Repository pool

- One `Repository` per canonical repo or worktree path, opened with
  `Repository::open_ext(path, RepositoryOpenFlags::NO_SEARCH, &[])`. `Repository::discover`
  (searches upwards) is used only when inspecting picked folders.
- libgit2 rereads refs and HEAD from disk on every read and refreshes the object DB when an
  object is missing, but **not the index**: call `repo.index()?.read(false)?` before any diff that
  uses it (read-only; rereads only if it changed on disk).
- `retain_existing()` drops repos whose folder is gone. Lock order when both are needed: main
  repo, then worktree. Never hold the cache lock while git2 works.

### Operations

| Operation | git2 | Note |
|---|---|---|
| Folder resolution | `Repository::discover(dir)` → `is_bare()`, `workdir()`, `commondir()`, `is_worktree()` | main root = parent of `commondir()` when it ends in `.git`, else `workdir()`; bare → not a repo |
| Default base | each `defaultBaseOrder` item: `<remote>/HEAD` → `find_reference("refs/remotes/<remote>/HEAD")?.symbolic_target()` (local branch of that name if it exists, else `origin/<name>`); otherwise a local branch, else any ref that resolves | first match wins |
| Ref check | `revparse_single(rev)?.peel_to_commit()?.id()` | error = missing |
| Local branches | `branches(Some(BranchType::Local))` → `name()`, `get().target()` | skip symbolic (`target()` None) |
| Remote branches | `branches(Some(BranchType::Remote))` → `name()` | skip `*/HEAD` and symbolic refs |
| Upstream | `find_branch(name, Local)?.upstream()?.name()` | none → `<remote>/<name>` if it resolves |
| Ancestry | `graph_descendant_of(a, b)` | a == b is not a descendant; compare ids first |
| Commit time | `find_commit(oid)?.time().seconds()` | committer time |
| Tags | `tag_names(None)` | |
| Worktrees | main: `workdir()` + `head()`; linked: `worktrees()` → `find_worktree(name)` → `validate()`, `path()` | `worktrees()` does not list the main one; failed `validate()` or missing folder = prunable, skip; unborn HEAD, skip |
| Worktree HEAD | open the worktree path from the pool → `head_detached()`, `head()` | |
| Merge-base | `merge_base(base, tip)` | `NotFound` = no common ancestor |
| Ahead | `graph_ahead_behind(tip, base)?.0` | |
| Commit list | `revwalk()`: `push(tip)`, `hide(base)`, `Sort::TOPOLOGICAL \| Sort::TIME`, first 200 | |
| Committed diff | `diff_tree_to_tree(from, to)` + `find_similar` | |
| Commit diff | `diff_tree_to_tree(first parent tree or None, commit tree)` + `find_similar` | root commit: empty tree |
| Working-tree diff | on the worktree's repo: `diff_tree_to_workdir_with_index(tree)` + `find_similar` | Uncommitted: HEAD tree; All: merge-base tree, limited to paths that can differ |
| Line counts | `Patch::from_diff(&diff, i)?` → `line_stats()` | `None` = binary or no content change |
| Blob size / content | `odb()?.read_header(oid)?.0` / `find_blob(oid)?.content()` | |
| Commit exists | `find_commit(oid).is_ok()` | |
| Stash stack | `find_reference("refs/stash")`, then `reflog("refs/stash")` → `id_new()`, `message_bytes()`, `committer().when()` | index 0 = `stash@{0}`; not `stash_foreach` (needs `&mut`) |
| Stash changes | `diff_tree_to_tree(first parent tree, stash tree)` + `find_similar`, plus `diff_tree_to_tree(None, third parent tree)` as `U` | the third parent holds the untracked files (`-u`) |
| Ignore check | `is_path_ignored(rel)` from the path's top-most ancestor down | watcher filter |

### Diff options

```rust
let mut opts = DiffOptions::new();
opts.context_lines(0)             // only counts are needed; cheaper patches
    .include_typechange(true)
    .ignore_submodules(true);
// working-tree diffs also:
opts.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
// NEVER opts.update_index(true): it writes the index (banned in clippy.toml)

let mut find = DiffFindOptions::new();
find.renames(true);
diff.find_similar(Some(&mut find))?;
```

Ignored files stay out (never `include_ignored`).

### Delta → `FileChange`

- `status()` → kind: Added → A; Modified, Typechange, Conflicted → M; Renamed → R (`oldPath` =
  old path); Copied → A (`oldPath` set); Deleted → D; Untracked → U; Unmodified, Ignored,
  Unreadable → skipped.
- `path` = new path (old path for D), `to_string_lossy`.
- `oldOid` = old id unless zero. `newOid` = new id unless zero on tree diffs, **always null on
  working-tree diffs** (libgit2 may hash the disk content, but that blob is not in the object DB;
  the right side is read from disk).
- Line counts from `Patch::from_diff`; if it is `None` and the delta is binary →
  `binary: true`, counts `null`; otherwise (e.g. an empty file) `0`/`0`.

### Stacked branches (suggested base)

Read-only equivalent of `git for-each-ref refs/heads --merged=<tip> --no-merged=<default-base>`:
candidates are local branches (not the entry itself, not at the same tip) whose tip is reachable
from the entry's tip and not merged into the default base. S = commits `tip` minus `base`; each
candidate's `contains` = how many of S it contains (set membership on its own commits minus
base). Candidates with `contains > 0`, descending, are `suggested`. If the best one is not the
current base, the group gets `stackHint { branch, contains, total: |S| }`. A commit's
`fromBranch` is the first ranked candidate that contains it.

### Nearest default

Only for entries without a stored custom base, and not for the base branch itself (it keeps its
upstream comparison, §1).

1. The default order resolves to a name N and a source, as today.
2. Candidates: local `N` if it exists, and its remote-tracking twin — the configured upstream of
   local `N`, else `<remote>/N` where `<remote>` comes from the matched `<remote>/HEAD` item,
   else `origin/N` — if it resolves. One candidate: it is the base, as today.
3. For each: `merge_base(candidate, tip)`; `NotFound` → unrelated, dropped (shown disabled in
   the menu). Both unrelated → `base_missing` ("no common ancestor"), as today.
4. Both related, merge-bases mbL and mbR:
   - mbL == mbR → the configured default (the ref N resolved to: local if it exists).
   - mbR descends from mbL → remote; mbL descends from mbR → local (the newer merge-base gives
     the smaller, correct diff).
   - Diverged (neither descends): fewer `ahead` (`graph_ahead_behind(tip, candidate).0`) wins;
     a tie → the configured default.
5. The picked ref is the entry's `base` everywhere: stats, commit list, merged state, squash
   detection, Review. Put the rule in a pure function (`pick_default(local, remote,
   configured)` over merge-base relations and ahead counts) with unit tests; the git2 part only
   gathers its inputs.
6. Cache the pick with the committed stats, keyed `(repo, tip, local tip, remote tip)`; the
   per-repo merged-state walk runs once per candidate that some entry uses.

### Change watching

No polling. The backend watches the file system, recomputes what changed and pushes the result.

- `notify-debouncer-full` (FSEvents), 300 ms debounce; use its `notify` re-export. No file-ID
  cache (`NoCache`): it only pairs up renames, which we do not need, and it would walk every
  watched folder into memory.
- **Watched roots** (recursive, canonical; FSEvents reports real paths such as `/private/…`):
  each repo's git dir (`commondir()`), and every worktree folder (main and linked, anywhere under
  home). A root inside another watched root is not watched separately; missing paths are skipped.
- **Classification** by the longest matching root:

  | Path under a git dir | Change |
  |---|---|
  | `HEAD`, `packed-refs`, `refs/**` | `Refs` |
  | `logs/refs/stash` | `Refs` (dropping a stash below the top only rewrites it) |
  | `index` | `Worktree` (main worktree) |
  | `worktrees/<name>/HEAD` | `Refs` |
  | `worktrees/<name>/index` | `Worktree` (that worktree) |
  | adding/removing `worktrees/<name>` | `Refs` (worktree list changed) |
  | anything else (`objects/`, other `logs/`, `*.lock`, `FETCH_HEAD`, …) | ignored |

  Under a worktree root, the `.git` file is ignored and everything else is `Worktree` after the
  `.gitignore` filter (checked from the top-most ancestor down and cached per batch, so thousands
  of events under `node_modules/` cost one check).
- **Work:** the debouncer callback only forwards to a channel. One worker thread waits, drains
  every queued batch, reduces them to a set of `(repo, kind, worktree)` jobs (a `Refs` job for a
  repo absorbs its `Worktree` jobs) and runs them:
  - `Refs` → rescan that repo (unmoved branches come from the cache); update the watch list if
    the worktree list changed.
  - `Worktree` → drop that worktree's cached state, recompute its uncommitted count and update the
    entry in the stored scan (including `merged`/`ok` transitions).
  - Then `repo-updated`. Each round is logged with its jobs and timings.
- `sync_watches` diffs the desired roots against the current ones; it runs at startup, after full
  scans, after rescans that changed the worktree list, and after adding, removing or locating a
  repo. A failed `watch` is logged; that root then relies on focus and refresh rescans.

### Caches

`src-tauri/src/cache.rs`; a result is reused as long as its inputs did not move:

- **Committed stats** (merge-base, ahead, files, add/del, squash-merged) per
  `(repo, tip, base tip)`; the nearest-default pick per `(repo, tip, local tip, remote tip)`.
- **Committed detail** for Review (committed files, commits with `fromBranch`, stack candidates)
  per `(repo, tip, base tip)`.
- **Merged state** per repo: which branch tips are reachable from the default base, from one
  time-ordered history walk instead of an ancestry check per branch; when the base moves forward
  only its new commits are walked.
- **Working-tree state** per worktree folder, valid while its HEAD is unchanged and the watcher
  reports nothing in it: uncommitted count, the HEAD ↔ working tree list, and the merge-base ↔
  working tree list per merge-base (computed only on the paths the committed and uncommitted
  lists touch). The refresh button clears it; window focus does not.
- **Commit changes** per `(repo, sha)`, kept until the repo is removed (commits never change).
- **Stash changes** per `(repo, stash sha)`; a scan drops the ones no longer on the stack.
- After a repo scan, entries for tips no branch has any more are pruned; past 5000 entries the
  cache is dropped.
- libgit2's own object cache (up to 256 MB across repositories) speeds a scan up but is not
  needed once the results above are stored, so every full scan ends by closing the pooled
  repositories and handing freed memory back to macOS (`src-tauri/src/memory.rs`); they reopen
  on the next request. The scan log line reports the object cache and the memory before and
  after.

---

## 11. Design reference map

| Screen | File | Key lines |
|---|---|---|
| Sidebar | `Sidebar.dc.html` | top row 20–35, nav 37–48, "Projects" header 50–60, list 62–77, footer 81–92 (repo row + "+" 82–88), row and footer styles 102–123 |
| Branches | `Main.dc.html` | header 24–46 (scope selector 34–38), columns 50–52 (Diff 51), repo band 56–61, row 63–82 (checked-out icon 66–73, Diff cell 76, Projects cell 78, ⋯ button 80), row and cell styles 229–284 (row menu target 239–241, checked-out, sub and Diff values 274–282), filter logic 308–317 and 347–355, empty state 89–99, picker 101–114, new-project form 116–132, projects menu 134–150, row menu 152–163 and 337–346, toast 165–171, selection bar 172–185, drop overlay 188–195, sheet 197–221 and 360–369 |
| Review | `Diff.dc.html` | header 22–49 (traffic lights and show-sidebar hidden when `embedded` 23–32), banners 51–53 and 818–822, file list 56–133 and 438–482 (file filter 57–68, match label 81, commit chip 85–92, highlighted name and folder 101–102, no-match state 111–117), entry bar and commits 136–165 (commit stepping 144–151, list 153–164), file bar 167–234 (whitespace chip 170–172, view button and menu 174–223 with Context 195–213, change navigation 224–233), split body 236–249, unified body 250–256, base menu 263–290 (sections, Default pair, pills, disabled rows, hint), base menu data per case 695–737 (`baseCase`: stacked / behind / unrelated / remote; effective base 307–308), commit selection 404–417, filter logic 419–429, 440–444, 475 and 608–609, segmented 483–490, context and fold logic 581–596 (sample hidden lines 495–503), view values 759–782 (context 766–781), commit values 785–795, theme and `embedded` values 743–744, filter values 798–809 |
| Project | `Projects.dc.html` | header 22–43, table 47–60 and 219–230, "add related" card 62–68, empty project 72–80, deleted-branch entry menu with icons, disabled open items and note 82–101, open-item entry menu 102–116 (`openMenu`: worktree / notCheckedOut / repoMissing, 147–152; items 184–195; note and position 211–215), project menu 117–123, delete modal 126–137, rename 180–202, pills 153–162 |
| Palette | `Palette.dc.html` | dialog 25–56, row style 70–76, pills 62–69 |
| Settings | `Settings.dc.html` | section list 30 (data 231–234), Repositories 35–55 (repository `List` 38, items 296–300; Default base `List` 44 with rows, actions and add states 235–262 and 301–308; Active threshold 50–54), General 57–101 (Theme 59–78, tile builder 201–228; Terminal 79–96, options with disabled flag 263–266; Check for updates 97–99), Scripts 103–121 (`List` 117, items 309–314), Shortcuts 123–147, shortcut data and keycap style 167–198. Flow M (canvas): M1–M3 one per section (General, Repositories, Shortcuts), M4 default base hover + adding, M5 rejected name |
| Scripts | `FlowN4`, `FlowN6`, `FlowN7`, `FlowO1`, `FlowO2`, `FlowO3.dc.html`; `Main.dc.html` (`scripts`, `scriptRun`), `Settings.dc.html` (section `scripts`) | canvas flow N1–N7, O1–O3: menu group in Main's row menu data, run toast, output panel N4, Settings › Scripts list, editor N6 (popover tweak: icon / command / when), import N7, inputs O1–O2, ask O3 |
| History | `HistH1`, `HistH2`, `HistH4.dc.html` | canvas page "Review & History" (Hi1–Hi3; the canvas's Hi3 is `HistH4`): Hi1 Branches with the base branch rows (base row 43–55, data 90–99) and a row menu with "Open history" (100–105; the base row has "Open review" there, 76–78); Hi2 History of a checked-out `main` (header 21–42: branch button, search, sync group, ⋮; list 44–99: day label 48–50, base line 51–56, Uncommitted row 57–65, commit row 66–74, file row 75–84, stash section 86–98; commit header 101–110; file bar 111–124; split diff 125+; avatar and row styles 151–175); `HistH4` the same screen for a feature branch with the base line (data 179–197) |
| Stashes | `FlowP1`–`FlowP7.dc.html` | canvas flow P: P1 Branches stash list (`List` with heading, `stashes…` data, menu), P2 project review with the stash section and a picked stash, P3 stash review from Branches, P4 Stash dialog (entries with their files to pick), P5 worktree submenu beside Apply to, P6 Drop confirmation, P7 a merge conflict after Apply (C file, pill, banner) |
| Sync | `HistH4`, `WipW4c.dc.html` | `HistH4` (Hi3): History header with Fetch / Pull / Push; canvas page "Git Action Flows (WIP)": W4c Review with the branch menu's Sync group, group line 2 `origin ↑2 ↓1`, entry bar and upstream line |
| Review, sidebar open | `ReviewSidebar.dc.html` | Sidebar + `Diff` with `embedded` (width 1020, file list 280, no traffic lights / show-sidebar) |
| Themes | every file above except Projects and Palette | `.theme-dark` / `.theme-light` token classes in each file's `<style>` (e.g. `Diff.dc.html` 16–17); the root gets `class="theme-…"` from its `theme` prop (`Settings` derives it from `appearance`). Canvas page "Light mode": L1 Branches, L2 Review with sidebar (and its dark twin), L3 Settings. Projects and Palette still use hex; theme them with the same mapping |

Icons (copy into `src/components/icons.tsx`): sidebar toggle `Sidebar.dc.html:27`; back / forward
`:30`, `:33`; plus `:40` (small, footer `:87`); branch `:45` (large `Main.dc.html:81`); search
`:54`; sort/filter `:57`; folder `:83` (folder-plus `Main.dc.html:149`); gear `:90`; refresh
`Main.dc.html:32`; chevron down `Main.dc.html:136`; close `Main.dc.html:140`; more
`Projects.dc.html:39`. Split / unified / check icons come from `Diff.dc.html`'s view menu.

---

## 12. Testing, fixtures, build and release

- **Rust unit tests** use `TestRepo` (`git/testutil.rs`): throwaway repositories in their own
  `TempDir` (commits via tree updates, branches, origin/HEAD, worktrees, detached worktrees,
  merge commits). Covered: pool, folder inspection, delta conversion, worktree listing,
  merged/squash detection and state priority, uncommitted, commit list, commit changes (rename,
  root, merge), stacked, ignore filter, config, project name rules, path safety, event
  classification and root de-duplication, zoom steps, timings.
- **Vitest:** `useInvoke`, `format.ts`, `paths.ts`, entry key, change navigation, review
  selection, Branches rows and filter, palette items, draft rows, default base parsing, project
  helpers.
- **Fixtures:** `scripts/make-fixtures.sh` builds throwaway repos in `~/gitgel-fixtures` (or
  `$GITGEL_FIXTURES`). Nearest default: a `base-cases` repo (cloned from a bare remote,
  `origin/HEAD` → `master`; local `master` has an unpushed commit and `origin/master` moved on)
  with `from-origin` (started from `origin/master` → `origin/master`), `from-local` (started
  from local `master` → `master`) and `diverged` (from local `master`, then `origin/master`
  merged in: the merge-bases diverge → `origin/master`, fewer commits ahead); its remote also has
  `origin/from-origin` (same-name row) and `origin/release/2026.09` (remote only); and a
  `base-unrelated` repo whose `origin/master` was force-pushed to an unrelated history, with
  `unrelated-origin` (→ `master`, the remote row disabled). That case needs its own repo because
  it rewrites `origin/master`. It uses the git CLI and writes, but only inside the folder it creates and
  marks with `.gitgel-fixtures` (it refuses to touch a folder without the marker). Ask the user
  before running it for the first time.
  - **web-app** (cloned from a bare remote so `origin/HEAD` → `main`): `session-token-refresh`
    (5 commits: edit, add, `token.ts` → `tokens.ts` rename, test, "Reformat the auth config"; a
    1600-line `src/catalog/items.ts` with 14 changes for change navigation; `src/auth/config.ts`
    with a reindented line, trailing spaces and one real change; `src/auth/scopes.ts` with
    whitespace-only changes), checked out in `wt/token-refresh` with a modified file and an
    untracked `scripts/token-debug.ts`; `feat/billing-v2` (3 commits, a binary PNG, not checked
    out); `feat/search` (started before main's last commit, then main merged in: a merge commit
    for commit review); `old-feature` (60 days old, unmerged); `merged-ff` (fast-forwarded);
    `squashed` (squash-merged). Stashes: `stash@{0}` "debug logging for refresh" on
    `session-token-refresh`, `stash@{1}` a WIP one with an untracked file on `old-login` (deleted).
  - **api-server** (default `master`, no origin): `feat/job-queue` (3 commits),
    `token-rotation-job` (stacked on it, checked out in `wt/token-rotation` with a change),
    a detached worktree `wt/detached` at `feat/job-queue~1`, `to-be-deleted`. `master` has a
    modified `src/config/schedule.ts` and an untracked `notes/todo.md` (Stash on the base
    branch). Stashes: `stash@{0}` "worker draft" on `master` (adds `src/queue/worker.ts`: applies
    cleanly to master, conflicts in `wt/detached` and `wt/token-rotation`); `stash@{1}` a WIP one
    with 2 files on `token-rotation-job`, whose apply git refuses there (its worktree has
    uncommitted changes to `rotate-tokens.ts`, which the stash also changes).
  - `not-a-repo/`.
  - Subcommands: `delete-branch` (deletes `to-be-deleted`), `remove-repo` / `restore-repo` (moves
    web-app away and back).
- **Performance targets:** first scan < 3 s; a file change reaches the screen in < 1 s (300 ms
  debounce included); a full rescan with nothing changed < 300 ms; switching files in Review is
  instant; an event storm (hundreds of files) is merged into a few jobs without freezing the UI.
- **Read-only audit:** `grep -rn "Command::new" src-tauri/src` finds only `apps.rs` and
  `updates.rs`; git2 appears only under
  `src-tauri/src/git/`; `disallowed` only in `git/testutil.rs`; clippy passes; after using the app
  on the fixtures (with file edits, focus changes and refreshes, but no git action),
  `find ~/gitgel-fixtures -path '*/.git/*' -newer <marker>` is empty.
- **Build:** `pnpm tauri build --bundles app` → `src-tauri/target/release/bundle/macos/Gitgel.app`,
  ad-hoc signed (`bundle.macOS.signingIdentity: "-"`), not notarized; only `pnpm release` signs
  with Developer ID (below). The version comes from `package.json`.
- **Release:** `pnpm release` (`scripts/release.sh`) needs a clean, pushed working tree and a
  clean, pushed Homebrew tap clone at `../homebrew-tap` (or `$GITGEL_TAP_DIR`), on an arm64 Mac.
  It builds, zips with `ditto` (`Gitgel-<version>-macos-arm64.zip`) and uploads the zip to this
  repo's GitHub release `<version>` (no `v`; created on first run). The code repo is private, so it
  also uploads the zip to the public `gokberkakdeniz/homebrew-tap` release `gitgel-<version>`, then
  updates `version` and `sha256` in the tap's `Casks/gitgel.rb`, commits and pushes. After new
  commits, bump the version first. It also builds the signed update (below) and needs its key.
- **Signing:** `release.sh` signs with the "Developer ID Application" certificate in the login
  keychain (passed as `--config` `signingIdentity` and `APPLE_SIGNING_IDENTITY`; hardened
  runtime, no entitlements) and has Tauri notarize and staple the app with an App Store Connect
  API key (`APPLE_API_KEY_PATH` / `APPLE_API_KEY` / `APPLE_API_ISSUER`): the `.p8` file
  `~/.private_keys/AuthKey_<key id>.p8` (or `$GITGEL_NOTARY_KEY`), the key id from its name, the
  issuer id in `release.sh` (or `$GITGEL_NOTARY_ISSUER`). Only the key's path reaches
  `notarytool`'s command line, never a password. It stops before building when either is
  missing, and before uploading unless `codesign --verify --deep --strict`, `stapler validate`
  and `spctl --assess` pass.
- **Release notes:** `CHANGELOG.md` holds one `## <version> — YYYY-MM-DD`
  section per release, newest first, with `### New`, `### Improved` and `### Fixed` groups of
  `- ` lines in the user's terms (empty groups left out). Claude writes the section when a
  release is asked for: it reads the commits since the previous `chore: release v…` commit, keeps
  only what a user would notice (no refactors, design canvas, docs, tests or tooling) and puts
  it in the same commit as the version bump (`chore: release v<version>`). `release.sh` stops
  when the version has no section; it uses the section as the GitHub release notes (above the
  install note) and puts the sections of the last 10 versions, as Markdown, in `latest.json`'s
  `notes`, so an app several versions behind still sees what it skips.
- **Updates:** the release build also makes `Gitgel.app.tar.gz` and its minisign signature
  (`createUpdaterArtifacts`, passed with `--config` only by `release.sh`, so a plain build needs
  no key; key `~/.tauri/gitgel.key` or `$GITGEL_UPDATER_KEY`, public key in `tauri.conf.json`).
  It is uploaded as `Gitgel-<version>-macos-arm64.app.tar.gz` next to the zip in the tap release,
  and `gitgel/latest.json` in the tap (`version`, `pub_date`, `notes`,
  `platforms.darwin-aarch64` url + signature) is committed with the cask. The app reads it from
  `raw.githubusercontent.com/gokberkakdeniz/homebrew-tap/master/gitgel/latest.json`; the cask
  has `auto_updates true`, so `brew upgrade` leaves a self-updating app alone. Only release
  builds install; a lost key means existing installs can no longer update in-app (a new key
  ships with a `brew upgrade`).
- **Install:** `brew install --cask gokberkakdeniz/tap/gitgel` (Apple silicon). The app is
  notarized, so it opens without removing the quarantine flag.
- macOS asks for access to repositories in protected folders (`~/Desktop`, `~/Documents`); the
  first scan waits until the user answers.

---

## 13. Later (not planned yet)

- **Open in editor:** open a worktree file with `cursor://file/<path>:<line>` or
  `vscode://file/<path>:<line>`.
- **Go to definition:** search-based navigation over git blobs with tree-sitter (no checkout);
  Monaco `registerDefinitionProvider` + `registerEditorOpener`.
- **Renamed branch detection:** the reflog's "Branch: renamed …" entry (`repo.reflog(...)`), or
  local branches whose tip equals an entry's `lastKnownTip`.
- **Intel builds:** the release and cask are arm64 only.

---

## 14. Scripts

The user's own items in the branch menus: each runs a shell command for that branch. Canvas flow
N (N1–N7) and O (O1–O3); boards `FlowN4`, `FlowN6`, `FlowN7`, `FlowO1`, `FlowO2`, `FlowO3.dc.html`.

### Decisions

- A script is a **shell command** (bash/zsh, or any file with a shebang), not a JS API: the jobs
  people want are shell jobs (`gh pr create`, `pnpm test`, `git rebase`), and the context goes in
  environment variables. git2 still writes nothing; a script is the user's own process, started
  only by a click. Gitgel's own writes (§15) reuse the same runner as git actions (§0).
- One branch at a time: no script in the selection bar, no per-script shortcuts (user decisions
  2026-10-04).
- When a script exits, the repo it ran in is rescanned (as after `set_branch_base`), which also
  catches what the watcher ignores (`.git/config`, `info/exclude`, dropped FSEvents) (user
  decision 2026-10-04).

### Definition

```ts
export interface ScriptInput {
  id: string;            // A–Z, 0–9, _; unique in the script; env GITGEL_INPUT_<ID>
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'select' | 'branch';
  default: string;       // checkbox: '1' or ''
  options: string[];     // select only
  required: boolean;
  when: string;          // CEL; '' = always shown
}
export interface ScriptConfig {
  id: string;            // "s_" + 8 hex
  name: string;          // {branch}, {base}, {repo} are filled in on the menu
  icon: IconName;        // the Icon set (Icons page, src/components/icons.tsx)
  command: string;
  inputs: ScriptInput[];
  runsIn: 'worktree' | 'repo';         // the branch's worktree folder, or the repository folder
  showIn: ('branches' | 'project')[];  // Branches row menu, Project entry menu
  when: string;          // CEL; '' = always shown
  openOutput: boolean;   // "Open the output panel automatically"
  askFirst: boolean;     // "Ask before running"
  disabled: boolean;     // turned off in Settings › Scripts: in no menu
}
export interface ScriptRun {
  runId: string;
  scriptId: string;
  name: string;          // filled-in name
  icon: string;
  entryKey: string;
  repoLabel: string;     // "web-app / session-token-refresh"
  repoId: string;
  folder: string;
  status: 'running' | 'exited' | 'failed';  // failed: could not start (lastLine says why)
  exitCode: number | null;                  // null when a signal ended it
  signal: string | null;                    // e.g. "SIGINT"
  stopped: boolean;                         // Stop was asked for
  startedAt: string; endedAt: string | null;
  lastLine: string;      // last non-empty output line, terminal escapes removed
  buffered?: string;     // get_script_run only: the output so far (at most 2 MB, oldest dropped)
}
```

### Show when (CEL)

- `when` is a CEL expression the user writes; empty shows the script always. Fields:
  `branch.name`, `branch.repo` (repo name), `branch.base`, `branch.checkedOut`, `branch.detached`,
  `branch.uncommitted` (int), `branch.ahead`, `branch.behind`, `branch.merged`, `branch.project`
  (Project entry menu only; test with `has(branch.project)`), `branch.menu`
  (`'branches' | 'project'`); an input's `when` also sees the inputs before it as
  `inputs.<id in lower case>` (a checkbox as a bool, the others as strings).
- Evaluated in the frontend (`src/scripts/when.ts`, `@marcbachmann/cel-js`) from the entry
  summary, when the menu opens; no process starts. Conditions are type-checked; one that does not
  give a bool is an error ("Must be true or false, not int").
- A `when` that is false or fails hides the script. An unknown field is an error in the editor
  ("No such field: branch.checkedOt (did you mean checkedOut?)"), and the script cannot be saved.

### In the branch menus (N1–N3)

- After the open items: divider, section label "Scripts", then each script that is not turned
  off, whose `showIn` has this menu and whose `when` matches, in the Settings order, with its icon
  and filled-in name. No group (and no "Scripts" label) when none is left.
- Scripts that cannot run are left out, not shown disabled: every script when the repo is
  missing, and `runsIn: 'worktree'` scripts when the branch is not checked out; the menu's closing
  note (§6 open items) covers them: "Not checked out".
- A pick: inputs or `askFirst` → the run dialog (O); otherwise it runs at once. With `openOutput`
  its output panel opens as it starts. A script already running for that entry is not started
  twice: its output panel opens instead.
- Every run shows a toast. While running: spinner, "Running “<name>”…", mono `repo / branch` sub
  line; it stays until the run ends. Then ✓ "“<name>” finished" or ✕ "“<name>” failed · exit
  <code>" (or "· stopped") with the last output line as the sub line (`repo / branch` when there
  is none). Clicking the toast opens the run's output panel. While that panel is open the run has
  no toast (the panel's pill says the same); closing the panel while it still runs brings the
  running toast back, closing it after the end shows none. One toast at a time: a newer one
  replaces it. Its ✕ dismisses the toast only; the script keeps running.
- Quitting (⌘Q or closing the window) with scripts running asks first in a native dialog:
  "2 scripts are running. Quit anyway?" (Quit / Cancel); Quit stops them.

### Running (`scripts.rs`)

- `$SHELL -l -c <command>` (`/bin/zsh` without `$SHELL`) in the worktree folder or the repository
  folder. Environment: `GITGEL_BRANCH` (empty when detached), `GITGEL_BASE` (the base in use),
  `GITGEL_WORKTREE` (empty when not checked out), `GITGEL_REPO` (repository folder),
  `GITGEL_REPO_NAME`, `GITGEL_PROJECT` (Project entry menu only), `GITGEL_HEAD` (tip SHA),
  `GITGEL_INPUT_<ID>` for each shown input (hidden inputs are not set). Values are never pasted
  into the command, so they cannot inject shell.
- Every script runs in a pty (`portable-pty`, `TERM=xterm-256color`), so tools see a terminal:
  colours, progress bars and prompts work. A script that asks a question waits for an answer in
  its output panel (the toast stays on running; a click opens it). Output streams as `script-output`; the backend keeps
  the last 2 MB per run, so a reopened panel shows it all. Finished runs are kept until the app
  quits (at most 20; the oldest go first).
- Stop: SIGINT to the process group, SIGKILL after 3 s if it is still running. A script is the
  session leader in its pty.
- The worktree is found from the repository's worktree list (git2), never taken from the
  frontend; a worktree script on a branch that is not checked out is refused (`invalid`).
- On exit: `script-exited`, then the repo is rescanned (`repo-updated` if the result changed).
- Logged: start, exit code and duration per run (`log::info!`), never the output or the inputs.

### Output panel (N4)

- A 760 × 520 modal: header with a 28px icon tile, the name (14px 600) and a mono sub line
  `repo / branch · folder` (one line, ellipsis; the folder as tooltip), a mono pill (running:
  `running · m:ss`, neutral; exited: `exit N · m:ss`, success for 0, danger otherwise), ✕. Body:
  the terminal (`@xterm/xterm`, pinned; JetBrains Mono 12px, 20px lines, colours from the theme
  tokens, `bg.sunken`). Footer (`ModalFooter`): while running
  Copy, Stop; when done Copy and primary "Run again" (same inputs); Close on the far left
  (`lead`). Copy is 96px wide at least and turns into ✓ "Copied" for 1.5 s; a focused output
  shows only its accent ring.
- Clicking the output focuses it; typed keys go to the script (`write_script_input`); ⌃C goes
  through the pty (SIGINT). Closing the panel does not stop the script. The pty takes the
  terminal's size (`resize_script`). The panel reads the output so far (`get_script_run`), then
  appends `script-output` chunks whose `end` is past `bufferedEnd`, so nothing shows twice.

### Run dialog: inputs and Ask before running (O1, O2)

- A 600px modal: `ModalHeader` with the filled-in name and a mono sub line
  `repo / branch · <folder it runs in>`, ✕. One field per
  shown input, in order: text (36px `Input`), textarea, checkbox (`Checkbox` with the label),
  select (≤ 4 options: bordered radio `Segmented`; more: `Select`), branch (a `Select` with a
  branch icon listing the repo's local branches; mono; placeholder "Pick a branch"; read from
  disk with git2 when the dialog opens, through `get_base_options` as the "Point to another
  branch…" picker does; no fetch, so a branch only on the remote is not listed). The command is
  not shown (the user saw it when writing the script). Footer: a note only when Run is disabled
  ("Pick a branch to run"), then Cancel and primary "Run ⌘↵".
- "Ask before running" with no shown input (O3): a 460px confirmation laid out like Delete
  project: serif 22px `Run “<name>”?`, a `bg.sunken` card (radius 10, padding 12px 14px, mono
  12px) with a branch-icon row `repo / branch` and a folder-icon row with the folder it runs in
  (ellipsis; full path as tooltip), then Cancel and primary "Run ⌘↵" (focused).
- Each input's `when` is evaluated again on every change; a hidden input is not validated and not
  set. A `when` that fails keeps the field shown with the error under it. Required inputs must be
  filled for Run.
- The dialog always opens with each input's default; nothing typed is remembered. ⌘↵ runs,
  Esc cancels. With no shown input and `askFirst` off, no dialog opens.

### Settings › Scripts (N5)

- Serif 18px "Scripts" and 12px muted "Your own items in the branch menus. Each runs a shell
  command for that branch. Drag to reorder; switch one off to take it out of the menus." On the right: Import,
  Export, primary "+ New script".
- A `List` of 48px rows: drag handle, 28px icon tile, name (500), an
  on/off `Switch` (tooltip "On: shown in its menus. Switch off to hide it" /
  "Off: in no menu. Switch on to show it"), ✎ edit (opens N6), ✕ remove (at once, with an Undo
  toast).
  Dragging a row reorders (`reorder_scripts`). Empty: one muted row "No scripts yet".
- Switching off turns the script off at once (saved, no toast): it leaves every menu but keeps its
  place, command and inputs. An off row dims its icon tile (0.45), shows the
  name in `text.muted` and a small neutral "off" `Pill` after it; switching on brings it back. The
  section's count in the list counts all scripts.
- Under the card, 12px muted: "Scripts run as you, with your permissions. Gitgel itself still only
  reads the repositories."

### Editor (N6)

- 600px modal, `ModalHeader` "New script" / "Edit script" with ✕; the body scrolls when the
  window is short. Fields, top to bottom:
  - **Name** (36px `Input`) with an icon button inside on the left that opens a 6-column grid of
    18 icons from the set (play, prompt, test, pull-request, rebase, link, upload, download,
    refresh, undo, code, package, rocket, bug, search, copy, folder, bolt; picked: accent
    outline), and a "+ Variable" menu on the right inserting `{branch}`, `{base}` or `{repo}` at
    the cursor. Hint: "{branch}, {base} and {repo} in the name are filled in on the menu."
  - **Command** (mono textarea, "Runs in your login shell"; grows with the command up to 360px,
    then scrolls; its corner handle drags it taller, and it never shrinks below that),
    "+ Variable" menu inserting `$GITGEL_…` names (with a short note each, inputs included) at the
    cursor.
  - **Inputs** (card): rows with drag handle, chevron, type chip, label, `$GITGEL_INPUT_<ID>`,
    a "when" pill if set, ✕. Expanded: Label, ID (upper-cased as typed), Type (`Select`), Default
    (a checkbox input: a "Checked" checkbox), Options (select:
    one per line, "4 or fewer show as buttons"), Show when (a mono textarea like Options, "Can use
    branch and the inputs above", with its live result and a "+ Variable" menu of the branch
    fields and the inputs above it as `inputs.<id>` with their types), Required. "+ Add input".
  - **Runs in** (radio: Worktree folder "Hidden when the branch is not checked out" /
    Repository folder "Always available") and **Show in** (checkboxes: Branches row menu,
    Project entry menu) side by side.
  - **Show when** (mono textarea, "+ Variable" listing the fields with their types), with the
    live result under it: ✓ "Shows for N of M branches: <names>" / ✕ the error (danger; the
    field turns invalid) / "Always shown".
  - **Open the output panel automatically** (`Checkbox` card): "Every run shows a toast; click it
    for the output, to answer prompts or to stop the script. Turn this on to open the output as
    soon as it starts (long jobs, scripts that ask questions)."
  - **Ask before running** (`Checkbox` card): "Opens the run dialog first, even without inputs,
    so nothing runs on one click. Turn it on for scripts that change the branch (rebase, push,
    reset)."
  - Footer: Cancel, primary "Save script". Save needs a name, a command, at least one
    menu under Show in, unique valid input ids and no `when` error; the footer note says what is
    missing.

### Import and export (N7)

- Export: native save panel, one file `gitgel-scripts.json`: `{"version": 1, "scripts": [...]}`
  (no ids, no paths of this machine). An off script is exported with `"disabled": true` and
  imported off.
- Import: native open panel, then the preview modal: `ModalHeader` "Import scripts" with the
  mono file path and count; a card with one row per script: `Checkbox`, icon tile, name with a
  "new" (accent) or "same name exists" (warning) `Pill`, the full command in mono, a 12px meta
  line (runs in · menus, then "Opens the output" when `openOutput`); a conflicting row has Replace / Keep both / Skip (bordered
  radio `Segmented`). A warning note: "Scripts run as you, with your permissions. Read each
  command before importing. Imported scripts ask before running; you can turn that off per
  script." Footer: "N of M selected", Cancel, primary "Import N scripts". Imported scripts get
  `askFirst: true`; "Keep both" adds " (2)" to the name.
- Teams share a file by keeping it in the repo; everyone imports it. There is no "trust this
  repo" flow.

---

## 15. Stashes

The stash stack is listed and reviewed with git2; stashing, applying, popping and dropping are git
actions (§0, "Writing stashes" below). Canvas flow P (P1–P7); boards `FlowP1`–`FlowP7.dc.html`.

- **Reading** (§10): the `refs/stash` reflog, newest first. The message `On <branch>: <text>`
  shows `<text>`; `WIP on <branch>: <sha> <subject>` shows whole. `<branch>` is the branch it was
  taken on (`(no branch)` = detached HEAD); a branch that no longer exists is "deleted". A
  stash's changes are its tree against its first parent (the commit it was taken on), staged and
  unstaged together, plus its untracked files (the third parent, `stash push -u`) as `U`; both
  sides are read from the object database (`read_file_pair` with `worktreePath` null). Every scan
  lists the stack with each stash's file count (cached per stash).
- **Branches** (P1): under a repo band's rows (only while the band has rows), a `List` with the
  heading "Stashes" and its count (collapsible; remembered per repo in `localStorage`,
  `gitgel.branches.collapsedStashes`, and open while filtering), padding 8px 16px 14px 52px (8px at the bottom
  while collapsed, as at the top), bottom border `border.row`. Rows: lead `package` icon, prefix `stash@{n}`, the message; sub line: the branch
  as an `accent` sm Pill (`<branch> · deleted` as `outline`; `detached HEAD` as `outline`),
  `N files`, the age. The text filter applies (message, branch, repo name). Clicking a row opens
  the stash review (P3) on it; the ⋮ button ("Stash options") opens a 280px menu: "Review
  changes ↵", "Apply to", "Pop to" (no second line; a chevron on the right), divider,
  danger "Drop" (`⌫`). Apply to and Pop to open the worktree picker (P5) beside the item on
  hover or click (→ from the keyboard, ← back), Drop opens the confirmation (P6). Popovers follow
  their anchor when the page scrolls or resizes (scroll listener and `ResizeObserver`).
- **Page menu** (Review, project and branch scope; History of a checked-out branch too, §16,
  which also lists the branch's stashes under its commits): "Stash" (`package`) first in
  the ⋮ menu; it opens the Stash changes dialog (P4) under the ⋮ button. Left out while no
  checked-out entry has uncommitted changes; disabled, tooltip "Resolve the merge conflicts first;
  git cannot stash them", while every entry with changes has conflicts.
- **Review list** (P2): after the groups (and the "not reviewable" line), under a 1px `bg.hover`
  rule: section label `Stashes of this project · N` (branch scope `Stashes of this branch · N`),
  the stashes taken on one of the review's branches (project order). Rows (padding 6px 8px,
  radius 8, hover `bg.sunken`): 13px `package` icon (muted; `accent.text` when picked), 13px
  `text.strong` message (line-height 18px, up to two lines, then ellipsis; the icon and
  `stash@{n}` sit on its first line), mono 11 muted `stash@{n}`; line 2 (indent 21) mono 11 muted
  `<repo> / <branch> · N files · <age>` (`<branch> (deleted)`, `detached HEAD`). Picking one lists
  its files under it (file rows as in a group) and opens its first file; the right pane shows
  it. Picking an entry's file, switching mode or typing in the file filter leaves the stash; the
  section is hidden while filtering.
- **Stash pane:** an entry bar of two lines (P3): 15px/600 `text.strong` message (one line,
  ellipsis, tooltip the whole message) with the buttons on the right; under it a mono 11 muted
  meta line, gap 8, faint `·` between: 12px `package` icon and `stash@{n}` in `accent.text`,
  `<repo> / <branch>` (the part that gives way when short of room), `from <short base>`,
  `<age> ago`. Then the file bar (compare label
  `<short base> ↔ stash@{n}`, view menu, change navigation over the stash's files) and the diff.
  On the right of the message 28px buttons Apply, Pop (secondary) and Drop (danger text): Apply
  and Pop run at once in the worktree the stash's branch is checked out in (tooltip `Apply to
  <branch> (<~folder>)`), and open the worktree picker (P5) under the button only when that
  branch is not checked out (or deleted, or detached); Drop opens the confirmation (P6). No
  uncommitted banner while a stash is shown.
- **Stash review** (P3, `ReviewTarget` `stashes`): from Branches; title "Stashes", subtitle
  `<repo> · N stashes`; no mode segmented and no file filter; the list is the section only
  (`Stashes in <repo> · N`, no rule above, line 2 without the repo), with the clicked stash
  picked (else the newest; also when the picked one is dropped). Empty stack: "No stashes".

### Writing stashes

Every write is a git action (§0): a run on the scripts' runner (§14 "Running": `$SHELL -l -c`, a
pty, `TERM=xterm-256color`) whose command is fixed by Gitgel; values are only in `GITGEL_*`
variables, quoted (`"$GITGEL_MESSAGE"`), and the stash as `'stash@{n}'`, so the command reads the
same in sh, bash, zsh and fish. It has the run toast and output panel of a script (name and
`package` icon below; no "Run again"), and its repositories are rescanned when it ends.

- **Checks before running** (backend): the folders come from the repository's worktree list
  (git2), never from the frontend; `stash@{n}` must still point at the SHA the screen showed,
  else "The stash list changed. Pick the stash again." (and the repo is rescanned); one git
  action at a time per repository, else "Another git action is running in <repo>." A refused
  action shows a failed toast `“<name>” could not start` with that text.
- **Stash changes** (P4, "Stash" in the page menu of Review and History): a 420px popover under the
  button, padding 16, gap 12: serif 18px "Stash changes"; "In" (12px/500) and one group per entry
  of the review that is checked out, in review order. The entry row (26px): a `Checkbox` (on when
  every file is picked, mixed with a dash when some are, off with none; a click picks all or
  none), repo 12px/600 `text.strong`, mono 11 branch, then on the right a 22px button `N files ›`
  (`k of N files` when only some are picked; chevron down while open; tooltip "Pick files" /
  "Hide files") that shows the entry's uncommitted files under it; "no changes" and disabled when
  it has none; with merge conflicts, disabled with a danger `N conflicts` (tooltip "Resolve its
  merge conflicts first; git cannot stash them."), as git refuses to stash then. File rows (26px, indent 24): `Checkbox`, kind badge, mono 12 `text.strong` name,
  mono 11 `text.faint` folder as in Review (`· untracked`, `← old path`). Every file starts
  picked; the files of a review with one entry start shown. Entries that are not checked out are
  not listed. "Message" `Input` 32px, focused (empty: git writes its own "WIP on <branch>: …"). A
  12px muted note: "One stash per entry, same message." plus, for each repo with 2+ entries with
  files picked, "Both are in <repo>, so its stack gets 2 new stashes." (3+: "N are in <repo>, so
  its stack gets N new stashes."). Footer: Cancel and primary "Stash N entries ↵" ("Stash 1 entry
  ↵"; N = entries with a file picked), disabled with none. ↵ stashes, Esc cancels.
  One git action "Stash changes" for those entries, one after another, stopping at the first
  failure: `git -C "$GITGEL_FOLDER_1" stash push [--include-untracked] [--message
  "$GITGEL_MESSAGE"] [-- "$GITGEL_PATH_1_1" …] && git -C "$GITGEL_FOLDER_2" …`, run in the first
  folder, with `GIT_LITERAL_PATHSPECS=1` (a picked name is never a glob). An entry with every file
  picked has no paths; otherwise the picked paths (a rename's old path too).
  `--include-untracked` when an untracked file is picked. git puts every staged change in a stash,
  picked or not (and leaves the unpicked ones in place too), so when files are picked and other
  files are staged (`worktrees::staged`, read with git2), the stash is made from a copy of the
  index in the temp folder without them: `env GIT_INDEX_FILE="$GITGEL_INDEX_1" git … reset -q --
  <unpicked staged>`, the same `stash push` with that variable, then `git … reset -q -- <picked>`
  on the real index; the copy is deleted when the run ends. Toast sub line `repo / branch` for one
  entry, else `N entries`.
- **Worktree picker** (P5; Apply to / Pop to in the Branches stash menu, Apply / Pop in the
  stash pane when its branch is not checked out): a 280px menu, label "Apply stash@{n} to" (or "Pop stash@{n} to"), then one item
  per checked-out entry of the repository (scan order, the branch the stash was taken on first):
  `branch` icon, the branch (short SHA when detached), desc the folder (`~/…`) plus
  ` · N uncommitted` when it has changes. A pick runs `git stash apply 'stash@{n}'` (or `pop`) in
  that folder, named "Apply stash@{n}" / "Pop stash@{n}", sub line `repo / branch`. With
  conflicts git leaves the markers in the files and keeps the stash (also for pop); the toast is
  failed with git's last line, and Gitgel does nothing more.
  When the folder has uncommitted changes to a file the stash also changes, git refuses before
  touching anything ("Your local changes to the following files would be overwritten by merge");
  that is git's own guard and is shown as is.
- **Drop** (P6; Drop in the menu or the pane): a 460px confirmation laid out like O3: serif 22px
  `Drop stash@{n}?`, a `bg.sunken` card with a `package` row (the message) and a `branch` row
  `repo / branch · N files`, 13px muted "Its changes are lost unless they are somewhere else.",
  then Cancel (focused) and danger "Drop stash". Runs `git stash drop 'stash@{n}'` in the
  repository folder, named "Drop stash@{n}". The stash review then picks the newest stash (above).

### Sync (W4a)

Fetch, Pull and Push of one branch: buttons in the History header, and a group in the branch
menus (Branches row, Project entry, Review entry). Review's header has none: it only shows where
each branch stands. Each is a git action as above (`upload` icon; toast sub line `repo / branch`,
`repo` for Fetch). Gitgel never fetches on its own, never force-pushes, and syncs one branch at a
time.

- **Upstream** (`refs::tracking`, `scan::branch_upstream`; `EntrySummary.upstream`, and
  `HistoryPage.upstream` when `rev` is a local branch): the configured upstream when it is on a
  remote (`branch.<name>.remote` / `.merge`), else the same name on the default remote (`origin`,
  else the only remote); none without a remote, for a detached HEAD, or when the branch shares no
  history with it. `ahead` / `behind` against the remote-tracking branch, as of the last fetch;
  when the remote does not have the branch (`name` null), `ahead` is the branch's commits on top
  of its base. Shown as `origin ↑2 ↓1` (`origin` when level, `not on origin · ↑3`).
- **What each can do** (`syncState`): Pull needs the remote-tracking branch, commits behind it
  and a checkout (else disabled with "Not on origin" / "Nothing to pull" / "Not checked out");
  Push needs a remote, commits ahead and none behind (else "No remote" / "Behind origin, pull
  first" / "Nothing to push"). A branch that is ahead and behind is **diverged**.
- **History header** (`HistH4`), after the search field: one 32px group (`bg.elevated`, 1px `border`,
  radius 8, padding 2, gap 2) of 26px buttons (12px, 12px icon, radius 6): "Fetch" (`download`,
  `text.muted`, tooltip `Fetch <repo> from origin · last fetch <age> ago`), a 1px divider, "Pull" (`arrow-down`, mono 11
  `↓N` when behind), "Push" (`arrow-up`, `↑N` when ahead; accent fill when it can push). Disabled
  ones carry the reason as tooltip. While a sync runs in the repository all three are disabled
  and the running one's icon spins. Diverged: a warning banner under the header, `<branch> is
  behind origin by 1 commit, so it cannot be pushed. Pull it first.`, with a 24px "Pull (rebase)"
  button when checked out.
- **Branch menus** (`WipW4c`): after the open items, a divider, then "Fetch"
  (`download`), "Pull" (`arrow-down`, hint `↓N`), "Pull (rebase)" (`rebase`; only when diverged
  and checked out), "Push" (`arrow-up`, hint `↑N`). Disabled items carry the reason as tooltip ("A sync is running"
  while one runs; Push of a branch the remote lacks: `Not on origin yet`). No group for a detached HEAD, a branch without a remote, a deleted branch or a
  missing repository.
- **Fetch**: `git fetch --all --prune` in the repository folder. Success toast `Fetched <repo>`.
- **Pull**: `git pull [--rebase] "$GITGEL_REMOTE" "$GITGEL_MERGE"` (`refs/heads/<branch on the
  remote>`) in the worktree, so a branch without a configured upstream pulls too and git's own
  `pull.rebase` / `pull.ff` settings apply. Success toast `Pulled <branch>`.
- **Push**: `git push [--set-upstream] "$GITGEL_REMOTE" "$GITGEL_REFSPEC"`
  (`refs/heads/<branch>:refs/heads/<branch on the remote>`), in the worktree when there is one
  (hooks see it), else the repository folder; `--set-upstream` only for a branch the remote does
  not have and that has no configured upstream. Success toast `Pushed <branch>`.
- **Failures**: a sync that exits non-zero opens its output panel (N4) instead of the failed toast
  (git's message, or a prompt for a password or passphrase, is there). One that cannot start shows
  the usual `“<name>” could not start` toast.

---

## 16. History

A branch's commits, newest first, each one shown on its own against its first parent, like
GitHub Desktop's History tab. Read-only: a revwalk and diffs. Canvas page "Review & History", boards
`HistH1`, `HistH2`, `HistH4.dc.html` (§11).

- **Reading** (§10, `git/history.rs`): `get_history` resolves `rev` (a local
  branch, a remote-tracking branch or a SHA) and walks from it by committer time, newest first
  (`Sort::TIME`, no topological pass, so the first page does not read the whole graph), returning
  the first `limit` commits. A page further down is the same call with a larger `limit` (the list
  asks for 200 more when scrolled near its end). `total` counts every commit reachable from the
  tip; it is cached per (repo, tip). With `base` (the entry's base) the commits not reachable from
  it are counted (`ahead`) and the rest are `inBase`. `query`: every word (the Branches filter
  rule) must appear in the subject, body, author name or email, the full SHA, or a path the
  commit changed against its first parent (read only when the text did not match); the walk goes
  on until `limit` commits match; `total` is null then. `fetchedAt`: the modification time of
  `FETCH_HEAD` in the common git dir. `get_history_refs` lists the local branches and the
  remote-tracking ones. Every call logs one line with its timings.
- **Opening:** "Open history" in a Branches row menu (not the base row's), the base branch row's name and History
  button, and in Review's entry bar the branch name and the base in "N commits ahead of <base>". Route `history` with `repoId` and `rev`, pushed like Review
  (back and forward work). History hides the sidebar as Review does.
- **Header** (`HistH2` 21–42), as Review's: title "History"; subtitle `<repo> · <rev>`, plus
  ` · <~worktree>` when `rev` is a branch checked out in a worktree. On the right, gap 10:
  - Branch button: 32px, `bg.elevated`, 1px `border`, radius 8, branch icon 13px `accent.text`,
    mono 12 `text.strong` rev, chevron (tooltip `Pick a branch of <repo>`). It opens a menu:
    label "Local", the local branches, label "Remote", the remote-tracking ones (the current one
    checked; scrolls when long). Picking one replaces the route's `rev`.
  - Search field: `Input` 32px, 200px, placeholder "Search commits", label "Search commit
    messages, SHAs and paths", no keycap; ⌘K focuses it (also listed in Shortcuts). Typing
    searches (debounced 200 ms); Esc clears it.
  - Fetch / Pull / Push (§15 "Sync"), only when `rev` is a local branch with a remote; the last
    fetch's age (`fetchedAt`) is in Fetch's tooltip.
  - The page menu (⋮, as Review's): "Stash" (§15, with this one entry; only when `rev`
    is checked out in a worktree with uncommitted changes), "Open review" (`split`, ⌥H; only
    when `rev` is an active entry: its branch Review, or going back to it), "Refresh".
- **List** (`HistH2` 44–99): 380px, `bg.sidebar`, right border `border`, scrolls. Label (section
  label style, padding 14px 16px 6px) `<rev> · N commits` (`total`), while searching `N matching
  commits` (`N+` while there are more). Rows (padding 0 8px 8px, gap 2):
  - **Uncommitted changes** (when `rev` is a local branch checked out in a worktree with
    uncommitted files; never while searching): first, above the day labels. 1px dashed
    `border.strong`, radius 8, padding 7px 8px; a 24px slot with an 8px `accent.text` dot; 13px/500
    `accent.text` "Uncommitted changes"; mono 11 muted `N files · <age>` (plus ` · N conflicts`
    after the files when some are unmerged; the age of the newest
    uncommitted file, as on Branches; left out when unknown). Picking it lists its files under it
    and shows HEAD ↔ working tree (untracked files included), as Review's Uncommitted layer.
  - **Day labels**: 11px `text.faint`, padding 10px 8px 4px: "Today", "Yesterday", else `Oct 2`
    (this year) or `Oct 2, 2025`, by committer time.
  - **Commit row** (`role="option"`, tooltip "Show this commit"): padding 7px 8px, radius 8, gap
    10; picked: `bg.hover`. A 24px avatar: the author's initials (first letters of the first two
    words, upper case), 10px/600 `text.strong` on `bg.pressed`; an author whose name contains
    `[bot]` gets "BOT" in `text.muted` on `bg.band` with a 1px dashed `border.strong`. Then 13px
    `text.strong` subject (ellipsis) with an outline sm pill "merge" for a merge commit; line 2
    mono 11 muted `<author> · <age>` and, on the right, the short SHA in `accent.text`. Commits
    below the base line: subject `text.muted`, row opacity 0.7.
  - **Base line** (`HistH4`): when `ahead` > 0, after the last commit not in the base: a 1px
    `border.strong` rule on both sides of mono 11 muted `base <base> · <short merge-base>`, and
    under it 11px `text.faint` `Below: already in <base>`.
  - The picked commit (or Uncommitted) lists its files under it: file rows as in Review (the
    file shown on `bg.hover`).
  - Empty: "No commits"; while searching "No commits match “<query>”" with "Clear search"; a rev
    that does not resolve: `<rev> not found`.
  - **Stashes** (`HistH2` 86–98; the stashes taken on `rev`, never while searching): Review's
    stash section (§15, "Stashes of this branch · N", rows without the repo), under the commits
    but pinned to the bottom of the list column (top border `bg.hover`, padding 2px 8px 8px, at
    most 40% of its height, scrolls on its own), since the commits keep loading as they scroll.
    Picking one lists its files under it and shows Review's stash pane (P2: message, Apply / Pop /
    Drop, meta line), then the file bar (`<short base> ↔ stash@{n}`) and the diff. ↑ / ↓ do not
    step into it; a dropped or popped stash leaves the newest commit picked.
- **Picking:** on opening, the newest commit (its first file). ↑ / ↓ in the list and ⌥⇧↑ / ⌥⇧↓
  anywhere (newer / older; past the loaded end it loads more) step through the rows,
  Uncommitted included. Clicking the picked row again folds its file list, and opens it again;
  picking another row opens its files. A row brought into view (stepping, or rows above it
  folding) keeps 8px, the list's side padding, above or below it. After a refresh the picked
  commit stays when it is still listed, else the newest is picked. Search picks the first match.
- **Pane** (`HistH2` 101–124): a commit header (padding 14px 18px, bottom border `border`, gap 8):
  15px/600 `text.strong` subject with, on the right, a 28px "Copy SHA" icon button (copy icon,
  tooltip "Copy full SHA"; ✓ and "Copied" for 1.5 s after a click); the body (13px, line-height 1.5, `text.muted`, `white-space:
  pre-wrap`, max-width 720px; left out when empty); mono 11 muted meta: an 18px avatar, the author
  (`text.body`), `·` the committer time (`today 11:42`, `yesterday 11:42`, `Oct 2, 11:42`, `Oct 2,
  2025`), `·` the short SHA (`accent.text`), `·` `parent <short>` (`root commit` without one), `·`
  `N files`, `+a` (`success`), `−d` (`danger`). For Uncommitted: "Uncommitted changes", meta
  `<~worktree> · N files +a −d`. Then Review's file bar (compare label `<parent> ↔ <sha>` or `HEAD
  ↔ working tree`, whitespace chip, view menu, change navigation over the picked row's files) and
  the diff, with Review's view settings and ⌥V / ⌥C / ⌥W / ⌥↑ / ⌥↓.
- **Refresh:** the page is fetched again when the repo is updated (`repo-updated`), keeping the
  loaded length; the Uncommitted row follows the scan.

