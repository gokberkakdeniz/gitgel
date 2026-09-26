# Gitgel

Read-only macOS app (Tauri 2 + React/TS + Monaco, git via the git2 library, never the git binary) for reviewing branches and worktrees across several repos without checking anything out.

- Task list, architecture decisions and progress tracker: `docs/TASKS.md`.
- UI and behaviour: `design/HANDOFF.md`. **It overrides TASKS.md where they differ.**
- Visual reference per screen: `design/screens/*.dc.html` (design-tool markup, read for values; do not render or copy the template syntax).

Rules:
- Never run a git command that writes (no checkout, switch, stash, commit, fetch, worktree add/remove).
- The app reads git only through git2 (libgit2) and never calls a git2 API that writes; see `docs/TASKS.md` §6.
- Use pnpm for all JS packages and scripts (never npm, npx or yarn).
- Work through `docs/TASKS.md` in order. Stop at each phase checkpoint (✋) and show the result before continuing.
- When a task is done, tick it in the progress tracker at the end of `docs/TASKS.md`.
