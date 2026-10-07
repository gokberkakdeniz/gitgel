# Changelog

## 0.1.18 — 2026-10-08

### New
- Right-click a file in Review or History for Open in Finder and editors.
- Right-click in the diff to copy a file reference.
- Right-click in the diff to copy or open a GitHub permalink.

### Improved
- Editors open a file at the diff's cursor line.
- History's ⋮ menu has the branch menu's items.

### Fixed
- The right-clicked file stays highlighted while its menu is open.
- The base branch's menu has no Rebase item.

## 0.1.17 — 2026-10-06

### New
- What's New in the Help menu, shown once after an update.
- Software Update shows what the new version brings.
- SSH key passphrase dialog, saved to the Keychain.
- Rebase a branch onto its base from its branch menu.
- ⌥H switches between a branch's Review and History.

### Improved
- About, Software Update and What's New each open in their own window.
- The window can be moved while a dialog is open.
- Copy buttons confirm the copy.
- The Gitgel menu follows macOS: Settings… and Check for Updates… sit under About.

### Fixed
- After an update, Gitgel comes to the front.
- No white flash when Gitgel opens.

## 0.1.16 — 2026-10-06

### Improved
- Signed with Developer ID and notarized by Apple, so Gitgel opens without "Open Anyway".

## 0.1.15 — 2026-10-05

### New
- Fetch, Pull and Push for a branch, from its History and branch menus.
- Repo bands on Branches can be collapsed and pinned to the top.

### Improved
- Leaner text across the app.

### Fixed
- Renaming a project in the sidebar keeps the row's color.

## 0.1.14 — 2026-10-05

### New
- Scripts: your own commands in a branch's menu, with inputs and live output.
- Stashes: list and review them; stash (picking files), apply, pop and drop.
- History: a branch's commits, with search.
- The base branch is always listed on Branches; its menu opens Review.
- Review shows merge conflicts.
- Review: a resizable file list and Change base in the entry menu.
- Gitgel › Check for Updates opens a Software Update window.

### Improved
- New icons and controls across the app.
- Review's entry bar opens the History of the branch and its base.

### Fixed
- Unpicked staged files no longer go into a stash.

## 0.1.13 — 2026-09-30

### Improved
- Branch rows show three lines.
- Page headers look the same everywhere.
- Settings has a section list.
- The default bases can be reordered.

## 0.1.12 — 2026-09-30

### New
- In-app updates.
- Projects in the sidebar open their review.
- Double- or right-click a project to rename it.

### Improved
- Age on Branches reflects uncommitted changes when they are newer than the last commit.

## 0.1.11 — 2026-09-29

### New
- A Diff column on Branches: ahead/behind counts and a checked-out icon.

## 0.1.10 — 2026-09-28

### New
- Open a worktree in Finder, an editor or a terminal from a Branches row's menu.
- Choose the terminal or give your own command.
- Remote branches in the base menu; the default base is the closer of the local and `origin` branches.

## 0.1.9 — 2026-09-28

### New
- Review: changes only or the whole file, with a choice of how many lines show around each change.

## 0.1.8 — 2026-09-27

### New
- Filter Review's file list.

### Fixed
- The selected file stays visible in the file list.
- Ruby highlighting no longer breaks on an unmatched `end`.

## 0.1.7 — 2026-09-27

### Improved
- Less memory use after scans.

### Fixed
- No theme flash at launch.
- Light theme fixes.

## 0.1.6 — 2026-09-27

### New
- Light theme, chosen in Settings › Appearance.

## 0.1.5 — 2026-09-27

### New
- Install with Homebrew: `brew install --cask gokberkakdeniz/tap/gitgel`.
- Review a single commit.
- Diff settings and the shortcut list in Settings.
- Menu bar actions.

## 0.1.4 — 2026-09-26

### Improved
- Much faster scans and reviews in large repositories.

## 0.1.3 — 2026-09-26

### New
- Help › Show Logs in Finder.

### Fixed
- The downloaded app opens on other Macs.

## 0.1.2 — 2026-09-26

### New
- First release: review branches and worktrees across repositories without checking anything out.
- Step through the changes in a diff.
