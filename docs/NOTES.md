# Notes

Things to look at later, so they are not forgotten. Not tasks yet: when one is decided, it becomes
a task in `docs/TASKS.md` (or is dropped) and leaves this file.

- **Stash All Changes… in the Changes header's menu** (2026-10-15). It opens the same Stash dialog
  as Review's ⋮ › Stash, so it is a duplicate; it is there because GitHub Desktop has it beside
  Discard All Changes…. The menu opens from the header's ⋮ or a right-click, and the dialog where
  the menu was (`atPointer`). Options: remove it, or keep both. Kept for now.
- **Menu items still shown disabled** (2026-10-16). SPEC §7 now leaves out items that cannot be
  used; the ones disabled before that rule were kept. While a git action runs: the Sync group
  (Fetch, Pull, Push, Force Push, Rebase), Continue / Abort, Delete Branch, Checkout, the Remote
  Branches menu (hiding these makes them vanish for a few seconds). By state: Amend Commit…
  (a commit running or mid-operation), Discard All Changes (no files), Stash All Changes / Stash
  (nothing to stash), Project's missing-folder item, History's item disabled without a scan.
  Proposal: keep the first group disabled, leave out the second.
- **Tags** (2026-10-17). Today tags are only read: base choices in the Base menu and pills on
  Review's commit rows. To think about: creating one on a commit (lightweight or annotated),
  deleting one, and pushing it (`git push origin <tag>`; tags are not pushed with the branch).
  All three are git actions (SPEC §0, §10).
- **Hunk buttons in the diff gutter** (2026-10-19). VS Code's diff editor shows Revert (↶) and
  Stage (+) beside each hunk. Monaco 0.57 has the gutter menu (`renderGutterMenu`) but only with
  Revert Block, and only when the modified side is writable (ours is `readOnly`); Stage comes
  from VS Code's git extension via `MenuId.DiffEditorHunkToolbar`, which standalone Monaco does
  not expose (only through internal ESM modules, which may break on upgrades). Sturdier: our own
  glyph-margin / overlay widget per hunk from `getLineChanges()`, wired to the picked-lines
  stage/unstage (`79f1a20`); Revert would be a git action (SPEC §0, §10).
