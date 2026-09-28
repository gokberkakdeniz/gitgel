# Gitgel — notes for the design assistant

Handoff notes for whoever edits the flows and the `.dc.html` screens next. These are user
decisions from the T14.7–T14.8 review (2026-09-28) and implementation details outside the task
blocks. SPEC already describes the built behaviour; this file says what the design screens still
get wrong and what has no visual side.

## 1. Row/entry menus: not-checked-out opens the repository folder (design is stale)

`design/screens/Main.dc.html`, row menu (lines 147–158, `renderVals()` lines 323–334).

The screen still shows the old behaviour: when `rowMenu === 'notCheckedOut'`, the open items are
disabled (`off`, line 328) and the note reads "Not checked out in a worktree, so there is no
folder to open." (line 155).

What the app does now (user decision 2026-09-28, reverses the T14.6 note in `docs/TASKS.md`):
- The open items stay **enabled** and open the **repository folder** (the user may check the
  branch out by hand).
- The warning note stays, but with new copy: "Not checked out in a worktree, so this opens the
  repository folder." Same note style (12px `warning.text`, 1.45 line height, 6px 10px 4px
  padding, 14px circle-i).
- Only a missing repo or a deleted branch disables every item. Those two cases have their own
  note copies, which the design has no variant for yet:
  - "Repository not found, so there is nothing to open."
  - "The branch was deleted, so there is nothing to open."
- When only the chosen terminal is not installed, its item alone is disabled and the note says
  "<Name> is not installed; pick another terminal in Settings."

Suggested design update: replace the `notCheckedOut` state with enabled items + the new note
copy, and add `repoMissing` / `branchDeleted` states (all items disabled + their note). The same
applies to the Project entry menu in `Projects.dc.html`, which shares the component
(`src/components/OpenItems.tsx`) but models no note state at all.

## 2. Settings terminal dropdown: uninstalled options are disabled (design is stale)

`design/screens/Settings.dc.html`, Terminal block (lines 81–103, `renderVals()` lines 209–218).

The `terminals` list (lines 86–88, 211–213) renders every option selectable. What the app does
now (user decision 2026-09-28): Terminal / iTerm2 / WezTerm options that are not installed carry
`disabled`, so they cannot be picked. Automatic and Other… are always enabled.

Suggested design update: give each entry in the `terminals` list a disabled flag (e.g. a state
where iTerm2 is missing) and pass it to the `<option disabled>`. The existing `missing` prop
variant (lines 100–102, 218: "iTerm2 is not installed; the menus show it disabled") stays for
the case where the chosen terminal is uninstalled while the app runs.

## 3. Launch fallback to Automatic (no visual side)

At launch the backend checks the stored terminal choice: an explicit Terminal / iTerm2 / WezTerm
that is no longer installed is reset to Automatic and saved (an Other command cannot be
checked, so it is left alone). There is nothing to draw; do not add a screen for it. New
plumbing, for reference: backend `get_terminal_options` command, `TerminalOption`
(`src-tauri/src/model.rs` ↔ `src/lib/types.ts`), `terminalOptions` in `src/state/data.ts`,
loaded in `src/lib/events.ts` with the open apps and on every window focus.

## 4. Other implementation details outside the task blocks

- `Settings.terminal_app` was renamed to `terminal_command` (config key `terminalCommand`) with
  no migration: the old key never shipped in a release, so old dev configs just lose the Other
  value and keep behaving as Automatic.
- During T14.7 the menus filtered out the not-installed terminal; T14.8 removed that filter and
  renders it disabled with a note instead. No trace of the filter remains.
- SPEC §9 `get_open_apps` row was corrected ("in menu order; the terminal always, `found: false`
  when missing"); the `MenuItem` disabled style (`src/components/Menu.module.css`) dims the icon
  slot to 40% per the row-menu reference.
