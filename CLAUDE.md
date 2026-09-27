# Gitgel

Read-only macOS app (Tauri 2 + React/TS + Monaco, git via the git2 library, never the git binary) for reviewing branches and worktrees across several repos without checking anything out.

- Spec, UI and behaviour, architecture decisions and progress tracker: `docs/SPEC.md`.
- Visual reference per screen: `design/screens/*.dc.html` (design-tool markup, read for values; do not render or copy the template syntax).

Rules:
- The app is read-only: it reads git only through git2 (libgit2) and never calls a git2 API that writes; see `docs/SPEC.md` §10.
- Use pnpm for all JS packages and scripts (never npm, npx or yarn).
- Work through the tasks in `docs/SPEC.md` §14 in order. Stop at each checkpoint (✋) and show the result before continuing.
- When a task is done, tick it in the progress tracker (`docs/SPEC.md` §14) and update the sections it changed.
