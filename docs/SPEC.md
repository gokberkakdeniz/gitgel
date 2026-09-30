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

- **Git only through git2 (libgit2).** The git CLI is never run; `std::process::Command` is
  banned in app code. The one exception is `src-tauri/src/apps.rs`, which starts
  the terminal the user set in Settings (WezTerm, or an Other command); it never runs git. git2 is used only under `src-tauri/src/git/`; other modules use the
  functions there and the types in §8.
- **Read-only.** The app never calls a git2 API that writes to a repository: no checkout,
  set_head, commit, stash, reset, merge, cherry-pick, revert, branch/reference/tag
  create/delete/rename, worktree add/prune/lock, index writes, blob/odb writes, fetch/push or
  config writes. `update_index` is never enabled on diff or status options. `src-tauri/clippy.toml`
  enforces this at compile time (§10).
- **pnpm only.** Never npm, npx or yarn; no `package-lock.json` or `yarn.lock`. Add packages
  with `pnpm add -E <pkg>` (`pnpm add -D -E` for dev); one-off CLIs with `pnpm dlx`.
- Versions are exact: no `^`/`~` in `package.json`, `=X.Y.Z` in `Cargo.toml`. Before adding a
  package, check it is really needed; if so install the current stable version and pin it.
- **Tauri 2**, not Tauri 1: `invoke` comes from `@tauri-apps/api/core`, the window from
  `getCurrentWindow()` (`@tauri-apps/api/window`), permissions live in
  `src-tauri/capabilities/*.json`, plugins are `tauri-plugin-*` crates and `@tauri-apps/plugin-*`
  packages. A Rust command parameter `repo_id` is sent as `repoId` from JS.
- UI copy is English and matches the reference screens exactly (singular/plural included). Code,
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

**Goal:** a read-only macOS desktop app for reviewing branches and worktrees across several git
repositories from one place, without checking anything out. Built for looking at what coding
agents (Cursor, Codex, Claude Code) leave in their worktrees. Not for the App Store: ad-hoc
signed, not notarized, no sandbox.

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
- **Active branch:** checked out in a worktree, or committed in the last N days (Settings,
  default 14) and ahead of its base (or with a base picked by hand, even when not ahead of it:
  otherwise picking a base at its own tip would hide it; user decision 2026-09-28).
- **Base branch:** the branch whose name matches the repo's default base (e.g. `main`). It is
  compared with its upstream (the configured one, else `origin/<name>`) and is listed only when it
  has unpushed commits or uncommitted changes. Without a usable upstream (none, or one with no
  common ancestor, e.g. after a force-push) only its working tree is shown; that is not "base
  missing".

**Screens:** Branches (including the first-run empty state), Project, Review, Add palette (⌘K),
Settings.

**Out of scope:** writing to repositories, review comments, GitHub/PR integration, fetch/pull,
launching agents, multiple windows, LSP, the git CLI (even as a fallback), agent labels, a light
theme, configurable refresh.

---

## 2. Architecture decisions

| Topic | Decision |
|---|---|
| Git access | **git2** (libgit2 bindings), `vendored-libgit2` (static, no system libgit2 or OpenSSL), default features (ssh/https) off. The git binary is never looked for; there is no "git not found" screen and the app works on a Mac without git. |
| Repository objects | One `git2::Repository` per repo or worktree path, kept in a pool, never reopened per request. `Repository` is not `Sync`, so each sits in its own `Mutex`. |
| Refresh | **File watching** (`notify-debouncer-full`, FSEvents, 300 ms debounce). **No polling, no timers.** An event recomputes only the affected repo or worktree; the backend pushes the result to the frontend as an event. A full rescan runs when the window gains focus and on the refresh button (which also rereads every working tree). Refresh is not configurable and no UI text mentions it. Details in §10. |
| Performance | Results are cached so that a branch whose tip and base did not move is never recomputed, and a working tree is reread only after the watcher reports a change in it (§10 "Caches"). A full scan runs repos in parallel and emits each repo as soon as it is done, only if its result changed. Every scan, review, file read and watch round logs one line with its step timings (`src-tauri/src/timing.rs`). |
| Base | Stored per branch: `branchBases["<repoId>:<branch>"]`. |
| Deleted branches | Entries keep `lastKnownTip` (SHA + when it was last seen), so a deleted branch can still show its last diff while the commit exists. |
| Review | One screen for a whole project, files grouped per entry, one mode toggle. Single-branch review is the same screen with one group. |
| Settings | Three sections in a list: General (theme, terminal, update checks), Repositories (repos, default base order, active threshold) and Shortcuts (read-only). Diff layout, context (changes only / whole file, lines around changes) and ignore-whitespace live in Review's view menu, font size in View › Font Size; all are stored in the config. |
| Config owner | Only Rust reads and writes the config. The frontend never writes files; every change is a Tauri command. |
| Config path | `~/Library/Application Support/com.gitgel.desktop/config.json` (Tauri `app_data_dir()`). |
| Logs | `tauri-plugin-log` → `~/Library/Logs/com.gitgel.desktop/Gitgel.log`, up to 3 × 2 MB. Git errors are logged with `log::warn!`. Debug level (watch rounds) only in dev builds. Every line ends with the process's memory footprint. |
| Package manager | pnpm, version pinned in `package.json` `packageManager`. |
| Frontend | React + TypeScript + Vite, state in zustand. Backend data arrives two ways: **push** (config and scan result live in a store, updated by backend events) and **request/response** (review, project view, file contents, base options, commit changes) through a small `useInvoke` hook that refetches when a related repo event arrives. No React Query. Styling: CSS Modules + CSS variables. Fuzzy search: fuse.js. |
| Diff | `@monaco-editor/react` + `monaco-editor`, bundled locally (`loader.config({ monaco })`), never from a CDN. |
| Fonts | Instrument Sans, Source Serif 4, JetBrains Mono via `@fontsource/*`, bundled. The app works offline. |
| Bundle id | `com.gitgel.desktop` (must not end in `.app`). |
| Distribution | `pnpm release` builds, zips and uploads to GitHub releases and updates the Homebrew cask and the update feed (§12). |
| Updates | `tauri-plugin-updater`, driven from Rust (`updates.rs`): the only network access. Checks the tap's `gitgel/latest.json` at launch and on window focus, at most every 6 hours; installs a signed build on request and restarts (§12 "Updates"). |

---

## 3. Project structure

```
gitgel/
├─ CLAUDE.md
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
│  ├─ state/    nav.ts  ui.ts  data.ts
│  ├─ components/                 # Button, IconButton, Pill, Checkbox, Input, Kbd, Popover,
│  │                              # Menu, Modal, Toast, Segmented, KindBadge, Banner, icons.tsx,
│  │                              # Sidebar/, BaseMenu/, ProjectPicker/, PageHeader/, ...
│  ├─ screens/  Branches/  Project/  Review/  Settings/  Palette/  AddRepos/
│  └─ monaco/   setup.ts  theme.ts  language.ts  DiffView.tsx  changeNav.ts
└─ src-tauri/
   ├─ Cargo.toml  Cargo.lock  rust-toolchain.toml  clippy.toml  tauri.conf.json  build.rs
   ├─ capabilities/default.json
   └─ src/
      ├─ main.rs  lib.rs          # lib.rs: run(), plugins, command registration
      ├─ menu.rs                  # app menu: Settings…, View › Font Size, Help items
      ├─ logs.rs                  # Help › Show Logs in Finder
      ├─ appearance.rs            # window theme and background before it is shown
      ├─ apps.rs                  # open items: installed editors/terminals, open a folder
      ├─ nearest.rs               # nearest default: local vs remote default base
      ├─ memory.rs                # frees libgit2 memory after full scans
      ├─ updates.rs               # in-app updates: check, install, restart
      ├─ error.rs  state.rs  model.rs  config.rs  cache.rs  timing.rs
      ├─ commands.rs              # every #[tauri::command] (thin wrappers)
      ├─ git/                     # the ONLY place git2 is used
      │  ├─ mod.rs                # submodules + From<git2::Error>
      │  ├─ pool.rs               # Repository pool
      │  ├─ inspect.rs            # folder resolution (flow A2)
      │  ├─ refs.rs               # branches, default base, ref checks, tags
      │  ├─ worktrees.rs          # main + linked worktrees, ignore check
      │  ├─ diff.rs               # tree/workdir/commit diffs, FileChange conversion, blobs
      │  ├─ history.rs            # merge-base, ahead, revwalk, merged state, stack candidates
      │  └─ testutil.rs           # #[cfg(test)] only: throwaway repos in a TempDir
      ├─ scan.rs                  # branch/worktree discovery, entry summaries, stored scan
      ├─ watch.rs                 # file watching, event classification, targeted recompute
      ├─ review.rs  files.rs  base.rs  projects.rs  repos.rs
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
| `focus.ring` | `0 0 0 1px #4f8fa3, 0 0 0 3px rgba(79,143,163,0.25)` | Focused inputs, active base button |
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
`rgba(160,130,230,0.16)`.

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
  screens (§11). No emoji.

### Shared components

- `Button`: `primary` (accent fill, `--on-accent` text, 600), `secondary` (`bg.elevated`, 1px
  border, `text.strong`), `ghost`, `danger` (`danger.fill`), `link` (`accent.text`); optional
  `kbd` hint on the right in mono 11px.
- `Pill`: `success | warning | danger | neutral`, 11px/500, padding 3px 10px. Neutral: `#d8d4cc`
  on `#302e2a`.
- `Input`: every text field (filters, Settings, New project name). `bg.sunken`, 1px border,
  radius 8, `size` 28 / 30 (default) / 32 / 36; focused: accent border + 2px `rgba(accent,0.2)`
  ring; `invalid`: the same in danger. `leftIcon` / `rightIcon` slots (muted, 11px: a 13px search
  icon, a `⌘K` hint, a match count); `mono` for branches, files, paths and commands;
  `clearable` (filters): while it has text it keeps the accent border and ends with an 18px round
  ✕, and Esc clears it before anything else. In-place editors (page titles, the sidebar rename)
  are not `Input`s.
- `Popover`: positioned under an anchor rect, kept inside the viewport, `bg.elevated`, radius 12,
  popover shadow; outside click and Esc close it.
- `Menu`: padding 6, items 8px 10px, radius 8, active item `bg.hover`; `danger`, `hint`, `sub`
  lines and dividers; ↑/↓ move between the enabled items. Items may carry an icon on the left:
  a 16px slot, gap 10; line icons are 14px, stroke 1.8, `text.muted` (danger
  items: `danger.text`); an item with a `sub` line keeps the icon beside its first line.
- `Modal`: scrim, `bg.elevated`, radius 16, positioned from the top; Esc closes it.
- `Toast`: bottom centre, `#2a2825` on `#383631` border, radius 12; one at a time.
- `Segmented`: padding 3, gap 2, `bg.elevated`, radius 10; buttons 26–28px, 12px/500; active
  `bg.pressed` + `text.strong`; a mono 11px count after the label.
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
  `bg.sidebarActive`. Right-click opens the project menu (Rename / Delete project…); Rename or a
  double-click turns the whole row into the field in place (`bg.sunken`, inset 1px accent
  outline, the name where it was and selected, no navigation): ↵ saves, Esc or leaving the field
  cancels, a name conflict turns the outline danger with the message as its tooltip. A draft
  project (flow C) shows as an active row at the end.
- **Update row** (only while a newer version is known, above the footer): 36px button, margin
  8px 10px 10px, radius 10, `rgba(accent, 0.12)` with a 1px `rgba(accent, 0.3)` border,
  `accent.text` 13px: 16px arrow-up-in-circle icon + "Update to <version>" (title "Downloads
  Gitgel <version> and restarts the app (you have <current>)"). A click downloads, checks and
  installs it, then the app restarts; meanwhile "Updating… N%" (disabled). A failure turns it
  danger: "Update failed · Retry", the error as its title.
- **Footer** (56px, top border `#2a2825`): a 36px link row (folder icon + "N repositories",
  "1 repository") → Settings. On footer hover the row gets `bg.sunken` and a 32px "+" button
  appears (aria-label "Add repository", title "Add repository…"; hidden but space kept
  otherwise) that opens the folder picker and the add-repositories sheet. The gear → Settings is
  on the far right (`bg.sidebarActive` while on Settings).

### Branches (`Main.dc.html`)

Every active branch, whether or not it is in a project.

- **Header** (64px, drag region): title "Branches"; subtitle
  `Active branches · N repos · checked out in a worktree, or committed in the last D days`
  ("1 repo"); refresh button; **All / Not in a project** segmented control with counts; filter
  field.
  - "All" (default) lists every active branch. "Not in a project" hides rows that are in any
    project and repo bands left empty; the subtitle becomes `Active branches not in any project ·
    N repos · …` (N = visible repos). Counts ignore the text filter. The choice is remembered in
    `localStorage` (`gitgel.branches.scope`). If nothing is left: centred serif 22px "Every active
    branch is in a project". The sidebar count always shows all active branches.
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
  10px 16px 10px 28px; folder icon in accent, 15px/600 repo name, mono 11px muted path,
  "N branches" on the right, ending where the Projects column does (32px in); 14px between
  bands. Repos with no rows are hidden, except when focused from a repo link
  (then "0 branches"). A missing repo shows a danger pill "path not found" (→ Settings); a repo
  git2 cannot open shows a danger "git error" pill.
- **Row** (same grid, bottom border `border.row`):
  - Checkbox: visible only on the hovered row; once anything is selected, all are visible.
  - **Branch** cell, three lines (gap 3), so every row has the same height:
    1. The mono 13 `text.strong` name (short SHA for a detached HEAD), the only link (opens
       single-branch review; tooltip the full name). Too long for the cell, it is cut in the
       middle: the start shrinks with "…" and the end (at most the last 16 characters, from after
       a `-`, `/`, `_` or `.`) always shows, so names that differ only at the end stay apart.
    2. A 15px mono 11 muted line: `base <base> · <diff> · <age>` (faint `·`; only the base is cut
       with "…" when the line runs out of room), then the state pill.
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
      another project…" (opens the picker without the projects the branch is already in). While
      open the chip is `bg.pressed` with a `#4a4741` border and the row `bg.elevated`. ↑/↓/↵/Esc
      work.
    - Right after an add the cell shows the new count with an accent outline and
      `rgba(79,143,163,0.12)` fill for ~2 s. In "Not in a project" the row leaves the list.
  - **Row menu**: a 24px vertical "⋮" button (`aria-label` "Branch options"), shown on
    the hovered or focused row and while its menu is open (then `bg.pressed`, row
    `bg.elevated`). It opens a 260px menu, right-aligned under the button (right-clicking
    anywhere on the row opens it at the pointer): "Copy branch name"
    (hidden for a detached HEAD), then the open items as in the Project entry menu (with a divider
    between the two groups); icons as there. ↑/↓/↵/Esc work.
  - Hover `bg.sunken`; selected `rgba(79,143,163,0.10)`.
- Repos sorted by their newest row, rows newest first (by the age shown).
- While the first scan runs: muted "Scanning repositories…" (the list fills in repo by repo).
  With repos but no rows: serif 22px "No active branches" and "Branches checked out in a worktree
  or committed in the last D days show up here."
- Esc clears the selection, otherwise the filter.
- **Empty state** (no repos): subtitle "Nothing to review yet", no refresh or filter; centred 40px
  accent branch icon, serif 28px "No repositories yet", 14px copy, 40px primary
  "Add repository…" (multi-folder picker), 12px muted "or drop folders onto this window".
- **Selection bar** (flow H), bottom centre when 1+ rows are selected: "N branches selected"
  (13px/500) + 12px muted "across M repos", divider, secondary "Add to project ▾" (the project
  picker, opening above the bar), primary "New project", ✕ clears.
- **Project picker** (300px popover): "Search" input, projects (name + 12px muted
  "N entries"), and a `#2a2825` footer "+ New project…" in `accent.text`. "+ New project…"
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
  project name, subtitle `Project review · X of Y entries have changes` (X = groups with a file in
  any mode).
- **Branch scope** (a Branches row): title = branch (short SHA if detached), subtitle
  `<repo> · not in a project` or `<repo> · in <Project>`; `<repo> · last known state` when opened
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
  renames the project in place like the Project page's); right: a refresh button, segmented
  **Committed / Uncommitted / All**, each with its file count summed over all groups, and, in
  project scope, a 32px pencil button "Edit project" that opens the project page (going back to
  it when Review was opened from there).
- Default mode Committed; Uncommitted if there are no committed changes but some uncommitted.
  Switching mode resets the selection to that mode's first file. Groups with no files in the
  mode are hidden, except the one group of a branch review (its base button stays reachable).
- **Left file list** (310px, `bg.sidebar`, padding 8, scrolls), one group per entry (two entries
  from the same repo are two groups):
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
  - Line 1: collapse chevron + 14px/600 repo name, then the right-aligned **base button** (22px,
    `bg.elevated`, mono 11, muted "base" + name + chevron; accent border and ring when the base
    is custom). A small spinner shows while that group recomputes after a base change.
  - Line 2 (indent 20): mono 12 branch (ellipsis), mono 11 green `+add` and red `−del` (del
    hidden when 0).
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
  scrolls to that repo's band and highlights it briefly), mono 12 branch, mono 11 muted range
  (`<base>..<branch>` or `working tree <~path>`), and on the right 12px muted
  `N commits ahead of <base>` (Uncommitted: `HEAD ↔ working tree`).
- **Commit list** (max ≈132px, scrolls; hidden in Uncommitted): rows with mono 12
  `accent.text` short SHA, subject, and mono 11 muted age. Commits that belong to another branch
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
  spaces changed" (⌥W), and a muted footer "Applies to every diff and is remembered." Every row
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
  (`rgba(79,143,163,0.18)`, `#a3cad6` icon), its tooltip becomes "Next file: <name> (⌥↓)", the
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
- **Base menu** (340px popover, from a group's base button, the Project table's Base button or a
  "base missing" pill): "Search" input; **Suggested** (mono 13 name +
  `Contains N of the M commits shown`); **Default** (see "Default and remote rows" below);
  **Other branches**; **Remote branches**; **Tags** when the filter
  matches some; a "Use <shortSha>" row when the filter is a 7–40 hex SHA that resolves. Empty
  sections are hidden; ↑/↓/↵/Esc work. After a choice only that group recomputes (the others keep
  their data) and a neutral banner says `Base for <branch> set to <base>. Saved for this branch;
  Branches and projects use it too.` (the uncommitted banner takes precedence; the banner goes
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
  - The group's base button and the entry bar range always show the ref in use
    (`base origin/master`, `origin/master..feat/x`); the accent border of the base button still
    means "stored custom base" only.
- Empty states: "No committed changes" / "No uncommitted changes" / "No changes". Branch scope
  on an entry that cannot be reviewed: "This branch no longer exists", "Repository not found",
  "Base missing: …".
- The review refreshes in place when a related repo changes (the open file stays selected if it
  is still listed).

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
  - "Point to another branch…": a branch picker (local branches of the entry's repo); repoints
    the entry and refreshes its last known tip.
  - "Copy branch name" (hidden for detached entries).
  - **Open items**: divider, "Open in Finder" (the worktree folder, or the repository folder
    when the branch is not checked out), then "Open in <App>" for
    each installed editor, in this order: Cursor, VS Code, Windsurf, Zed, Sublime Text, then one
    item for the terminal chosen in Settings › General ("Open in Terminal", "Open in iTerm2",
    "Open in WezTerm", or the Other app's or command's name). Editors that are not installed are
    not listed. Each item's icon is the app's own macOS icon, 16px, drawn grayscale
    (`filter: grayscale(1)`), Finder's too; without one, a terminal line icon.
    A pick closes the menu; a failure is logged (`log::warn!`), nothing is shown.
    - Always listed. A branch that is not checked out still opens its repository folder, with a
      warning note closing the group: "Not checked out in a worktree, so this opens the
      repository folder." Only a missing repo or a deleted branch has nothing to open: every
      open item is then disabled (text `text.faint`, icon at 40%) and the note says "Repository
      not found, so there is nothing to open." / "The branch was deleted, so there is nothing to
      open." (a gone detached worktree counts as deleted). The note is 12px `warning.text`,
      line-height 1.45, padding 6px 10px 4px, with a 14px circle-i icon. When only the chosen
      terminal is not installed, its item alone is disabled and the note says "<Name> is not
      installed; pick another terminal in Settings."
  - Divider, danger "Remove from project".
- **Project menu** (230px; also on the sidebar's right-click): "Rename" (hint "F2"), divider,
  danger "Delete project…".
- **Rename:** the title becomes an in-place input in the title's own box (at least 340px wide,
  30px, padding 0 6px, 1px border, serif 22px, `bg.sunken`), so the name does not move; only the
  border turns accent, no ring; text selected; subtitle "↵ save · esc cancel". A name conflict
  (case-insensitive, itself excluded) turns the border and subtitle danger: `A project named "X" already exists`; ↵
  then does nothing, as with an empty name. Esc or a click elsewhere cancels.
- **Delete confirm** (440px modal): serif 22px `Delete "Name"?`, "The project and its N entries
  are removed from this app. Branches, worktrees and repositories are not touched." ("its 1
  entry"), Cancel / danger "Delete project". Afterwards Branches.
- **One entry:** a card under the table (`bg.elevated`, radius 12): serif 20px accent "+",
  "Add related branches from other repositories", `Kbd` ⌘K; opens the palette.
- **Empty project:** centred serif 28px "No entries yet", "A project groups branches that belong
  to one piece of work, across any of your repositories.", 40px primary "Add branches ⌘K".
- A project that no longer exists (deleted elsewhere) sends the screen back to Branches.
- **Draft project** (flows C and H): not saved until named. Title in rename mode with the text
  selected; subtitle "Name your project · ↵ save · esc discards it" (from a selection:
  `N entries across M repos · name your project · ↵ save`); the sidebar shows it as an active
  row; rows come from the scan. ↵ with a valid name creates it; Esc, or going to another screen,
  discards it.

### Add palette (`Palette.dc.html`)

- Opens over the project it adds to (⌘K, "Add entries", "Add branches", the "add related" card);
  there is **no project picker**. Works for a draft project too.
- 620px dialog, centred, top 96px, radius 16, over the scrim. Search row 56px: search icon, 16px
  input (focused), 12px muted "fuzzy · all repos". List max 470px. Footer (`bg.sunken`):
  "N selected" … primary "Add ↵".
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
  repo count in mono 12 muted on the right), **Shortcuts** (keyboard). The chosen one:
  `bg.sidebarActive`, `text.strong` 500, `aria-current="page"`; others hover `bg.sunken`.
  Settings opens on the section shown last (General at first; kept for the session).
  The sidebar's "N repositories" row and every "path not found" link open Repositories; the
  gear and ⌘, open the last one.
- **Repositories:** serif 18px heading; card (`bg.sunken`, radius 12). Row: 500-weight name
  (96px), mono 12 muted path (ellipsis), a note (`base <defaultBase>`, "no base found", or a
  danger pill "path not found" + 28px "Locate…", or "git error"), ✕ remove. "+ Add repository…"
  (last row, `accent.text`) opens the folder picker and sheet (flow A).
  - Locate…: the picked folder must be a repository (or resolve to one) not already added under
    another id; errors show under the row in 12px danger ("Not a git repository",
    "Already added as <name>"). Fixes every entry of that repo.
  - ✕ asks first only when projects use the repo: `Remove <name>?` · "Its N project entries are
    removed too. Nothing on disk is touched." · Cancel / danger "Remove". Removing drops the repo,
    its branch bases and its project entries.
  - Under the card, "Default base" ("Tried in order when a branch has no base set"; label level with the first
    row): an ordered list, one branch per row, so no separator is ever typed (flow M4/M5). A 280px
    card (`bg.sunken`, radius 10); 34px rows: mono 11 faint position, mono 12 name (ellipsis),
    then ↑ / ↓ / ✕ (24px icon buttons, shown while the row is hovered or holds focus): move up,
    move down, remove. ↑ is disabled on the first row, ↓ on the last, ✕ when only one is left
    (the list is never empty). The last row "+ Add branch" (`accent.text` 500) becomes a 28px
    mono `Input` ("Branch name, e.g. develop"), with a 12px muted "↵ add · esc cancel" under the
    card. ↵ adds the trimmed name at the end; a name already in the list ("<name> is already in
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
    Terminal, iTerm2, WezTerm, "Other…". Terminals that are not installed are disabled. At
    launch a chosen terminal that is not installed falls back to Automatic (an Other command
    cannot be checked, so it is left alone). Other shows under it, full width, a 36px mono input
    (placeholder `wezterm start --cwd %`, saved on blur/↵, trimmed; empty = Automatic) and a
    12px muted note: "A command, or an app name such as Ghostty. `%` becomes the worktree folder;
    the command runs in your login shell, in that folder." When the chosen app is not installed,
    a right-aligned 12px `warning` line: "<Name> is not installed; the menus show it disabled".
    Saved at once (`settings.terminal`, `settings.terminalCommand`).
  - "Check for updates" ("At launch and every 6 hours; a new version shows in the sidebar"): a
    checkbox, on by default (`settings.checkUpdates`). Off hides a found update; on checks at once.
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

- **A · First run.** Branches is empty ("No repositories yet"). **Add repository…** (multi-folder
  picker) or dropping folders opens the sheet, which checks each folder: ✓ git repository with
  its default base; ↪ worktree or subfolder, resolved to the main repository (duplicates
  skipped); ✕ not a repository, skipped. "Add N repositories" fills Branches.
- **A · More repositories later.** The sidebar footer's "+", Settings' "+ Add repository…" and
  dropping folders on any screen all end in the same sheet.
- **B · Project from a Branches row.** "+ Add" in a row's Projects cell opens the project
  picker; pick a project, or "+ New project…" → name form → "Create & add ↵". The row stays; its
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
  labelled, plus the warning note. The base button's menu suggests that branch. After choosing,
  only that group recomputes and the banner confirms. The base is stored per branch.
- **F · Broken entries.** Labels, not errors: a deleted branch offers its last known state; a
  missing repo is fixed with Locate… in Settings (fixes all its entries); "base missing" opens the
  base menu.
- **G · Rename / delete project.** As described under the Project screen.
- **H · Project from a selection.** Select rows on Branches; the selection bar offers "Add to
  project ▾" (the project picker) or "New project" (a draft project with those entries, title in
  rename mode, as in C).
- **I · Which projects a branch is in.** The Projects column counts them; clicking the count
  lists them and offers "+ Add to another project…". The "Not in a project" filter shows only
  branches in no project.
- **J · Open elsewhere.** The ⋯ menu of an entry (Project) or
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
| Review | Next / previous change | ⌥↓ / ⌥↑ | continues into the next / previous file |
| | Newer / older commit | ⌥⇧↑ / ⌥⇧↓ | with no commit picked, ⌥⇧↓ picks the newest |
| | Split / Unified | ⌥V | |
| | Ignore whitespace | ⌥W | |
| | Changes only / Whole file | ⌥C | |
| Lists and dialogs | Move | ↑ / ↓ | |
| | Mark row | Space | Add palette |
| | Confirm | ↵ | |
| | Cancel | Esc | |

⌘R never reloads the webview (default prevented everywhere). Multi-select on Branches is by
checkbox only (no ⌘/⇧-click).

**App menu** (`src-tauri/src/menu.rs`, the standard macOS menus plus):

- **Gitgel › Check for Updates…** (after About): checks now, whatever the setting, and answers in
  a native dialog: "You’re up to date", or "A new version of Gitgel is available" with **Update
  and Restart** / **Later**, or the error.
- **Gitgel › Settings…** (⌘,): emits `open-settings`; the frontend opens Settings unless a modal
  is open or Settings is already showing.
- **View › Font Size**: Decrease (⌘-), Increase (⌘.), Reset (⌘0). Zooms the whole window in steps
  50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200 %; saved as `settings.zoom` and applied at
  startup. ⌘- and ⌘. need no Shift on Turkish and US layouts.
- **Help › Discuss on GitHub** (opens https://github.com/gokberkakdeniz/gitgel/discussions),
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
  appearance: 'system' | 'light' | 'dark'; // Settings › General › Theme; default 'system' (T10.1)
}
export interface Config {
  version: 1;
  repos: RepoConfig[];
  branchBases: Record<string, string>;   // entryKey -> base ref name
  projects: ProjectConfig[];
  settings: Settings;
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
  lastCommitAt: number | null;   // committer time of the tip, unix seconds
  changedAt: number | null;      // newest uncommitted file mtime; only when newer than lastCommitAt
  state: EntryState;
  error: string | null;          // detail for git_error / base_missing
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
  active: EntrySummary[];            // active branches + detached worktrees, newest first
  others: OtherBranch[];             // all other local branches except the base branch
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
export type FileKind = 'A' | 'M' | 'R' | 'D' | 'U';
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
export interface ReviewData {
  groups: ReviewGroup[];          // reviewable entries, in project order
  notInReview: EntrySummary[];    // project scope only
  totalEntries: number;
}
export type ReviewTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'branch'; repoId: string; branch: string | null;
      worktreePath: string | null; tipOverride: string | null };
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
| `locate_repo` | `repoId, path` | `Config` |
| `update_settings` | `settings: Settings` | `Config` |
| `get_open_apps` | – | `OpenApp[]` (in menu order; the terminal always, `found: false` when missing) |
| `get_terminal_options` | – | `TerminalOption[]` (Terminal/iTerm2/WezTerm with install state) |
| `open_folder` | `path, app: string` | `null` (`app`: an `OpenApp` id) |

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

---

## 10. Git layer (git2)

### Setup and boundary

- Crate `git2`, `default-features = false`, `features = ["vendored-libgit2"]`.
- git2 is used only under `src-tauri/src/git/`. No git2 type leaks out: SHAs are hex `String`s,
  errors `AppError`, results the types in §8.
- `src-tauri/clippy.toml` turns every writing API into a compile error under `-D warnings`:
  - `std::process::Command::new` (allowed only in `apps.rs` for the terminal).
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
  | `index` | `Worktree` (main worktree) |
  | `worktrees/<name>/HEAD` | `Refs` |
  | `worktrees/<name>/index` | `Worktree` (that worktree) |
  | adding/removing `worktrees/<name>` | `Refs` (worktree list changed) |
  | anything else (`objects/`, `logs/`, `*.lock`, `FETCH_HEAD`, …) | ignored |

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
| Settings | `Settings.dc.html` | section list 30–38 (data 262–274), Repositories 43–100 (repo card 44–62, Default base list 64–92 with rows, actions and add states 276–301, Active threshold 94–99), General 102–153 (Theme 104–122, tile builder 238–261; Terminal 124–146, options with disabled flag 304–308; Check for updates 147–152), Shortcuts 155–179, shortcut data and keycap style 189–237. Flow M (canvas): M1–M3 one per section (General, Repositories, Shortcuts), M4 default base hover + adding, M5 rejected name |
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
    `squashed` (squash-merged).
  - **api-server** (default `master`, no origin): `feat/job-queue` (3 commits),
    `token-rotation-job` (stacked on it, checked out in `wt/token-rotation` with a change),
    a detached worktree `wt/detached` at `feat/job-queue~1`, `to-be-deleted`.
  - `not-a-repo/`.
  - Subcommands: `delete-branch` (deletes `to-be-deleted`), `remove-repo` / `restore-repo` (moves
    web-app away and back).
- **Performance targets:** first scan < 3 s; a file change reaches the screen in < 1 s (300 ms
  debounce included); a full rescan with nothing changed < 300 ms; switching files in Review is
  instant; an event storm (hundreds of files) is merged into a few jobs without freezing the UI.
- **Read-only audit:** `grep -rn "Command::new" src-tauri/src` is empty; git2 appears only under
  `src-tauri/src/git/`; `disallowed` only in `git/testutil.rs`; clippy passes; after using the app
  on the fixtures (with file edits, focus changes and refreshes),
  `find ~/gitgel-fixtures -path '*/.git/*' -newer <marker>` is empty.
- **Build:** `pnpm tauri build --bundles app` → `src-tauri/target/release/bundle/macos/Gitgel.app`,
  ad-hoc signed (`bundle.macOS.signingIdentity: "-"`), not notarized. The version comes from
  `package.json`.
- **Release:** `pnpm release` (`scripts/release.sh`) needs a clean, pushed working tree and a
  clean, pushed Homebrew tap clone at `../homebrew-tap` (or `$GITGEL_TAP_DIR`), on an arm64 Mac.
  It builds, zips with `ditto` (`Gitgel-<version>-macos-arm64.zip`) and uploads the zip to this
  repo's GitHub release `<version>` (no `v`; created on first run). The code repo is private, so it
  also uploads the zip to the public `gokberkakdeniz/homebrew-tap` release `gitgel-<version>`, then
  updates `version` and `sha256` in the tap's `Casks/gitgel.rb`, commits and pushes. After new
  commits, bump the version first. It also builds the signed update (below) and needs its key.
- **Updates:** the release build also makes `Gitgel.app.tar.gz` and its minisign signature
  (`createUpdaterArtifacts`, passed with `--config` only by `release.sh`, so a plain build needs
  no key; key `~/.tauri/gitgel.key` or `$GITGEL_UPDATER_KEY`, public key in `tauri.conf.json`).
  It is uploaded as `Gitgel-<version>-macos-arm64.app.tar.gz` next to the zip in the tap release,
  and `gitgel/latest.json` in the tap (`version`, `pub_date`, `platforms.darwin-aarch64` url +
  signature) is committed with the cask. The app reads it from
  `raw.githubusercontent.com/gokberkakdeniz/homebrew-tap/master/gitgel/latest.json`; the cask
  has `auto_updates true`, so `brew upgrade` leaves a self-updating app alone. Only release
  builds install; a lost key means existing installs can no longer update in-app (a new key
  ships with a `brew upgrade`).
- **Install:** `brew install --cask gokberkakdeniz/tap/gitgel` (Apple silicon). The cask removes
  the quarantine flag after install (`postflight_steps`), so the unnotarized app opens.
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
