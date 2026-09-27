# Gitgel — spec

This is the single source of truth for Gitgel: what the product does, how it looks and behaves,
the architecture, the shared types, the git rules and the progress tracker. It describes the app
as it is now. `design/screens/*.dc.html` hold the visual reference for each screen (§11).

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
  banned in app code. git2 is used only under `src-tauri/src/git/`; other modules use the
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

### Tasks and checkpoints

- New work is added as tasks in §14 (template there) and done in order. Check that a task's
  dependencies are ticked before starting it.
- A ✋ checkpoint task means: stop, leave the app running (`pnpm tauri dev`), list for the user
  what to check and how, and wait for approval before continuing.
- When a task is done, tick it in §14 (`- [x] … — YYYY-MM-DD`), only once its acceptance
  criteria hold. If it is left half-done, do not tick it; add `  - note: …` under it.
- When a task changes behaviour, update the relevant section of this file in the same change.

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
  stored **per branch** and applies wherever that branch appears.
- **Active branch:** checked out in a worktree, or committed in the last N days (Settings,
  default 14) and ahead of its base.
- **Base branch:** the branch whose name matches the repo's default base (e.g. `main`). It is
  compared with its upstream (the configured one, else `origin/<name>`) and is listed only when it
  has unpushed commits or uncommitted changes. Without an upstream only its working tree is shown;
  that is not "base missing".

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
| Settings | Repositories, default base order, active threshold and a read-only list of keyboard shortcuts. Diff layout and ignore-whitespace live in Review's view menu, font size in View › Font Size; all three are stored in the config. |
| Config owner | Only Rust reads and writes the config. The frontend never writes files; every change is a Tauri command. |
| Config path | `~/Library/Application Support/com.gitgel.desktop/config.json` (Tauri `app_data_dir()`). |
| Logs | `tauri-plugin-log` → `~/Library/Logs/com.gitgel.desktop/Gitgel.log`, up to 3 × 2 MB. Git errors are logged with `log::warn!`. Debug level (watch rounds) only in dev builds. |
| Package manager | pnpm, version pinned in `package.json` `packageManager`. |
| Frontend | React + TypeScript + Vite, state in zustand. Backend data arrives two ways: **push** (config and scan result live in a store, updated by backend events) and **request/response** (review, project view, file contents, base options, commit changes) through a small `useInvoke` hook that refetches when a related repo event arrives. No React Query. Styling: CSS Modules + CSS variables. Fuzzy search: fuse.js. |
| Diff | `@monaco-editor/react` + `monaco-editor`, bundled locally (`loader.config({ monaco })`), never from a CDN. |
| Fonts | Instrument Sans, Source Serif 4, JetBrains Mono via `@fontsource/*`, bundled. The app works offline. |
| Bundle id | `com.gitgel.desktop` (must not end in `.app`). |
| Distribution | `pnpm release` builds, zips and uploads to GitHub releases and updates the Homebrew cask (§12). |

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
│  │            shortcuts.ts  addRepos.ts  draft.ts  projects.ts  projectSort.ts  useFolderDrop.ts
│  ├─ state/    nav.ts  ui.ts  data.ts
│  ├─ components/                 # Button, IconButton, Pill, Checkbox, TextInput, Kbd, Popover,
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

Dark only. Warm near-black neutrals, one cool accent. Tokens are CSS variables in
`src/styles/tokens.css` (`bg.sidebar` → `--bg-sidebar`, `text.muted` → `--text-muted`, …) and
the same hex values in `src/styles/tokens.ts` for Monaco.

### Colour tokens

| Token | Value | Use |
|---|---|---|
| `bg.sidebar` | `#0e0d0c` | Sidebar, review file list (the left side is always darker than the right) |
| `bg.main` | `#141311` | Main content, review header, diff panes |
| `bg.sunken` | `#1a1917` | Inputs, sub-headers (file bar), modal footers, cards |
| `bg.band` | `#1c1b18` | Repo band on Branches |
| `bg.elevated` | `#211f1c` | Popovers, menus, modals, secondary buttons |
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

Monaco theme `gitgel` (`src/monaco/theme.ts`, base `vs-dark`): background `#141311`, foreground
`#e0ddd6`, line numbers `#75726b` (active `#a09d96`), inserted line `#5db87226`, removed line
`#c645452b`, inserted text `#5db87240`, removed text `#c6454548`, diagonal fill `#1c1b18`,
unchanged region `#1a1917` / `#75726b`, border `#302e2a`, scrollbars `#383631`. Syntax colours:
keyword `#7fb3c4`, string `#e8c071`, number `#c5b2f2`, type `#93b8ee`, comment `#75726b` italic,
everything else `#e0ddd6`.

### File-kind badges

18px square, radius 5, mono 10px/500: A `#8fcf9c` on green tint, M `#e8c071` on amber tint,
R `#93b8ee` on `rgba(90,140,220,0.16)`, D `#ee9a90` on red tint, U (untracked) `#c5b2f2` on
`rgba(160,130,230,0.16)`.

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
- Sidebar 260px. Page header 64px (Review header 56px).
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
- `TextInput`: `bg.sunken`, 1px border, focus ring; `invalid` turns the ring danger
  (`#ee9a90` + `rgba(198,69,69,0.25)`).
- `Popover`: positioned under an anchor rect, kept inside the viewport, `bg.elevated`, radius 12,
  popover shadow; outside click and Esc close it.
- `Menu`: padding 6, items 8px 10px, radius 8, active item `bg.hover`; `danger`, `hint`, `sub`
  lines and dividers.
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
Project title (double-click renames it). The default webview context menu is disabled except in
inputs, textareas and the diff.

---

## 5. Screens

### Sidebar (`Sidebar.dc.html`)

- 260px, `bg.sidebar`, right border `border.row`. Hidden on Review; the header then shows a
  show-sidebar button next to the traffic lights.
- **Top row** (52px, drag region): traffic-light space, 28px icon buttons: sidebar toggle, Back,
  Forward (disabled colour `#5c5a55` when history does not allow it).
- **Nav** (40px rows, radius 10, 14px; active `bg.sidebarActive` + `text.strong`):
  **New project** (24px round `#302e2a` "+"; starts flow C) and **Branches** (branch icon, mono
  12px count of all active branches on the right).
- **Projects** label (14px `text.muted`) with two icon buttons:
  - Search turns the label row into a 32px "Filter projects" input (name contains; Esc closes).
  - Sort/filter opens a menu: "Sort by name" / "Sort by date created" (default: creation order),
    remembered in `localStorage` (`gitgel.projectSort`).
- **Project list:** 40px rows, 7px hollow circle (1.5px border; `#e0ddd6` when active, else
  `#75726b`) + name with ellipsis, no counts. Click opens the project; the active one gets
  `bg.sidebarActive`. Right-click opens the project menu (Rename / Delete project…). A draft
  project (flow C) shows as an active row at the end.
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
  - Filter field: 230 × 32px, `bg.sunken`, search icon, placeholder "Filter branch or worktree",
    `Kbd` "⌘K" (⌘K focuses it). It is a real filter, word-based: `-`, `/`, `_`, `.` count as
    spaces, and every typed word must appear in the branch name or SHA, the worktree path or the
    repo name, in any order, case-insensitive ("to be" finds `to-be-deleted`, "feat queue" finds
    `feat/job-queue`). Esc clears it.
- **Columns:** grid `16px minmax(0,1fr) 60px 68px 128px 150px 112px 44px`, column-gap 12,
  padding 10px 28px, section-label style: [checkbox] Branch · Ahead · Files · Uncommitted · State ·
  Projects · Age.
- **Repo band** per repo: `bg.band`, top border `border.strong`, bottom border `border`, padding
  10px 28px; folder icon in accent, 15px/600 repo name, mono 11px muted path, "N branches" on the
  right; 14px between bands. Repos with no rows are hidden, except when focused from a repo link
  (then "0 branches"). A missing repo shows a danger pill "path not found" (→ Settings); a repo
  git2 cannot open shows a danger "git error" pill.
- **Row** (same grid, bottom border `border.row`):
  - Checkbox: visible only on the hovered row; once anything is selected, all are visible.
  - Branch: mono 13 `text.strong` name (short SHA for a detached HEAD), under it mono 11 muted
    `base <base> · worktree <~path>` or `base <base> · not checked out`. Only the name is a link
    (opens single-branch review).
  - Ahead mono 12 `↑N`; Files mono 12.
  - Uncommitted: 12px/500 `accent.text` "● N changed", otherwise faint "—".
  - State pills: "merged into <base>" (success), "detached HEAD" (warning), "base missing"
    (warning, opens the base menu), "git error" (danger, tooltip = error); otherwise faint "—".
  - **Projects cell** (26px, radius 8, padding 0 9px, 12px):
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
  - Age: mono 12 muted.
  - Hover `bg.sunken`; selected `rgba(79,143,163,0.10)`.
- Repos sorted by their newest commit, rows newest first.
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
- **Project picker** (300px popover): "Filter projects" input, projects (name + 12px muted
  "N entries"), and a `#2a2825` footer "+ New project…" in `accent.text`. "+ New project…"
  turns it in place into a 320px form: serif 18px "New project", "Name" input (focused), "First
  entry" + mono 11 `<repo> / <branch> · base <base>`, Cancel / primary "Create & add ↵". A name
  conflict marks the input invalid with a 12px danger message and disables the button.
- **Toast** after an add: `<branch> added to <Project>` (or `N branches added to <Project>`),
  "Undo" (28px, `#383631`; removes the entries, and deletes the project if the add created it)
  and "Open project →". Disappears after 6 s.

### Review (`Diff.dc.html`)

One screen for both scopes:

- **Project scope** (Project → "Review changes" or ⌘R, or a project row's branch link): title =
  project name, subtitle `Project review · X of Y entries have changes` (X = groups with a file in
  any mode).
- **Branch scope** (a Branches row): title = branch (short SHA if detached), subtitle
  `<repo> · not in a project` or `<repo> · in <Project>`; `<repo> · last known state` when opened
  on a deleted branch's last tip. One group.

Layout:

- The sidebar is hidden while on Review and restored on leaving. **Header** (56px, `bg.main`,
  drag region): traffic-light space, show-sidebar button, Back (aria-label "Back to Branches" /
  "Back to project"), serif 18px title + 12px muted subtitle; right: segmented **Committed /
  Uncommitted / All**, each with its file count summed over all groups, and a refresh button.
- Default mode Committed; Uncommitted if there are no committed changes but some uncommitted.
  Switching mode resets the selection to that mode's first file. Groups with no files in the
  mode are hidden.
- **Left file list** (310px, `bg.sidebar`, padding 8, scrolls), one group per entry (two entries
  from the same repo are two groups):
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
  the reference, accepted). Unchanged regions fold (context 3). No minimap, overview ruler or
  context menu; `useInlineViewWhenSpaceIsLimited: false`. The editor is created once; changing
  file, layout or whitespace updates it in place. Binary files show muted "Binary file not
  shown"; files over 1 MiB "File is too large to show (over 1 MB)".
- **Diff view menu:** the view button (split or unified icon + "Split" / "Unified" + chevron;
  28px, `#211f1c`, open state `#2a2825` with accent border) opens a 290px menu (`role="menu"`,
  right-aligned under the button): "Layout" label, `menuitemradio` Split / Unified (⌥V), divider,
  `menuitemcheckbox` "Ignore whitespace" with "Hide lines where only indentation or trailing
  spaces changed" (⌥W), and a muted footer "Applies to every diff and is remembered." Every row
  has a 16px indicator column (accent check for the picked layout, a checkbox for whitespace),
  the label, and the shortcut right-aligned; no icons inside the menu. Picking a layout closes
  the menu; the checkbox leaves it open. Both settings are global and saved in the config.
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
  "base missing" pill): "Filter branches, tags, SHAs" input; **Suggested** (mono 13 name +
  `Contains N of the M commits shown`); **Default** (name + `current · from <source>` or
  `from <source>`); **Other branches** ("current" on the current base); **Tags** when the filter
  matches some; a "Use <shortSha>" row when the filter is a 7–40 hex SHA that resolves. Empty
  sections are hidden; ↑/↓/↵/Esc work. After a choice only that group recomputes (the others keep
  their data) and a neutral banner says `Base for <branch> set to <base>. Saved for this branch;
  Branches and projects use it too.` (the uncommitted banner takes precedence; the banner goes
  away when leaving the screen).
- Empty states: "No committed changes" / "No uncommitted changes" / "No changes". Branch scope
  on an entry that cannot be reviewed: "This branch no longer exists", "Repository not found",
  "Base missing: …".
- The review refreshes in place when a related repo changes (the open file stays selected if it
  is still listed).

### Project (`Projects.dc.html`)

- **Header** (64px): serif 22px title (double-click or F2 renames); subtitle
  `N entries across M repos` / `1 entry · <repo>` / `Empty`; right: refresh, "⋯" (32px; open
  `bg.pressed` + `#4a4741` border), secondary "Add entries ⌘K", primary "Review changes"
  (disabled when empty; ⌘R).
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
  - "View last known state" (deleted branches only), with mono 11 muted
    `tip <shortSha> · seen <age> ago`; disabled with `tip <shortSha> · no longer in the repository`
    when the commit is gone. Opens single-branch review on that tip.
  - "Point to another branch…": a branch picker (local branches of the entry's repo); repoints
    the entry and refreshes its last known tip.
  - "Copy branch name" (hidden for detached entries).
  - Divider, danger "Remove from project".
- **Project menu** (230px; also on the sidebar's right-click): "Rename" (hint "F2"), divider,
  danger "Delete project…".
- **Rename:** the title becomes an in-place input (340 × 34px, serif 22px, `bg.sunken`, accent
  ring, text selected); subtitle "↵ save · esc cancel". A name conflict (case-insensitive,
  itself excluded) turns the ring and subtitle danger: `A project named "X" already exists`; ↵
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

- Header 64px, serif 22px "Settings". Two columns (gap 40, padding 28px 32px); the page scrolls.
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
- **Behaviour:** serif 18px heading.
  - "Default base" ("Tried in order when a branch has no base set"): 230px mono input showing
    `origin/HEAD → main → master`. On blur/↵ it is split on `→`, `,` or `>`, trimmed, empties
    dropped; an empty list restores the old value.
  - "Active threshold" ("Branches without a worktree are listed if committed within"): 60px
    right-aligned mono input + "days"; anything but an integer 1–365 restores the old value.
  - Changing either rescans every repo.
- **Keyboard shortcuts** (full width under both columns, margin-top 40): serif 18px heading +
  muted "Not editable yet"; four cards (`bg.sunken`, radius 12, padding 6px 0) in a
  `repeat(4, minmax(max-content, 1fr))` grid, gap 12 (a narrow window scrolls instead of
  squeezing): **General**, **Branches and projects**, **Review**, **Lists and dialogs**. Group
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
  5. The view button switches Split / Unified and Ignore whitespace.
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
| Branches and projects | Focus filter | ⌘K | Branches |
| | Add branches | ⌘K | Project (opens the palette) |
| | Review changes | ⌘R | Project |
| | Rename project | F2 | Project |
| Review | Next / previous change | ⌥↓ / ⌥↑ | continues into the next / previous file |
| | Newer / older commit | ⌥⇧↑ / ⌥⇧↓ | with no commit picked, ⌥⇧↓ picks the newest |
| | Split / Unified | ⌥V | |
| | Ignore whitespace | ⌥W | |
| Lists and dialogs | Move | ↑ / ↓ | |
| | Mark row | Space | Add palette |
| | Confirm | ↵ | |
| | Cancel | Esc | |

⌘R never reloads the webview (default prevented everywhere). Multi-select on Branches is by
checkbox only (no ⌘/⇧-click).

**App menu** (`src-tauri/src/menu.rs`, the standard macOS menus plus):

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
  zoom: number;                  // View › Font Size, percent; default 100
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
  base: string | null;           // effective base ref (custom or repo default)
  baseIsCustom: boolean;
  ahead: number | null;
  files: number | null;          // files changed merge-base..tip
  add: number | null;
  del: number | null;
  uncommitted: number | null;    // null if not checked out
  lastCommitAt: number | null;   // committer time of the tip, unix seconds
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
export interface BaseOptions {
  current: string | null;
  suggested: StackHint[];                 // descending by contains, contains > 0
  default: { name: string; source: string } | null;
  branches: string[];                     // all local branches except the entry itself
  tags: string[];
}
export interface ProjectView { project: ProjectConfig; entries: EntrySummary[] }
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

Notes:

- Commands that affect a repo (`add_repos`, `remove_repo`, `locate_repo`, `set_branch_base`, and
  `update_settings` when the base order or threshold changed) rescan the affected repos, update
  the watch list and emit `repo-updated`.
- Project names: trimmed, not empty, unique case-insensitively (`NameConflict`). `create_project`
  and `add_entries` fill each entry's `lastKnownTip`; an entry already in the project is skipped.
- `set_branch_base` with `null` or the repo default removes the key from `branchBases`.
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
  - `std::process::Command::new`.
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

### Change watching

No polling. The backend watches the file system, recomputes what changed and pushes the result.

- `notify-debouncer-full` (FSEvents), 300 ms debounce; use its `notify` re-export.
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
  `(repo, tip, base tip)`.
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

---

## 11. Design reference map

| Screen | File | Key lines |
|---|---|---|
| Sidebar | `Sidebar.dc.html` | top row 18–33, nav 35–46, "Projects" header 48–58, list 60–75, footer 79–90 (repo row + "+" 80–86), row and footer styles 100–121 |
| Branches | `Main.dc.html` | header 22–44 (scope selector 32–36), columns 48–50, repo band 54–59, row 61–73 (Projects cell 71), row and cell styles 211–252, filter logic 275–285 and 303–310, empty state 81–91, picker 93–106, new-project form 108–124, projects menu 126–142, toast 144–150, selection bar 151–164, drop overlay 167–174, sheet 176–200 and 312–327 |
| Review | `Diff.dc.html` | header 20–45, banners 47–49 and 650–654, file list 52–109 and 372–409 (commit chip 68–75), entry bar and commits 112–141 (commit stepping 120–127, list 129–140), file bar 143–190 (whitespace chip 146–148, view button and menu 150–179, change navigation 180–189), split body 192–205, unified body 206–212, base menu 219–239, commit selection 348–361, segmented 410–417, view values 616–625, commit values 628–638 |
| Project | `Projects.dc.html` | header 22–43, table 47–60 and 172–183, "add related" card 62–68, empty project 72–80, entry menu 82–93, project menu 94–100, delete modal 103–114, rename 150–170, pills 124–133 |
| Palette | `Palette.dc.html` | dialog 25–56, row style 70–76, pills 62–69 |
| Settings | `Settings.dc.html` | Repositories 28–46, Behaviour 49–59, Keyboard shortcuts 62–84, shortcut data and keycap style 94–130 |

Icons (copy into `src/components/icons.tsx`): sidebar toggle `Sidebar.dc.html:25`; back / forward
`:28`, `:31`; plus `:38` (small, footer `:85`); branch `:43` (large `Main.dc.html:79`); search
`:52`; sort/filter `:55`; folder `:81` (folder-plus `Main.dc.html:147`); gear `:88`; refresh
`Main.dc.html:30`; chevron down `Main.dc.html:134`; close `Main.dc.html:138`; more
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
  `$GITGEL_FIXTURES`). It uses the git CLI and writes, but only inside the folder it creates and
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
  commits, bump the version first.
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

---

## 14. Progress tracker

Status: `[ ]` to do · `[x]` done (append ` — YYYY-MM-DD`). Put `  - note: …` under a task left
half-done. Checkpoints are ticked when the user approves.

New tasks go at the end under a new phase, in this form:

```
#### T<phase>.<n> <title>
- **Depends on:** …
- **Why:** … (user request / feedback, date)
- **Reference:** `<screen>.dc.html` lines …
- **Files:** …
- **Steps:** 1. … 2. …
- **Acceptance:** …
```

and get a line in the list below. Once done, fold the resulting behaviour into §1–§13 and keep
only the tracker line (with a short note if useful).

### Phase 0 — Environment and skeleton
- [x] T0.1 Check prerequisites — 2026-09-26
- [x] T0.2 Tauri 2 + React + TS + Vite skeleton — 2026-09-26
- [x] T0.3 Dependencies and pinned versions — 2026-09-26
- [x] T0.4 Folder layout and template cleanup — 2026-09-26
- [x] T0.5 Fonts, colour tokens, global CSS — 2026-09-26
- [x] T0.6 Window, title bar and permissions — 2026-09-26
- [x] T0.7 Test fixture repositories — 2026-09-26
- [x] T0.8 ✋ Checkpoint — phase 0 — 2026-09-26

### Phase 1 — Git layer, config, adding repositories
- [x] T1.1 Rust module skeleton, error type, AppState — 2026-09-26
- [x] T1.2 git2 boundary: write bans and test repo helper — 2026-09-26
- [x] T1.3 Repository pool — 2026-09-26
- [x] T1.4 Config file — 2026-09-26
- [x] T1.5 Frontend groundwork: types, IPC, stores, event bridge, useInvoke, router — 2026-09-26
- [x] T1.6 Base UI components and icons — 2026-09-26
- [x] T1.7 Sidebar and app shell — 2026-09-26
- [x] T1.8 Folder inspection and default base (backend) — 2026-09-26
- [x] T1.9 First run: empty state, folder picker, drag and drop, sheet — 2026-09-26
- [x] T1.10 ✋ Checkpoint — phase 1 — 2026-09-26

### Phase 2 — Branch and worktree discovery, Branches screen
- [x] T2.1 Diff → FileChange conversion — 2026-09-26
- [x] T2.2 Repo scan: branches, worktrees, base resolution — 2026-09-26
  - note: the base branch is compared with its upstream (user decision 2026-09-26).
- [x] T2.3 Entry summary: ahead, files, merged, state — 2026-09-26
- [x] T2.4 Uncommitted changes — 2026-09-26
- [x] T2.5 Cache and parallel scan — 2026-09-26
- [x] T2.6 Scan commands and stored result — 2026-09-26
- [x] T2.7 Branches screen — 2026-09-26
  - note: word-based filter (user decision 2026-09-26).
- [x] T2.8 File watching and targeted recompute (backend) — 2026-09-26
- [x] T2.9 Frontend: live updates, focus and refresh button — 2026-09-26
- [x] T2.10 ✋ Checkpoint — phase 2 — 2026-09-26

### Phase 3 — Committed diff (Review + Monaco)
- [x] T3.1 Monaco setup and theme — 2026-09-26
- [x] T3.2 Review data (committed) — backend — 2026-09-26
- [x] T3.3 Reading file contents — backend — 2026-09-26
- [x] T3.4 Review screen skeleton and file list — 2026-09-26
- [x] T3.5 Diff view — 2026-09-26
- [x] T3.6 Navigation: Branches → Review — 2026-09-26
- [x] T3.7 ✋ Checkpoint — phase 3 — 2026-09-26

### Phase 4 — Uncommitted layer and mode toggle
- [x] T4.1 Uncommitted and All file lists — backend — 2026-09-26
- [x] T4.2 Reading from the working tree — 2026-09-26
- [x] T4.3 Mode toggle, banner and labels — frontend — 2026-09-26
- [x] T4.4 ✋ Checkpoint — phase 4 — 2026-09-26

### Phase 5 — Projects and Add palette
- [x] T5.0 Adding repositories later: sidebar footer and drop on every screen — 2026-09-26
- [x] T5.1 Project commands — backend — 2026-09-26
- [x] T5.2 Project view data — backend — 2026-09-26
- [x] T5.3 Sidebar project list — 2026-09-26
- [x] T5.4 Project screen — 2026-09-26
  - note: repo name links go to that repo's band on Branches (user decision 2026-09-26).
- [x] T5.5 Rename and delete — 2026-09-26
  - note: F2 renames (user decision 2026-09-26).
- [x] T5.6 Flow C: empty project (New project) — 2026-09-26
  - note: ⌘N from every screen (user decision 2026-09-26).
- [x] T5.7 Flow B: adding a row to a project — 2026-09-26
- [x] T5.8 Flow H: multi-select and selection bar — 2026-09-26
- [x] T5.9 Add palette (⌘K) — 2026-09-26
  - note: Space/↵ rules (user decision 2026-09-26).
- [x] T5.10 Project-wide review — 2026-09-26
- [x] T5.11 ✋ Checkpoint — phase 5 — 2026-09-26

### Phase 6 — Base management and stacked branches
- [x] T6.1 Base options and saving — backend — 2026-09-26
- [x] T6.2 Stacked detection — backend — 2026-09-26
- [x] T6.3 Base menu — frontend — 2026-09-26
  - note: ⌘R opens the project review and never reloads the webview (user decision 2026-09-26).
- [x] T6.4 ✋ Checkpoint — phase 6 — 2026-09-26

### Phase 7 — State labels and broken entries
- [x] T7.0 Branches: all active branches, Projects column, "Not in a project" filter — 2026-09-26
- [x] T7.1 lastKnownTip tracking — 2026-09-26
- [x] T7.2 Full entry menu — 2026-09-26
- [x] T7.3 Broken entry display and redirects — 2026-09-26
- [x] T7.4 Error label and logging — 2026-09-26
- [x] T7.5 ✋ Checkpoint — phase 7 — 2026-09-26

### Phase 8 — Settings, polish, build
- [x] T8.1 Settings: Repositories — 2026-09-26
- [x] T8.2 Settings: Behaviour — 2026-09-26
- [x] T8.3 Keyboard shortcuts and focus — 2026-09-26
  - note: ⌘[ / ⌘] match physical keys; ⌘← / ⌘→ too (user decision 2026-09-26).
- [x] T8.4 Performance check — 2026-09-26
- [x] T8.5 Read-only audit — 2026-09-26
- [x] T8.6 Visual QA — 2026-09-26
- [x] T8.7 Production build and README — 2026-09-26
  - note: on first launch macOS asked for ~/Desktop access; the first scan waited for it.
- [x] T8.8 ✋ Final checkpoint — 2026-09-26

### Phase 9 — Later additions
- [x] T9.1 Review: jump between changes (flow D4) — 2026-09-26
- [x] T9.2 ✋ Checkpoint — phase 9
- [x] T9.3 Review: Split / Unified and Ignore whitespace (flows D5–D6) — 2026-09-27
- [x] T9.4 Settings: Keyboard shortcuts section and ⌘, — 2026-09-27
  - note: no "Select several rows" row; the app has no ⌘/⇧-click multi-select.
- [x] T9.5 ✋ Checkpoint — T9.3–T9.4
- [x] T9.6 Review: one commit's changes (flow D7) — 2026-09-27
- [x] T9.7 ✋ Checkpoint — T9.6

### Unplanned work (done on request, outside the task list)
- [x] `pnpm release` script and ad-hoc signing — 2026-09-26
- [x] Help › Show Logs in Finder and step timings in the log — 2026-09-26
- [x] Performance for large repositories (merged state, working-tree cache, progressive scan) — 2026-09-26
- [x] Help › Discuss on GitHub / Search or Report an Issue on GitHub; View › Font Size — 2026-09-27
- [x] Homebrew tap (`gokberkakdeniz/homebrew-tap`) and release upload — 2026-09-27
