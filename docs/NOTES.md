# Notes

Things to look at later, so they are not forgotten. Not tasks yet: when one is decided, it becomes
a task in `docs/TASKS.md` (or is dropped) and leaves this file.

- **Menu items still shown disabled** (2026-10-16). SPEC §7 now leaves out items that cannot be
  used; the ones disabled before that rule were kept. While a git action runs: the Sync group
  (Fetch, Pull, Push, Force Push, Rebase), Continue / Abort, Delete Branch, Checkout, the Remote
  Branches menu (hiding these makes them vanish for a few seconds). By state: Amend Commit…
  (a commit running or mid-operation), Discard All Changes (no files), Stash All Changes
  (nothing to stash), Project's missing-folder item, History's item disabled without a scan.
  Proposal: keep the first group disabled, leave out the second.
- **Tags** (2026-10-17). Tags are read (base choices in the Base menu, pills on Review's commit
  rows), created and deleted (the commit menu's Create Tag… and Delete Tag…, the latter on the
  remote too). To think about: pushing one (`git push origin <tag>`; tags are not pushed with
  the branch), a git action (SPEC §0, §10).
- **Hunk buttons in the diff gutter** (2026-10-19). VS Code's diff editor shows Revert (↶) and
  Stage (+) beside each hunk. Monaco 0.57 has the gutter menu (`renderGutterMenu`) but only with
  Revert Block, and only when the modified side is writable (ours is `readOnly`); Stage comes
  from VS Code's git extension via `MenuId.DiffEditorHunkToolbar`, which standalone Monaco does
  not expose (only through internal ESM modules, which may break on upgrades). Sturdier: our own
  glyph-margin / overlay widget per hunk from `getLineChanges()`, wired to the picked-lines
  stage/unstage (`79f1a20`); Revert would be a git action (SPEC §0, §10).
- **More in the commit menu** (2026-11-14). GitHub Desktop has them: Reset to Commit (the branch
  back to it; soft / mixed / hard to decide), Checkout Commit (a detached HEAD). Each a git
  action on the existing pattern. Further: reordering commits by dragging and rewording one,
  beside Squash.
- **Viewed files** (2026-11-14). Marking a file of a review as viewed, with a count of what is
  left; where the marks live and when a changed file loses its mark are open.
- **Notes on lines** (2026-11-14). A local note on a diff line, and copying all of a review's
  notes at once (with their `@path:line` references) to hand to an agent.
- **Blame and file history** (2026-11-14). Neither exists: who last changed a line, and the
  commits of one file.
- **Image diffs** (2026-11-14). A binary file only says so today; images could show side by
  side.
- **Comparing two refs** (2026-11-14). Two branches or two commits against each other, not only
  a branch against its base.
- **Conflicts** (2026-11-14). In a conflicted file: take ours, theirs or both, and opening it in
  an external merge tool. Today Review only lists the files and offers Continue / Abort.
- **Merge** (2026-11-14). Merging another branch into the open one; only Rebase on base exists.
- **Background fetch** (2026-11-14). Fetching on an interval. SPEC §5 Settings says there is no
  refresh interval on purpose, so this would change that decision.
- **Pull requests** (2026-11-14). A branch's pull request: its state and checks, and a link to
  open or create one. Needs the host's API or `gh`.
- **Ignore a file** (2026-11-14). "Add to .gitignore" in Uncommitted's file menu. It writes a
  file in the worktree, not the repository: to decide whether that is a git action.
- **Stash picked lines** (2026-11-14). As staging picked lines, but into a stash.
- **Command palette** (2026-11-14). Change Base… and Fetch of a whole project are not in it
  (SPEC §5 "Command palette").
- **More from the AI providers** (2026-11-14). A summary of a review, or a pull request
  description, from the provider that writes commit messages.
- **Many tags on a commit** (2026-11-14). The list under a stacked tag pill cannot scroll (the
  pointer cannot enter it), so a commit with dozens of tags gets a long one. Option: show the
  first few and `+N`.
