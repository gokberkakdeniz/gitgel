# Changelog

## 0.2.2 — 2026-11-10

### Improved
- Review's stash rows have a right-click menu: Apply, Pop and Drop.
- Review's commit and stash file menus copy the file path.
- Review's file bar path is selectable.

## 0.2.1 — 2026-10-20

### New
- Stage and unstage selected lines from the diff's right-click menu.
- Settings › General › Editor: pick one editor, or a custom app or command.

### Improved
- New commits and branch changes appear right away in repositories with many branches.
- Review's Changes and Commits headers fold their rows.

### Fixed
- Review shows tags fetched or created while Gitgel is open.

## 0.2.0 — 2026-10-18

### Changed
- Review and History are one screen, named Review: a project's Review opens one branch at a time.
- Review's file groups, modes and file filter are gone.

### New
- Command palette: ⌘P goes to a project, worktree or branch, ⇧⌘P runs a command.
- Stage and unstage files in Review's Uncommitted changes.
- Squash Commits, with an AI-generated message.
- Pick several commits in Review for one combined diff.
- Cherry-Pick to another checked-out branch.
- Undo Commit on the newest unpushed commit.
- Revert Changes in Commit.
- Tags on Review's commit rows and headers.
- Apple Foundation Models for AI commit messages.

### Improved
- Settings › Appearance › Review: one-line commit rows and a columns layout.
- Settings › Appearance: more date formats.
- Hovering the show-sidebar button previews the sidebar.
- Two or more scripts share a Run Script submenu.
- Menus leave out items that cannot be used.
- Faster Review on large repositories.
- Commit row tooltips show the full message.

### Fixed
- Project Review lists branches with no changes.
- Sidebar toggle, Back and Forward stay beside the traffic lights at any font size.
- Page header and sidebar top row keep their size at any font size.
- The window no longer bounces when scrolling over fixed parts.

## 0.1.24 — 2026-10-16

### New
- New Branch on each Branches repo.
- Checkout Branch in branch menus.
- Delete Branch in branch menus.

### Improved
- A failed git action opens its output panel.
- Confirmations and forms have standard titles and buttons.

### Fixed
- History keeps each branch's commit message.
- A worktree removed inside its repository folder leaves Branches.

## 0.1.23 — 2026-10-13

### Improved
- Update checks every hour, and after a Mac wakes.

## 0.1.22 — 2026-10-13

### New
- Amend the newest commit from History.
- Switch Branch (⇧⌘B) opens another branch's History.

### Improved
- ⌘B shows or hides the sidebar.
- Fetch on each Branches repo.
- Script output copies its repo, branch and folder on click.

### Fixed
- AI commit messages from Codex keep only its answer.
- AI commit messages work with Cursor.
- History's diverged banner buttons wait for a running git action.
- A long branch in Review no longer runs under the counts.
- Long script names in menus end in an ellipsis.
- Project header drags the window beside its title.

## 0.1.21 — 2026-10-12

### New
- Generate commit messages with AI.
- Turkish translation.
- Discard changes, with a copy in the Trash.
- Continue or abort a rebase or merge in progress.

### Improved
- Lower memory use.
- Smaller app size.
- Resizable App and History sidebars.
- History opens on Uncommitted changes first.
- Commit links for GitHub, GitLab and Bitbucket.
- Date, time, number format and diff tab size settings.
- Script output shows the running command.
- Toasts name the running action.
- Remembered sidebar visibility.
- Scripts' Show when lists matching branches.
- Selectable commit details.
- Smoother script reordering.
- macOS title case in buttons and menus.
- History's base line shows only the branch.
- No worktree path on History's Uncommitted row.
- No next file hint beside Review's change counter.

### Fixed
- History keeps the picked file in view.
- Author avatars show in the light theme.

## 0.1.20 — 2026-10-09

### New
- Force push for a diverged branch, from its branch menu and History.
- Searching Branches lists remote branches without a local copy.
- Right-click in the diff for Open in Finder and editors, at the clicked line.

### Improved
- Review's header shows the repo, branch and worktree.
- Project review's header shows the repo and branch count.
- Review's Uncommitted layer has no warning banner.
- History has no branch picker.
- Searching Branches stays smooth while typing.

### Fixed
- ⌥H, ⌘← and ⌘→ work while the diff has focus.
- Switching between Uncommitted and All keeps the file and its place.
- A long line in a toast ends in an ellipsis.

## 0.1.19 — 2026-10-08

### New
- Commit from History: a summary, a description and a Commit button.
- Checkboxes on Uncommitted files pick what goes into a commit.
- ⌘↵ commits.
- A failed commit offers Commit without hooks and Retry.

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
