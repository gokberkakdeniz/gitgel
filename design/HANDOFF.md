# Gitgel — design handoff

Read this before building any UI. It is the source of truth for look and behaviour.
The original product spec (`docs/SPEC.md`) has been retired; its still-valid parts now live in
`docs/TASKS.md`. **Where TASKS.md and this file disagree, this file wins** (section 4 records
what changed from the original spec).

Reference markup for every screen is in `design/screens/`. Those files are in a
design-tool format (`.dc.html`: HTML with `{{holes}}`, `<sc-for>`, `<sc-if>` and a small
`renderVals()` script). They will not render standalone. Read them for exact colours,
sizes, spacing and copy; do not copy the template syntax into the app.

| File | Screen |
|---|---|
| `Sidebar.dc.html` | Left sidebar (shared component) |
| `Main.dc.html` | Branches (was "Inbox") + its popovers, empty state, add-repo sheet, drop overlay, selection bar |
| `Diff.dc.html` | Review screen (project scope and single-branch scope) |
| `Projects.dc.html` | Project screen + rename, delete, entry menu states |
| `Palette.dc.html` | Add palette (⌘K) |
| `Settings.dc.html` | Settings |

---

## 1. Visual system

Dark only. Warm near-black neutrals, one cool accent.

### Colour tokens

| Token | Value | Use |
|---|---|---|
| `bg.sidebar` | `#0e0d0c` | Sidebar, review file list (left side is always darker than right) |
| `bg.main` | `#141311` | Main content, review header, diff panes |
| `bg.sunken` | `#1a1917` | Inputs, sub-headers (file header bar), modal footers |
| `bg.band` | `#1c1b18` | Repo group header band on Branches |
| `bg.elevated` | `#211f1c` | Popovers, menus, modals, secondary buttons |
| `bg.hover` | `#2a2825` | Hovered / selected rows inside popovers and lists |
| `bg.sidebarActive` | `#24221f` | Active sidebar item |
| `bg.pressed` | `#383631` | Active segmented button, open menu trigger |
| `border` | `#302e2a` | Default 1px borders |
| `border.row` | `#262420` | Row dividers |
| `border.strong` | `#383631` | Band top edge, elevated button borders |
| `text.strong` | `#faf9f5` | Titles, branch names, primary text |
| `text.code` | `#e0ddd6` | Diff code |
| `text.body` | `#d8d4cc` | Body text |
| `text.muted` | `#a09d96` | Secondary text, labels, counts |
| `text.faint` | `#75726b` | Line numbers, "—" placeholders only (not for readable text) |
| `accent` | `#4f8fa3` | Primary button fill, focus ring, checkboxes, key icons. Text on it: `#141311` |
| `accent.text` | `#7fb3c4` | Links, SHAs, "● N changed", text actions |
| `accent.hover` | `#a3cad6` | Link hover |
| `focus.ring` | `1px #4f8fa3` + `0 0 0 3px rgba(79,143,163,0.25)` | Focused inputs, active base button |
| `success` | text `#8fcf9c` on `rgba(93,184,114,0.14)` | merged |
| `warning` | text `#e8c071` on `rgba(212,160,23,0.14)` | detached HEAD, base missing, "commits from another branch" |
| `danger` | text `#ee9a90` on `rgba(198,69,69,0.16)` | deleted, repo missing, destructive menu items |
| `danger.fill` | `#c64545`, white text | Delete confirm button |

Diff colours:

- Added line: `rgba(93,184,114,0.15)`, marker `+` in `#8fcf9c`.
- Removed line: `rgba(198,69,69,0.17)`, marker `−` in `#ee9a90`.
- Filler on the opposite side: `repeating-linear-gradient(135deg, #1c1b18 0 4px, #141311 4px 8px)`.
- Folded hunk row: `#1a1917`, text "⋯ N unchanged lines" in `text.faint`.

File-kind badges (18px square, radius 5, mono 10px): A `#8fcf9c`/green tint, M `#e8c071`/amber tint,
R `#93b8ee`/`rgba(90,140,220,0.16)`, D `#ee9a90`/red tint, U (untracked) `#c5b2f2`/`rgba(160,130,230,0.16)`.

Build Monaco's diff theme from these tokens.

### Type

| Role | Font | Size |
|---|---|---|
| UI text | Instrument Sans (400/500/600) | 13px default, 14px sidebar and empty-state body |
| Page titles | Source Serif 4, weight 400, letter-spacing −0.3px | 22px; review header 18px; settings sections 18px; empty-state titles 28px |
| Code, branch names, paths, SHAs, counts, shortcuts | JetBrains Mono | 12–13px; diff 12px / 20px line height |
| Section labels | Instrument Sans 11px, 500, uppercase, letter-spacing 0.06em | `text.muted` |

Bundle the fonts locally; the app is offline-first.

### Shape and size

- Radius: 8 buttons, inputs, rows · 10 segmented control · 12 popovers, menus, cards · 16 modals and palette · 9999 pills.
- Sidebar 260px wide. Page header 64px (review header 56px).
- Buttons 32px high (empty-state primary 40px). Sidebar rows 40px. Review file rows 30px.
- Popover shadow `0 16px 40px rgba(0,0,0,0.45)`; modal shadow `0 24px 60px rgba(0,0,0,0.5)`; modal scrim `rgba(0,0,0,0.5)`.
- Icons: 1.6–1.8px stroke outline SVGs. No emoji.

---

## 2. Screens

### Sidebar (`Sidebar.dc.html`)

- Top row: macOS traffic lights (native), sidebar toggle, back, forward.
- Nav: **New project** (round "+" icon), **Branches** (branch icon, count on the right).
- "Projects" label (sentence case) with search and sort/filter icon buttons, then the project list: hollow 7px circle bullet + name, no counts. Active item uses `bg.sidebarActive`.
- Footer: a 36px link row, folder icon + "3 repositories" → Settings › Repositories. On hover the row gets `bg.sunken` and a 32px "+" icon button appears on its right (aria-label "Add repository"); it opens the folder picker and then the add-repo sheet (flow A). The gear icon → Settings stays at the far right.

### Branches (`Main.dc.html`)

All active branches, whether or not they are in a project. "Active" = checked out in a worktree, or committed in the last N days (Settings) and ahead of base.

- Header: serif title, one-line subtitle, refresh button, **All / Not in a project** segmented control with counts, filter field with ⌘K hint.
  - "All" (default) lists every active branch. "Not in a project" hides rows that are in any project and repo bands left empty; the subtitle becomes "Active branches not in any project · N repos · …". Counts are computed before the text filter. The choice is remembered across launches; the sidebar "Branches" count always shows all active branches.
- Column header: [checkbox] Branch · Ahead · Files · Uncommitted · State · Projects · Age.
- **Repo band** per repo: `bg.band`, top border `border.strong`, folder icon in accent, bold repo name, mono path, "N branches" on the right. 14px gap between repos.
- **Row:** branch name (mono 13) with a sub-line "base X · worktree path" or "not checked out". Only the branch name is a link (opens single-branch review).
- The checkbox appears **only on the hovered row**. Once anything is selected, all checkboxes stay visible.
- **Projects column** (112px): shows which projects the branch is in.
  - In no project: faint "—". On the hovered row it becomes a small outlined "+ Add" in `accent.text`, which opens the project picker (flow B) under the cell.
  - In 1+ projects: a chip "1 project" / "N projects" (`bg.elevated`, 1px border, chevron); its tooltip lists the names. Clicking opens a menu: section label "In N projects", one row per project (hollow dot + name + "→", goes to that project), divider, "+ Add to another project…" in `accent.text` (opens the picker).
  - The separate "+ Add to project" button at the end of the row is gone.
- Row states: hover `bg.sunken`; selected `rgba(79,143,163,0.10)`; row whose picker or projects menu is open `bg.elevated`; the Projects cell is accent-filled while the picker is open and `bg.pressed` while the menu is open. Right after an add, the cell shows the new count with an accent outline for ~2s.
- Uncommitted shows "● N changed" in `accent.text`, otherwise "—".
- State pills: "merged into main" (success), "detached HEAD" (warning).

States drawn in the file (props): `popover` none/pick/new, `added` (toast), `empty`, `sheet` (with or without existing repos), `select`, `dropping` (drop overlay), `repoHover` (sidebar footer hover), `projMenu` (projects menu open), `scope` all/unassigned (filter).

### Review (`Diff.dc.html`)

One screen for both scopes:

- **Project scope** (from the project's "Review changes"): title = project name, subtitle "Project review · X of Y entries have changes".
- **Branch scope** (from a Branches row): title = branch, subtitle "repo · not in a project". Same layout, one group, no "Not in review" section.

Layout:

- Sidebar is collapsed on this screen. The header shows the traffic lights, a show-sidebar button and back.
- Header right: segmented **Committed / Uncommitted / All**, each with a count summed across the whole project; refresh button.
- **Left file list (310px, `bg.sidebar`)**, grouped **per entry** (repo + branch):
  - Line 1: collapse chevron + repo name (bold) … **base button right-aligned** ("base main ▾").
  - Line 2: branch (mono, ellipsis) … `+add −del` right-aligned.
  - If the base looks wrong (stacked branch): warning note under the header, "3 of 5 commits come from feat/job-queue…".
  - File rows: kind badge, file name, dimmed dir, +/−. Renames show "dir ← old/path".
  - Two entries from the same repo are two groups.
- **Not in review** (project scope only): entries with nothing to diff, each with a pill (merged / base missing / deleted / repo missing). Currently links to the Project screen. See open questions.
- **Right side:**
  - Entry bar: repo, branch, range (`base..branch` or the working-tree path), "N commits ahead of base".
  - Commit list for that entry. Commits that belong to another branch are shown at 60% opacity with a warning pill naming the branch.
  - File header: path + compare label ("merge-base ↔ branch", "HEAD ↔ working tree", "merge-base ↔ working tree").
  - Side-by-side Monaco diff.
- **Uncommitted mode:** the commit list is hidden and a warning-tinted banner says which working trees are shown. No refresh-interval text anywhere.
- **Base menu** (from a group's base button): filter input; **Suggested** (branch containing some of the listed commits, with the reason); **Default** (main, "current · from origin/HEAD"); **Other branches**.
- After a base change, a neutral banner says the base was saved for that branch.

Props drawn: `scope`, `mode`, `focus` (web/api; api collapses the first group), `stacked`, `base`, `baseMenu`.

### Project (`Projects.dc.html`)

- Header: serif title (double-click to rename), subtitle "N entries across M repos", refresh, "⋯" menu, **Add entries ⌘K** (secondary), **Review changes** (primary, opens project review).
- Table: Repo · Branch · Base (button, ellipsis) · Ahead · Files · Uncommitted · State · ⋯.
- Broken entries stay in the list at 60% opacity with a pill.
- **Entry menu** (on a deleted branch): "View last known state" (with tip SHA and when it was last seen), "Point to another branch…", "Copy branch name", divider, "Remove from project" (danger).
- **Project menu:** "Rename" (hint "double-click title"), divider, "Delete project…" (danger).
- **Rename:** the title becomes a serif input in place with an accent ring. Subtitle "↵ save · esc cancel". On a name conflict the ring turns red and the subtitle says "A project named "X" already exists"; ↵ does nothing.
- **Delete confirm modal:** "Delete "Name"?" · "The project and its N entries are removed from this app. Branches, worktrees and repositories are not touched." · Cancel / Delete project (danger fill).
- **Empty project:** centred serif "No entries yet", one line of copy, primary "Add branches ⌘K".
- **One entry:** an elevated card under the table, "Add related branches from other repositories ⌘K".

Props drawn: `variant` full/one/empty, `menu`, `projectMenu`, `rename` none/edit/conflict, `confirmDelete`, `fresh`, `fromSelection`.

### Add palette (`Palette.dc.html`)

- Opens over the project it adds to. There is **no project picker**; the target is implicit.
- Search input (16px), "fuzzy · all repos".
- Groups: **Worktrees**, **Active branches**, **Older · found by search** (old and merged branches only appear when searching).
- Multi-select checkboxes. Entries already in the project are disabled at 55% opacity with an "in project" pill.
- Footer: "N selected" … **Add ↵**.

### Settings (`Settings.dc.html`)

- **Repositories:** list with path, "base main" note, "path not found" pill + **Locate…** for missing ones, remove ✕; "+ Add repository…" opens the same folder picker and sheet as flow A.
- **Behaviour:** Default base order (`origin/HEAD → main → master`), Active threshold (days).
- Nothing else. The poll interval, focus refresh and git-binary sections were removed on purpose.

---

## 3. Flows

- **A · First run.**
  1. Branches is empty, with a centred "No repositories yet" and **Add repository…** (multi-folder picker) or drop folders on the window.
  2. An "Add repositories" sheet validates each folder:
     - ✓ git repo, with its detected default base;
     - ↪ worktree folder, resolved to its main repo (`git rev-parse --show-toplevel --git-common-dir`), duplicates skipped;
     - ✕ not a git repo, skipped.
  3. "Add N repositories" fills Branches.
  4. (Removed: git is read through the git2 library, so no git binary is needed and there is no
     missing-git screen.)
- **A · Adding more repositories later.** All entry points end in the same sheet.
  5. Sidebar footer: hovering "N repositories" shows a "+" button, which opens the folder picker. The row itself goes to Settings › Repositories.
  6. Drag and drop works on every screen, not only the empty state. While folders are dragged over the window: 2px inset accent border, `rgba(79,143,163,0.06)` wash and a centred elevated pill with a folder-plus icon, "Drop folders to add repositories". Dropping opens the sheet.
  7. The sheet is the same as A2. With repos already present the subtitle is "N folders selected. Repositories already in Gitgel are skipped." A folder that is already added is skipped with "Already added · skipped"; a worktree of an added repo with "Worktree of <repo> · already added, skipped". The button counts only new repos ("Add 1 repository").
- **B · Project from a Branches row.**
  1. Hover a row, then "+ Add" in its Projects cell opens a popover under the cell with a project filter, the existing projects and "+ New project…".
  2. "New project…" turns the popover into a name form in place, previewing the first entry. "Create & add ↵".
  3. The row stays in Branches; its Projects cell now reads "1 project". A toast offers **Undo** and "Open project →", and the sidebar shows the new project.
  4. The project page with one entry shows the "add related branches" card.
  5. ⌘K opens the palette in that project's context.
- **I · Which projects a branch is in.** Branches shows every active branch. The Projects column counts the projects each branch belongs to; clicking the count lists them (click to open one) and offers "+ Add to another project…". The header's "Not in a project" filter brings back the old Inbox view.
- **C · Empty project.**
  1. Sidebar "New project" immediately opens an empty project page. The sidebar shows "Untitled project" as active, and the title is in rename mode with the text selected. ↵ saves; esc discards the project and returns to the previous screen.
  2. The empty project shows "Add branches ⌘K", which opens the palette.
- **D · Review.**
  1. Project → "Review changes" opens project review (Committed).
  2. Uncommitted applies to the whole project.
  3. A Branches row opens single-branch review.
- **E · Stacked branch.**
  1. With base main, the entry shows another branch's commits, dimmed and labelled, plus the warning note.
  2. The group's base button opens the base menu with a suggestion.
  3. After choosing, only that group recomputes and the banner confirms. The base is stored **per branch**.
- **F · Broken entries.** States are labels, not errors:
  - deleted: offer the last known tip;
  - repo missing: Locate… in Settings, which fixes every entry of that repo;
  - base missing: clicking the pill opens the base menu.
- **G · Rename / delete project.** As described under the Project screen.
- **H · Project from a selection.**
  1. Select 2+ rows on Branches. A floating bar appears: "N branches selected · across M repos", **Add to project ▾**, **New project** (primary), ✕ clear.
  2. New project opens a project page with those entries and the title in rename mode, same as C1.

---

## 4. Changes from SPEC.md

These override the original spec.

1. **No agent labels.** Drop the Claude Code / Codex / Cursor / Manual tagging entirely, including the path-pattern setting.
2. **"Inbox" is now "Branches".**
3. **Base is stored per branch** (`repo + branch`), not per project entry. A base chosen in review or on the project page applies everywhere that branch appears.
4. **Projects have a stable id**; the name is display-only. Names are unique.
5. **Entries remember `lastKnownTip`** (SHA and time last seen), so a deleted branch can still show its last diff while the object exists.
6. **Review is project-wide.** One screen, files grouped per entry, one mode toggle for the whole project. Single-branch review is the same screen with one group.
7. **Settings contain only** repositories, default base order and active threshold. Refresh is event-driven: file watching (FSEvents), plus a full rescan when the window gains focus and on the manual refresh button. There is no polling. Refresh is not configurable, and no UI text mentions it.
8. **Git is read through the git2 library (libgit2)**, not the git binary. There is no binary lookup, no git setting and no missing-git screen. The git commands quoted in this file (flow A2, item 10) describe behaviour; `docs/TASKS.md` §6 lists the git2 equivalents.
9. **Worktree folders added as repos** resolve to their main repository.
10. **Suggested base** = `git for-each-ref refs/heads --merged=<branch> --no-merged=<default-base>`, ranked by how many of the listed commits each candidate contains. Read-only.
11. **Branches lists all active branches**, including ones already in projects, with a **Projects** column. This replaces the original "Inbox = not in any project" filter.

Suggested config shape:

```json
{
  "repos": [{ "id": "r_1", "path": "/Users/me/code/web-app" }],
  "branchBases": { "r_1:feat/stacked": "feat/parent" },
  "projects": [{
    "id": "p_1",
    "name": "Session auth refresh",
    "entries": [{ "repoId": "r_1", "branch": "session-token-refresh", "worktreePath": null,
                  "lastKnownTip": { "sha": "3be91a0", "seenAt": "2026-09-23T10:00:00Z" } }]
  }],
  "settings": { "defaultBaseOrder": ["origin/HEAD", "main", "master"], "activeDays": 14 }
}
```

A detached-HEAD worktree entry uses `worktreePath` instead of `branch`.

## 5. Not designed yet / open questions

- **"Not in review" in project review:** either make each row fix its problem in place, or collapse the section to one line, "N entries not reviewable · Open project". The designer recommended the one-line version; this is not decided.
- **The Branches header filter** currently opens the palette. The recommendation is to make it a real filter of the Branches list instead. Not decided.
- **Selection bar "Add to project ▾" dropdown** is not drawn; reuse the B1 popover.
- **Sidebar right-click menu** (Rename / Delete project) is not drawn; reuse the project menu.
- **Detecting renamed branches** (reflog "Branch: renamed …" or `--points-at <lastKnownTip>`) was discussed but not designed.
- **Squash merges:** "merged" detection must also catch squash merges, where the branch is not an ancestor of base. Check whether the branch's changes are already in base (e.g. `git cherry` or a tree comparison).
- **Performance:** cache diff stats per `(branch tip, base tip)` so a file-watch event only recomputes branches that changed.
- The sample data and code in the reference screens are fake. Only a few files have drawn diff content.
