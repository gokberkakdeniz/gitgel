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
- **Tags after pushing** (2026-11-21; pushing one is T28.1). Fetch brings only the tags on the
  commits it fetches and keeps a tag the remote deleted (no `--prune-tags`); pushing every tag
  at once (`git push --tags`) does not exist.
- **Hunk buttons in the diff gutter** (2026-10-19). VS Code's diff editor shows Revert (↶) and
  Stage (+) beside each hunk. Monaco 0.57 has the gutter menu (`renderGutterMenu`) but only with
  Revert Block, and only when the modified side is writable (ours is `readOnly`); Stage comes
  from VS Code's git extension via `MenuId.DiffEditorHunkToolbar`, which standalone Monaco does
  not expose (only through internal ESM modules, which may break on upgrades). Sturdier: our own
  glyph-margin / overlay widget per hunk from `getLineChanges()`, wired to the picked-lines
  stage/unstage (`79f1a20`); Revert would be a git action (SPEC §0, §10).
- **Viewed files** (2026-11-14). Marking a file of a review as viewed, with a count of what is
  left; where the marks live and when a changed file loses its mark are open.
- **Notes on lines** (2026-11-14). A local note on a diff line, and copying all of a review's
  notes at once (with their `@path:line` references) to hand to an agent. Designed on the canvas
  page "Review" (W1–W10). Decided 2026-11-21: notes are kept on this machine per repository and
  branch (never in git) and go when the branch is deleted; commit, push and merge leave them (a
  merge does not carry them to the base). A note is tied to its file and line text, not to the
  commit it was written on, so it shows in every diff with that line and survives amend and
  rebase; it turns outdated when the line's text changes, or is resolved by hand (Resolve /
  Unresolve on its card). Resolved and outdated notes count as closed: hidden by default, out of
  Copy All, removed by "Clear Resolved". The popover's List Options default to the open branch,
  sorted by date added, newest first, resolved ones left out; the others are every branch, grouped
  by file, oldest first, resolved shown. With every branch listed in a project review, references
  start where the branches' folders part (`@token-refresh/src/auth/refresh.ts:22-23`). Copy All
  and Clear All take what is listed; Clear All and Clear Resolved ask first (Settings › Prompts ›
  "Clearing notes").
- **Comparing two refs** (2026-11-14). Two branches or two commits against each other, not only
  a branch against its base.
- **Conflicts** (2026-11-14). In a conflicted file: take ours, theirs or both, and opening it in
  an external merge tool. Today Review only lists the files and offers Continue / Abort.
- **Merge** (2026-11-14). Merging another branch into the open one; only Rebase on base exists.
- **Background fetch** (2026-11-14). Fetching on an interval. SPEC §5 Settings says there is no
  refresh interval on purpose, so this would change that decision.
- **Pull requests** (2026-11-14). A branch's pull request: its state and checks, and a link to
  open or create one. Needs the host's API or `gh`.
- **Stash picked lines** (2026-11-14). As staging picked lines, but into a stash.
- **More from the AI providers** (2026-11-14). A summary of a review, or a pull request
  description, from the provider that writes commit messages.
