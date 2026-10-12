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
- [x] (on request) Leaner UI text: Branches subtitle `N repos · M branches · K stashes`, band
  count as a bare number, no base-row icon; no keyboard hints in subtitles or under fields; the
  Project one-entry card removed; shorter Review subtitles, base banner, nav tooltips, History
  fetch tooltip, delete confirmation, Settings hint and update tooltip; entry menu notes cut to
  a few words ("Not checked out", "Branch deleted", …) — 2026-10-05
- [x] (on request) Sync of one branch (W4a): Fetch / Pull / Push as git actions (`fetch --all
  --prune`, `pull <remote> <branch>`, `push [--set-upstream] <remote> <refspec>`, never forced)
  in the History header and the branch menus (Branches, Project, Review); `EntrySummary.upstream`
  / `HistoryPage.upstream` (↑/↓ against the remote) shown in Review on group line 2, the entry
  bar and a dashed upstream line in the commit list; diverged banner with "Pull (rebase)" in
  History; a failed sync opens its output panel — 2026-10-05
  - note: git CLI rather than libgit2, so SSH agents, credential helpers and hooks work as in the
    terminal. User decision: no buttons in Review's header and no multi-entry sync; no shortcuts
    or force-with-lease.
- [x] (on request) Review and History headers in one order: the page's controls, then a ⋮ page
  menu (`PageMenu`) with "Stash" (only when there is something to stash), "Refresh" and,
  in a project review, "Edit project"; History's "Fetched" moves into Fetch's tooltip — 2026-10-05
- [x] (on request) Labels drop the trailing "…" (Change base, Drop, Apply to, Pop to, Locate,
  Import, Export, + New project, Delete project, …); only progress text keeps it (SPEC §0) —
  2026-10-05
- [x] (on request) Releases are signed with Developer ID and notarized: `release.sh` takes the
  certificate from the keychain and notarizes with the App Store Connect API key in
  `~/.private_keys` (no password on the command line), and checks the signature, the stapled ticket and Gatekeeper
  before uploading; the cask no longer strips the quarantine flag (SPEC §12) — 2026-10-06
- [x] (on request) The window can be dragged by its top 52px while a modal is open; the output
  panel's Copy (was "Copy output", and its typing hints are gone) and Copy SHA turn into ✓ "Copied" for 1.5 s (`useCopy`); the output panel gets a Close (far
  left) and the Add palette a Cancel in their footers; Review's page menu has "Open history" and
  History's "Open review", both ⌥H, going back instead when the other page is the one just
  before — 2026-10-06

### Phase 21 — Release notes
- [x] T21.1 `CHANGELOG.md` and release notes in `pnpm release` — 2026-10-06
  - note: the changelog also has 0.1.16, released before this task.
- [x] T21.2 Design: release notes in Software Update, What's New window — 2026-10-06
  - note: U1's Available and Downloading cards show notes (440px); U2 What's New is a new
    board (`FlowU2`, light twin `FlowU2Light` on the canvas only, like the other light twins).
- [x] T21.3 ✋ Checkpoint — release notes design — 2026-10-06
- [x] T21.4 Release notes in the app — 2026-10-06
  - note: the running version comes from `package.json` (bundled), not an IPC call.
- [x] (on request) After an update the new version comes to the front focused: it is relaunched
  with `open -n` (a second `Command` exception, `updates.rs`) instead of `app.restart()`, and the
  window takes focus when first shown — 2026-10-06
- [x] (on request) The Gitgel menu follows the macOS HIG: About Gitgel, then Settings… and Check
  for Updates… in their own group ("…" where the command asks for more; in-app labels still
  never end in "…", SPEC §0); What's New moved to the top of Help; About Gitgel opens the app's
  own About window (`AboutModal`, canvas U3) with the version, build time, What's New and Report
  an Issue — 2026-10-06
- [x] (on request) About Gitgel, Software Update and What's New are windows of their own, not
  modals (`windows.rs`, `src/windows/`): overlay title bar, Esc / ⌘W close, About and Software
  Update fit their content; each opens hidden and shows itself once drawn (no white flash; the
  main window now does the same at launch); they are
  children of the main window, which is blocked while one is open (`AuxBlocker`) — 2026-10-06
- [x] T21.5 ✋ Checkpoint — phase 21 — 2026-10-06

### Phase 22 — SSH passphrase
- [x] T22.1 Design: the Passphrase dialog — 2026-10-06
  - note: on the canvas page "Branch actions" (S1–S3, `FlowS1.dc.html`), not the WIP page.
- [x] T22.2 ✋ Checkpoint — passphrase design — 2026-10-06
- [x] T22.3 Passphrase prompt, Keychain and preloading — 2026-10-06
  - note: the passphrase is saved when the run ends without ssh asking again, not at Continue,
    so a wrong one is never handed to ssh-add (which would ask again forever; it also stops
    after 10 s).
- [x] T22.4 ✋ Checkpoint — phase 22 — 2026-10-06
  - note: checked on the user's Mac with a Fetch and with a user script.
- [x] (on request) "Rebase on <base>" in the branch menus' sync group: a checked-out branch onto
  its base (custom or default), from the base's remote when it has one there (`git pull
  --rebase <remote> <base>`, like `gupom`), else `git rebase <base>` (`git_rebase_on_base`);
  the canvas's W4c moved from the WIP page to "Branch actions" as R1 (`FlowR1.dc.html`) —
  2026-10-06
- [x] (on request) Right-click a file row in Review and History (commit, Uncommitted, stash) opens
  a menu: Open in Finder (file selected) and Open in each installed editor (`open_file`) —
  2026-10-07
  - note: canvas board D11 (`FlowD11.dc.html`).
  - note: an editor opens the file at the diff's cursor line and column when the row is the file shown (URL scheme, Sublime: its `subl`).
- [x] (on request) History's ⋮ menu: Open review and Refresh, then the branch menu's items (Copy
  branch name, open items, Rebase on <base>, Scripts, note) — 2026-10-08
  - note: canvas board Hi4 (`HistH5.dc.html`).
- [x] (on request) Right-click in the diff: Copy relative / absolute reference (`@path:12-13`, the
  selected lines else the clicked one) and Copy / Open permalink (GitHub, at a commit) to hand to an agent — 2026-10-08
- [x] (on request) Commit in History: Uncommitted's files have boxes (git's index as the start), a
  summary / description form under the list, hooks run in the worktree; a failed commit keeps the
  message, opens the output with Commit without hooks and Retry (`git_commit`, `get_staged_paths`) —
  2026-10-08
  - note: canvas boards Hi5–Hi7 (`HistH6`–`HistH8.dc.html`), moved from the WIP page (W1a, W1c, W1d).
  - note: the pill and notes say "commit failed" (not "hook failed"): a refusal that is not a hook
    looks the same from outside; the toast is the usual “Running “Commit”…”, without a hook name.
- [x] (on request) Review: switching mode keeps the file on screen when the new mode lists it, and
  between Uncommitted and All the diff keeps its place in the file — 2026-10-09
- [x] (on request) Force push (`--force-with-lease`) for a diverged branch: in the branch menus'
  sync group and History's diverged banner (`git_push` takes `force`) — 2026-10-09
  - note: canvas board R1 (`FlowR1.dc.html`).
- [x] (on request) Right-click in the diff also has Open in Finder and Open in each editor, at the
  clicked line — 2026-10-09
  - note: canvas board D11 (`FlowD11.dc.html`, `menu: diff`).
- [x] (on request) Shortcuts work while the diff has focus: ⌥H, and ⌘← / ⌘→ for Back / Forward
  (Monaco's hidden textarea no longer counts as a text field) — 2026-10-09
- [x] (on request) Branch review header as History's: title "Review", subtitle `<repo> · <branch>
  · <~worktree>`; project review subtitle `N repos · M branches` (was `X of Y changed`); the
  Uncommitted layer's warning banner is gone (branch and project); canvas Diff, P7 — 2026-10-09
- [x] (on request) Branches lists remote-tracking branches with no local twin while filtering
  (`RepoScan.remotes`; a row opens its History); History's branch picker and `get_history_refs`
  are gone; canvas K2, Hi2–Hi5 — 2026-10-09
- [x] (on request) Branches: repo bands and stash lists collapse while filtering too; that state
  is not remembered and is dropped when the filter is cleared; the filter applies 150 ms after the
  last keystroke — 2026-10-09
- [x] (on request) Shared components instead of copies: `PageHeader` for Review and History,
  `ConfirmModal` (Delete project, Remove repository, Drop stash, Run), `Stepper`, `IconTile`,
  `Menu` dot / arrow / accent items (Branches' projects menu), Review/parts' `FileBar`, `DiffStat`,
  `StashSection` and `parts.module.css` (History no longer imports Review's CSS), `CopyBranchItem`,
  `openHistory`; canvas: `Stepper`, `KindBadge`, `ConfirmModal` boards mounted by the screens, Hi3 /
  Hi4 mount Hi2, R1 mounts D11, P5 mounts P1 — 2026-10-09
  - note: the canvas's kind badge is 18px (SPEC) instead of 17px and its commit stepper 24px
    tall instead of 22px, as the app draws them.
- [x] (on request) History commit header: subject, body and meta selectable (right-click copies,
  a cross-element selection copies as one line), no parent SHA, the short SHA opens the commit on
  the remote, copy icon beside it; remote links for any host (`get_remote_url` → `RemoteInfo`,
  `open_remote_link`; GitLab `/-/`, Bitbucket `/commits` + `/src`, rest GitHub-style; was
  GitHub-only `get_github_url` / `open_github_link`) — 2026-10-09
- [x] (on request) History opens on Uncommitted when the branch has uncommitted changes, else the
  newest commit — 2026-10-09
- [x] (on request) Discard, as GitHub Desktop (its texts word for word): Uncommitted files picked
  with ⌘ / ⇧-click in Review and History, a right-click menu (Discard Changes… / Discard N Selected
  Changes…, Include / Exclude Selected Files in History, Copy (Relative) Paths, open items), History's
  Uncommitted row menu (Discard All Changes…, Stash All Changes…), Confirm Discard Changes; a copy
  of each file goes to the Trash first (`trash.rs`), then `git restore` / `git clean` as a git
  action (`git_discard`); Settings › Prompts turns the confirmations of Remove repository,
  Discard, Drop stash and Delete project off, and each of them has "Do not show this message
  again" — 2026-10-09
  - note: canvas boards Hi8 (`HistH9`), D12 (`FlowD12`), M6 (`FlowM6`), moved from the WIP page
    (W4d, W4b, W4e); W4b's backup stash was dropped for the Trash copies.
- [x] (on request) UI copy follows Apple HIG: buttons/menus/list actions in title case with a verb
  first, "…" on items needing more input (Add Repository…, Change Base…, Stash…,
  Delete Project…, Import…, Export…, Locate…), sentence case for hints/tooltips/descriptions;
  SPEC §0 updated — 2026-10-09
- [x] (on request) Settings › Scripts drops its two hint lines, the script editor its Name, Command and Inputs hints; Show when gets a "CEL Syntax" link to the CEL spec and shows "Matches N branches" with a ? listing them; Open the output panel and Ask before running are plain checkboxes — 2026-10-09
- [x] (on request) Operations in progress (flow T): a rebase / merge / cherry-pick / revert stopped in a worktree, from Gitgel or not, stays on its branch's row with a `rebasing 2/4` pill; Review gets a banner per entry with Abort (asks first, Settings › Prompts) and Continue (stages the resolved files; disabled while markers remain); the branch menus swap Sync for Continue / Abort; the watcher follows MERGE_HEAD and rebase-merge/ — 2026-10-10
  - note: after the first try (user feedback): the banner names the entry as the entry bar does, says where it paused (commit N of M, SHA and subject), links the conflicted files and says what Continue does next; the conflicts pill's tooltip names the files
  - note: then (user feedback, GitHub Desktop as reference) the banner became one line (`Resolve conflicts to continue rebasing <repo> <branch> <folder> (1/6)`, `Continue rebasing …` once resolved), the conflicted files get ⚠ / ✓ in the file list and Review opens on them; History shows the banner without the names
- [x] (on request) Sidebar resizable (drag its right border, 200–400px, remembered; double-click resets) — 2026-10-10
- [x] (on request) History list resizable (drag its right border, 280–640px, remembered; double-click resets) — 2026-10-10

### Phase 23 — Commit message generation
- [x] T23.1 Generate message backend — 2026-10-10
- [x] T23.2 Generate message in the commit form — 2026-10-10
- [x] T23.3 ✋ Checkpoint — message generation — 2026-10-11

### Phase 24 — AI settings
- [x] T24.1 AI settings backend — 2026-10-10
- [x] T24.2 Settings › AI — 2026-10-10
- [x] T24.3 Commit form on the config — 2026-10-10
- [x] T24.5 Provider list, toggles and edit modal — 2026-10-10
- [x] T24.6 Prompt editor, row states, no binary notes — 2026-10-10
- [x] (on request) Output panel shows the running command (`ScriptRun.command`: user script or git action's fixed command) under its header; SPEC §14 and `FlowN4.dc.html` — 2026-10-10
- [x] (on request) Commit form's provider menu only generates with the picked provider; the default changes in Settings › AI alone — 2026-10-10
- [x] (on request) No stored default provider: the bolt uses the topmost switched-on provider in menu order (`settings.ai.provider` gone, old files still load) — 2026-10-10
- [x] (on request) Sandboxed generation: Antigravity runs with `--sandbox`, Claude with `--permission-prompts none` (Codex already read-only; opencode and Cursor have no such flag) — 2026-10-10
- [x] (on request) History base line is just `base <branch>`: the `Below: already in <base>` sub and the merge-base SHA are gone — 2026-10-10
- [x] (on request) Smooth list reordering: the dragged row follows the pointer while the others glide aside, an accent line marks the drop slot, Escape cancels, lists auto-scroll at the edges — 2026-10-10
- [x] (on request) Sidebar visibility is remembered in the config (`settings.sidebarVisible`); Review and History leave it as it is — 2026-10-10
- [x] T24.4 ✋ Checkpoint — AI settings — 2026-10-11

### Phase 25 — Multi-language support (en + tr)
- [x] T25.1 i18n infrastructure — 2026-10-11
- [x] T25.2 Backend: `settings.language` — 2026-10-11
- [x] T25.3a String extraction + translation package — 2026-10-11
  - note: 786 keys; MF2 selects need `.input {$n :string}` + bare `.match $n` in messageformat 4.0.0, and expression-first variants carry one leading space (stripped by `t()`); literal `{`/`}` impossible in patterns (`{patch}` goes through a var); banner lead became single-sentence keys (the mono ref span is gone).
- [x] T25.3b Translation — 2026-10-11
  - note: no Antigravity subagent available; translated by hand instead (Turkish dev tone: dal/repo/stash/commit kept or translated per key; Discard + file-menu texts copied verbatim per TRANSLATE.md).
- [x] T25.3c Verification — 2026-10-11
- [x] T25.4 Settings › Language + reload — 2026-10-11
  - note: unknown `language` values read as `system` (lenient, like `diffContextLines`); the route stack persists in `sessionStorage` for the reload; aux windows sync the locale on load.

### Phase 26 — Appearance settings
- [x] T26.1 Appearance: Theme move, Formatting, Diff tab size — 2026-10-11
  - note: counts use `$n` (raw selector) + `$d`/`$e` (display) in MF2 keys; `t()` strips one leading space (messageformat 4.0.0 `{{{` quirk); the operation banner lead is one sentence now (mono ref span gone); Discard + file-menu texts stay English verbatim; the design canvas still needs the Appearance artboards.
- [x] (on request) Turkish git terms follow VS Code's Turkish language pack (depo, dal, çalışma ağacı, geçici kayıt, getir / çek / gönder, yeniden temellendir…; commit stays); glossary in `src/i18n/TRANSLATE.md` — 2026-10-11
- [x] (on request) No "· next file <name>" beside Review's change counter; the accent ↓ and its tooltip say it — 2026-10-11
- [x] (on request) The commit form's generate control is a 24px ✦ (`sparkles`) at the end of the summary field (right-click picks the provider); Settings › AI and generation runs use `sparkles` too — 2026-10-11
- [x] (on request) Git actions and generations show in the UI language and say what they do while running ("Pushing…", "Committing…", "Generating a commit message with <provider>…"); scripts keep "Running “<name>”…" — 2026-10-11
- [x] T26.2 ✋ Checkpoint — phases 25–26 — 2026-10-11
- [x] (on request) Canvas: M7 Settings › Appearance and M8 Settings › AI boards, L3 shows Appearance, the format selects list every choice — 2026-10-11
- [x] (on request) Memory: the merged walk reads a commit's date every 1024 commits instead of every commit, and the app launches with `MallocLargeCache=0` (`Info.plist` LSEnvironment) so freed memory goes back to macOS (bench repos, cold scan: peak 294 → 248 MB, 147 → 38 MB after it; vscode merged walk 1.6 → 0.75 s) — 2026-10-11
- [x] (on request) Memory: Monaco loads without its TypeScript, CSS, HTML and JSON language services (`src/monaco/monaco.ts`; only the editor worker; JSON keeps its tokenizer); hovers and folded-region breadcrumbs from those services are gone (frontend assets 16.2 → 6.4 MB; WebContent with TS, JSON and CSS diffs opened ~260 → ~190 MB) — 2026-10-12
- [x] (on request) Commit form: the ✦ generate button is hidden, not disabled, when no provider is switched on and installed — 2026-10-12
- [x] (on request) Sidebar footer: too narrow for "N repositories", the row hides and the "+" always shows — 2026-10-12
- [x] (on request) Release notes: New / Improved / Fixed defined (a new detail or control in an existing panel or setting is Improved); a feature new in the release gets one line, without its own fixes and tweaks; lines most important first, no control icons, no tiny details (`.claude/agents/changelog-writer.md`, §12) — 2026-10-12
- [x] (on request) Generate with Codex: the message is only Codex's answer block, not its banner, prompt and warnings — 2026-10-12
- [x] (on request) Project page (and a project's Review): the header around the title drags the window; only the title's text renames — 2026-10-12
- [x] (on request) Review's not-pushed line reads only "above: not pushed"; the upstream name is gone from it — 2026-10-12
- [x] (on request) Branches: each repo band has a Fetch button (hover, before the count) for a repo with a remote — 2026-10-12
- [x] (on request) Output panel: the sub line keeps the repo whole, branch and folder share the rest equally (ellipsis when long), each part copies on click — 2026-10-12
- [x] (on request) Generate with Cursor runs with `--trust`, so its workspace trust prompt no longer ends the run — 2026-10-12
- [x] (on request) Review entry bar: a long branch name ends in an ellipsis instead of running under the ahead / upstream text — 2026-10-12
- [x] (on request) Menus: an item's label stops at two lines and ends in "…" (long script names break anywhere; the whole name as tooltip) — 2026-10-12

---

## Open

No open tasks.
