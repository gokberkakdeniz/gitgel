# Notes

Things to look at later, so they are not forgotten. Not tasks yet: when one is decided, it becomes
a task in `docs/TASKS.md` (or is dropped) and leaves this file.

- **Stash All Changes… in History's Uncommitted right-click menu** (2026-10-15). It opens the same
  Stash dialog as History's ⋮ › Stash, so it is a duplicate; it is there because GitHub Desktop
  has it beside Discard All Changes…. It now opens to the right of the pointer (`fc1681c`), the
  ⋮ one under its button. Options: remove it (and the `atPointer` placement with it), or open the
  dialog centred when it comes from the right-click menu. Kept for now.
- **Menu items still shown disabled** (2026-10-16). SPEC §7 now leaves out items that cannot be
  used; the ones disabled before that rule were kept. While a git action runs: the Sync group
  (Fetch, Pull, Push, Force Push, Rebase), Continue / Abort, Delete Branch, Checkout, the Remote
  Branches menu (hiding these makes them vanish for a few seconds). By state: Amend Commit…
  (a commit running or mid-operation), Discard All Changes (no files), Stash All Changes / Stash
  (nothing to stash), Project's missing-folder item, History's item disabled without a scan.
  Proposal: keep the first group disabled, leave out the second.
