# Gitgel — tasks

Work items for Gitgel, oldest first. The spec they build on is `docs/SPEC.md`; the visual
reference is `design/screens/*.dc.html`.

---

## How tasks work

The file has two parts: **Done** (one line per finished task) and **Open** (the full task
blocks, oldest first). New tasks are always added at the very end, so the to-do list is at the
bottom.

### Writing a task (design chat)

1. Update `docs/SPEC.md` first: describe the new behaviour in the sections it belongs to and mark
   it `(planned, Tn.m)` (see SPEC §0 "Keeping this file current"). Update the `.dc.html` screens
   the same way.
2. Append the task at the **end of this file**, under "Open" (replacing "No open tasks." if it
   is there), in the form below. Never insert above existing tasks, and never edit the Done
   list. A new phase starts with a `### Phase <n> — <title>` heading; follow-ups to the current
   phase continue its numbering.
3. Keep the task short: point to the SPEC sections and screen lines instead of copying them. Put
   in the steps only what the spec does not say (order of work, traps, files to touch,
   migrations).
4. End each phase (or group of tasks worth reviewing together) with a ✋ checkpoint task.

```
#### T<phase>.<n> <title>
- **Depends on:** T…
- **Why:** … (user request / feedback, date)
- **Spec:** SPEC §… "…"
- **Reference:** `<screen>.dc.html` lines …
- **Files:** …
- **Steps:**
  1. …
- **Acceptance:** …
```

### Doing a task (implementing agent)

- Take the first task under "Open"; check that its dependencies are in the Done list.
- Build it to match SPEC and the screens. When finished and the acceptance criteria hold:
  - delete the task's block from "Open" (and its phase heading once the phase has no tasks
    left there; if nothing is left, write "No open tasks.");
  - add one line for it at the end of its phase in "Done":
    `- [x] T<phase>.<n> <title> — YYYY-MM-DD`, with `  - note: …` under it only if something
    is worth remembering (a deviation, a user decision); start the phase heading there if it is
    the phase's first finished task;
  - remove the task's `(planned, Tn.m)` markers from `docs/SPEC.md`;
  - touch nothing else in either file unless the result differs from the spec (then correct the
    spec text and mention it at the checkpoint), or a new file or folder was added (one line in
    SPEC §3).
- Left half-done: keep the block and add `- **Note:** …` at its top saying where it stopped.
- A ✋ checkpoint: stop, leave the app running (`pnpm tauri dev`), tell the user what to check and
  how, and wait. Move it to Done only after the user approves.
- Work the user asks for directly in chat (not as a task) gets a line only if it is worth
  remembering: a feature, a behaviour change, a new script or workflow, a notable fix — not
  small tweaks. Add it at the end of the latest phase in Done:
  `- [x] (on request) <what> — YYYY-MM-DD`. If it changed behaviour, update SPEC too.

---

## Done

One line per finished task, in the order they were done; its details were removed when it was
done (they live in git history, and the behaviour in `docs/SPEC.md`). Work asked for in chat
rather than as a task is listed the same way, marked "(on request)".

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
- [x] (on request) `pnpm release`: build, zip and upload to GitHub releases; ad-hoc signing so
  the app opens on other Macs — 2026-09-26
- [x] (on request) Help › Show Logs in Finder — 2026-09-26
- [x] (on request) Performance for large repositories (merged state, working-tree cache,
  progressive scan) and step timings in the log — 2026-09-26
- [x] T9.3 Review: Split / Unified and Ignore whitespace (flows D5–D6) — 2026-09-27
- [x] T9.4 Settings: Keyboard shortcuts section and ⌘, — 2026-09-27
  - note: no "Select several rows" row; the app has no ⌘/⇧-click multi-select.
- [x] T9.5 ✋ Checkpoint — T9.3–T9.4
- [x] T9.6 Review: one commit's changes (flow D7) — 2026-09-27
- [x] T9.7 ✋ Checkpoint — T9.6
- [x] (on request) Help › Discuss on GitHub / Search or Report an Issue on GitHub; View › Font
  Size — 2026-09-27
- [x] (on request) Homebrew tap (`gokberkakdeniz/homebrew-tap`), published by `pnpm release` —
  2026-09-27
- [x] (on request) Docs: task list and design handoff merged into `docs/SPEC.md` — 2026-09-27

### Phase 10 — Light theme
- [x] T10.1 Light theme and Settings › Appearance — 2026-09-27
- [x] T10.2 ✋ Checkpoint — phase 10 — 2026-09-27
- [x] (on request) Docs: tasks moved to `docs/TASKS.md`; finished tasks keep one line — 2026-09-27
- [x] (on request) Light theme review: no theme flash at launch (window hidden until its theme
  and background are set), dead code removed — 2026-09-27
- [x] (on request) Memory: close pooled repositories after each full scan, file watching without
  the file-ID cache, footprint on every log line (bench repos: 353 → 107 MB after a scan, watcher
  setup +110 MB → 0; scan time unchanged) — 2026-09-27

### Phase 11 — Review file filter
- [x] T11.1 Review: filter the file list — 2026-09-27
- [x] T11.2 ✋ Checkpoint — phase 11 — 2026-09-27

### Phase 12 — Review context
- [x] T12.1 Review: changes only / whole file and lines around changes — 2026-09-28
  - note: Monaco reopened every fold after a file switch (the wrapper's setValue drops the markers
    it keeps fold state in); folding is reset after each diff and each Context change. Sticky
    scroll is off (Monaco turns it on when nothing is folded).
- [x] T12.2 ✋ Checkpoint — phase 12 — 2026-09-28

### Phase 13 — Base: local vs origin
- [x] T13.1 Base: automatic nearest default (local vs origin), remote branches in the base menu — 2026-09-28
  - note: the unrelated case lives in its own fixture repo (`base-unrelated`): it rewrites
    `origin/master`, which the other three cases need.
  - note: after review (user decisions 2026-09-28): the base menu marks the base in use with one
    check in every section, with an Automatic row instead of the `auto` / `current` pills and the
    "Use automatic default" button; the base branch with an unrelated upstream shows its working
    tree; a branch with a stored base stays listed; a branch review keeps its one group visible.
- [x] T13.2 ✋ Checkpoint — phase 13 — 2026-09-28

### Phase 14 — Open elsewhere
- [x] T14.1 Project entry menu: Open in Finder and installed apps — 2026-09-28
  - note: a detached entry whose worktree is gone (`branch_deleted`) gets no open items; menus
    now move with ↑/↓ (shared `Menu`).
- [x] T14.2 Branches: row menu — 2026-09-28
- [x] T14.3 ✋ Checkpoint — phase 14 — 2026-09-28
  - note: user feedback: icons on the menu items (real app icons, grayscale; user decision) and a
    default terminal setting → T14.4–T14.5. Branches not checked out keep only "Copy branch
    name" (opening the repo folder would show another branch's files).
- [x] T14.4 Menu item icons — 2026-09-28
  - note: Finder is now an `OpenApp` (`finder`) and `open_folder` takes a required app id.
- [x] T14.5 Settings: default terminal — 2026-09-28
  - note: Ghostty and Warp are no longer listed on their own; they work as Other. Other runs no
    command: it names an app (opened with `open -a`), as `std::process::Command` is banned.
- [x] T14.6 ✋ Checkpoint — T14.4–T14.5 — 2026-09-28
  - note: user feedback: Other runs a command (`%` = folder), the terminal choice becomes a
    dropdown with an automatic default, open items always show (disabled, with a note) → T14.7–T14.8.
- [x] T14.7 Terminal: dropdown, Automatic, Other command — 2026-09-28
  - note: after review (user decisions 2026-09-28): terminals that are not installed cannot be
    picked in the dropdown (`get_terminal_options`); at launch a chosen terminal that is not
    installed falls back to Automatic.
- [x] T14.8 Menus: open items always listed, with a note — 2026-09-28
  - note: after review (user decision 2026-09-28): a branch that is not checked out keeps its
    buttons enabled and opens the repository folder, with a note saying so (reverses the T14.6
    decision to show only "Copy branch name").
- [x] T14.9 ✋ Checkpoint — T14.7–T14.8 — 2026-09-28
- [x] (on request) Docs: `docs/NOTES.md` handoff notes for the design assistant (stale `.dc.html`
  states, launch fallback) — 2026-09-28
- [x] (on request) Design: open-item menu states (not checked out opens the repository folder,
  repo missing, branch deleted, terminal missing) and disabled terminal options, from
  `docs/NOTES.md` (removed); canvas flows J6–J8 — 2026-09-29


### Phase 15 — Branches: compact rows
- [x] T15.1 Branches: Diff column (ahead / files / uncommitted) and checked-out icon — 2026-09-29
  - note: user decisions 2026-09-29: the column is "Diff" (tooltip Ahead / Files / Uncommitted);
    ahead shows `↑N` and `↓N` when behind the base (new `EntrySummary.behind`, from the same
    `graph_ahead_behind` call). Ahead/behind against the upstream (force-push case) is not shown.
- [x] T15.2 ✋ Checkpoint — phase 15 — 2026-09-29
- [x] (on request) Sidebar: a project with entries opens its review (sidebar kept shown), an
  empty one its page; Review header "Edit project" pencil opens the page — 2026-09-30
- [x] (on request) Sidebar: right-click Rename or double-click edits the project name inline in
  its row; double-clicking the project review title does the same — 2026-09-30
- [x] (on request) Branches: Age of a branch with uncommitted changes (staged, unstaged or
  untracked) is their newest modification time when that is newer than the tip commit (rows
  sort by it too) — 2026-09-30
- [x] (on request) In-app updates: sidebar "Update to <version>" row, Gitgel › Check for
  Updates…, Settings › Check for updates; `pnpm release` signs the update and publishes the
  tap's `gitgel/latest.json`; the cask gets `auto_updates true` — 2026-09-30
- [x] (on request) Fixtures: web-app gets six 59–96 character branch names (two differing only
  at the end, one checked out in `wt/session-cookie` with a modified file, one squash-merged)
  — 2026-09-30
- [x] (on request) Branches: only Branch and Projects columns; three-line branch cell (name cut
  in the middle, `base · diff · age` + state pill, checked-out path or "—"), equal row heights,
  24px ⋮ column, right-click opens the row menu — 2026-09-30
- [x] (on request) `Input` component (leftIcon / rightIcon, sizes, mono, invalid, clearable) for
  every text field, placeholder "Search" on search fields; replaces `TextInput` — 2026-09-30
- [x] (on request) Page headers: one height (64px), padding and action order; Review drops its
  Back while the sidebar is shown; project titles rename in place on click without moving
  — 2026-09-30
- [x] (on request) Dev builds rebuild when package.json's version changes (no false update
  offer) — 2026-09-30
- [x] (on request) Settings: VS Code-style section list (General / Repositories / Shortcuts) with
  the chosen section's settings beside it; Default base is an ordered list (↑ ↓ ✕, "+ Add branch"
  with ref-name and duplicate checks) instead of a `→`-separated text field — 2026-09-30
- [x] (on request) Design: shared components (Button, Segmented, Pill, Checkbox, Select, Menu,
  Toast, ModalHeader, ModalFooter, SettingsNav) as canvas artboards with a variants board each
  on the Components page, mounted by the Flow and Scripts screens; code follows in T16.1 — 2026-10-04
- [x] (on request) Menus and popovers too tall for the window scroll inside it instead of being
  cut off; script editor's Save needs at least one Show in menu — 2026-10-04

### Phase 16 — Shared components
- [x] T16.1 Shared components from the design — 2026-10-04
  - note: `Select` is the native form only; the listbox trigger (script inputs) comes with the
    Scripts work. Settings' Remove repository dialog keeps the Delete project layout (title, text,
    actions), not `ModalHeader` / `ModalFooter`.
- [x] T16.2 ✋ Checkpoint — phase 16 — 2026-10-04

### Phase 17 — Scripts
- [x] T17.1 Script config, Settings › Scripts, import and export — 2026-10-04
  - note: "+ New script" and ✎ are disabled until the editor (T17.2). Reorder is a pointer drag on
    the handle (HTML5 drag and drop is not used), and ↑ / ↓ on the focused handle.
- [x] T17.2 Script editor and Show when — 2026-10-04
  - note: CEL via `@marcbachmann/cel-js` 8.0.0 (no dependencies). Input conditions see
    `inputs.<id in lower case>`. "Try on <branch>" is disabled until T17.3/T17.4.
- [x] T17.3 Running scripts (backend) — 2026-10-04
  - note: `scripts.rs` became `scripts/mod.rs` + `scripts/run.rs`. `run_script` takes a
    `context` (base, project) besides the entry. The ⌘Q / window close guard is not tried by hand
    yet (T17.5).
- [x] T17.4 Scripts in the branch menus and the run toast — 2026-10-04
  - note: until T17.6 a script with inputs runs with the defaults of its shown inputs, and
    "Ask before running" has no dialog yet; "Show output" is hidden until T17.7. A repo that is
    missing disables every script.
- [x] T17.5 ✋ Checkpoint — scripts run — 2026-10-04
  - note: user feedback: a quick script stayed on the running toast (its end arrived before the
    start was answered; fixed); the output panel was missed, so T17.7 is done before T17.6 (user
    decision 2026-10-04).
- [x] T17.7 Output panel — 2026-10-04
  - note: done before T17.6 (user decision). `@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0; a
    panel script opens its panel as it starts; new `resize_script` and chunk offsets
    (`end` / `bufferedEnd`).
- [x] T17.6 Run dialog: inputs and Ask before running — 2026-10-04
  - note: the backend saves the last input values on Run (`scriptInputValues`). ⌘↵ is listed in
    Settings › Shortcuts under Lists and dialogs.
- [x] T17.8 ✋ Checkpoint — phase 17 — 2026-10-04
  - note: user feedback: Select options could not take a new line (fixed); Save now needs a Show in
    menu; turning a script off became T17.9.
- [x] T17.9 Turn a script off — 2026-10-04
  - note: `disabled` is always written (no `skip_serializing_if`), so the frontend type stays a
    plain boolean; a missing field still loads as on. The menu filter is `menuScripts` in
    `src/scripts/when.ts`.
- [x] T17.10 ✋ Checkpoint — turning scripts off, one run mode — 2026-10-04
- [x] (on request) Entry menus have one warning note, at the very end after a divider; not checked
  out: "Not checked out in a worktree, so some items may be unavailable." Items that cannot be
  used (open items, scripts) are left out instead of disabled; an empty Scripts group has no
  label — 2026-10-04
- [x] (on request) Script run toasts have a ✕ that dismisses them; the script keeps running
  — 2026-10-04
- [x] (on request) Output panel: the folder moved from the footer to the header's sub line
  (`repo / branch · folder`), like the run dialog — 2026-10-04
- [x] (on request) One run mode: every script runs in a pty and shows a toast that opens its
  output panel when clicked (no "Show output" link); the editor's Output choice became "Open the
  output panel automatically" (`openOutput`); "Try on <branch>" removed; the pipe runner
  (`spawn_plain`) is gone, so `scripts/run.rs` no longer uses `std::process::Command` — 2026-10-04
  - note: a script that asks a question now waits for an answer in its panel instead of reading
    EOF. Scripts were never released, so a saved `output` is not migrated. portable-pty's signal
    text ("Interrupt: 2") is turned into "SIGINT".
- [x] (on request) "Ask before running" with nothing to fill in is a short confirmation (O3)
  instead of an empty run dialog — 2026-10-04
- [x] (on request) A run's toast is hidden while its output panel is open; closing the panel
  while it runs brings the toast back — 2026-10-04
- [x] (on request) Dev: a change to a store module (`state/*.ts`, `scripts/runs.ts`) reloads the
  page instead of hot-swapping it, which left the event listeners on the old store (runs stuck
  on running) — 2026-10-04
- [x] (on request) An input's Show when is a mono textarea like Options, with a "+ Variable"
  menu (branch fields and the inputs above it) — 2026-10-04
- [x] (on request) Script name field: the icon picker moved to the left, a "+ Variable" menu
  (`{branch}`, `{base}`, `{repo}`) on the right; `Input` takes a `leftText` control — 2026-10-04
- [x] (on request) The script command grows with its text (up to 360px) and can be dragged taller
  (`src/lib/useAutoGrow.ts`) — 2026-10-04

### Phase 18 — Shared List
- [x] T18.1 `List` component and the Pill `outline` tone — 2026-10-04
  - note: the variants are checked on a dev-only page (`pnpm dev`, `/#list` or `/#list-light`;
    `src/components/List.story.tsx`). `ListItem` takes a `key` and `rowProps` for its `<li>`
    (`data-reorder`), `List` a `listRef` and `ordered`, so T18.2 can keep `useReorder`; the grip
    is the scripts' `DragHandle`. Button and IconButton gained a 24px size for compact rows.
- [x] T18.2 Settings lists use `List` — 2026-10-04
  - note: Locate…'s error ("Not a git repository", …) is a failed toast with the picked folder,
    not a line under the row (user decision 2026-10-04). Rows now take `bg.hover` on hover like
    every `List` row (Repositories and Scripts did not before).
- [x] T18.3 ✋ Checkpoint — phase 18 — 2026-10-04
- [x] (on request) The run dialog no longer remembers input values: it always opens with the
  defaults; `scriptInputValues` is gone from the config (an old file's key is ignored and dropped
  on the next save) — 2026-10-04

### Phase 19 — Stashes
- [x] T19.1 Stashes: list and review (read-only) — 2026-10-04
  - note: user decision 2026-10-04: the read-only part first; the actions come disabled in
    T19.3, what they do in T19.4. Canvas W3 moved to the Flow page as flow P (P1–P4); P3 (stash review from Branches) is new.
    Stashes show only under a Branches band that has rows; the Review list hides them while the
    file filter has text. The fixtures gained three stashes.
- [x] T19.2 ✋ Checkpoint — stashes (read-only) — 2026-10-04
  - note: approved with the request to do T19.3.
- [x] T19.3 Stash actions, disabled — 2026-10-04
  - note: `MenuItem` gained a `title` (tooltip) for the disabled items.
- [x] T19.4 Writing stashes: what Stash…, Apply, Pop and Drop do — 2026-10-04
  - note: user decision 2026-10-04: git2 still only reads; every write is a git action, the
    user's `git` CLI with a fixed command run on the scripts' runner (login shell, pty, toast,
    output panel, rescan), in `src-tauri/src/scripts/git.rs`. New boards P5 (worktree picker)
    and P6 (Drop confirmation).

### Phase 20 — History
- [x] T20.1 History backend: pages, search, refs — 2026-10-04
- [x] T20.2 History screen — 2026-10-04
  - note: `Review/parts.tsx` holds what Review and History share (`useDiffView` for the view
    settings and ⌥V / ⌥C / ⌥W). The picked commit's files use Review's `FileRow` (`bg.hover`),
    not the canvas's accent outline. The search covers paths by a tree diff per commit, only
    for commits whose text did not match.
- [x] T20.3 Base branch always listed — 2026-10-04
  - note: the base branch's worktree is now refreshed in place by the watcher (it no longer
    asks for a rescan). A base branch already in a project shows History instead of its
    projects chip.
- [x] T20.4 ✋ Checkpoint — phase 20 — 2026-10-04
  - note: user feedback: the list label was cut off once the list scrolled (fixed).
- [x] (on request) Review's entry bar: the branch name and the base in "N commits ahead of
  <base>" open their History; the range shows only in Uncommitted or with a commit picked
  — 2026-10-04
- [x] (on request) Stash pane header on two lines (message and actions, then stash@{n} · repo /
  branch · from · age); stash messages in lists wrap to two lines; History: clicking the picked
  row folds its files, a row scrolled into view keeps 8px above it; a collapsed `List` heading
  drops its gap and Branches' collapsed stash list has equal top and bottom padding — 2026-10-04
- [x] (on request) Canvas: the Flow page split into topic pages (Ekranlar; Repos A, F; Projects
  B, C, G, H, I; Review & History D, E, Hi; Branch actions J, K, P; Settings & Scripts M, N, O);
  History boards relabelled Hi1–Hi3 so they no longer clash with flow H — 2026-10-04
- [x] (on request) Branches: the base row's menu has "Open review" (Review against its upstream)
  instead of "Open history", which its name and History button already open — 2026-10-04
- [x] (on request) Stashes after T19.4: the stash pane's Apply / Pop go straight to the worktree
  the stash's branch is checked out in (the picker only when it is not); History has Stash… and
  the branch's stashes in a section pinned under its commits; fixtures: master with changes and a
  "worker draft" stash (clean apply on master, conflict elsewhere) — 2026-10-04
- [x] (on request) Stash menu: Apply to… / Pop to… have a chevron and no second line and open
  the worktree picker beside them on hover; popovers follow their anchor on scroll and resize;
  Stash changes picks files per entry (`git stash push -- <paths>`, literal pathspecs; the
  untracked option became picking the files) — 2026-10-05
- [x] (on request) Merge conflicts shown: unmerged files are `C`, entries carry `conflicts` (a
  danger pill on Branches and in Review, a danger banner in Review, `· N conflicts` in History);
  Stash… leaves out entries with conflicts; canvas P7 — 2026-10-05
- [x] (on request) Review: the file list is resizable (drag its border, 220–640px, remembered;
  double-click resets); each entry header has a menu (⋮ in place of the +/− totals on hover, or
  right-click): "Change base…" (the base button left the header), then the Branches row menu
  without "Open review"; canvas D10 — 2026-10-05
- [x] (on request) Check for Updates… opens an in-app Software Update window (app icon, versions,
  download progress, retry) in place of native dialogs; `update-check` event and
  `check_for_updates` command — 2026-10-05
- [x] (on request) Branches: repo bands collapse (chevron; ⌥-click for all); collapsed bands
  and stash lists are remembered per repo and open while filtering; repos can be pinned to the
  top (pin button on the band, `pinnedRepos` in the config, `set_repo_pinned`); `pin` icon;
  canvas Main, Icons — 2026-10-05
  - note: pin chosen over a sort option, so the newest-activity order stays the default.

---

## Open

No open tasks.
