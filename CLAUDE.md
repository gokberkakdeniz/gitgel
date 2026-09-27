# Gitgel

Read-only macOS app (Tauri 2 + React/TS + Monaco, git via the git2 library, never the git binary) for reviewing branches and worktrees across several repos without checking anything out.

- Spec (UI, behaviour, architecture, types, git rules): `docs/SPEC.md`.
- Tasks and their status: `docs/TASKS.md` (its top section says how to write and complete one).
- Visual reference per screen: `design/screens/*.dc.html` (design-tool markup, read for values; do not render or copy the template syntax).

Rules:
- The app is read-only: it reads git only through git2 (libgit2) and never calls a git2 API that writes; see `docs/SPEC.md` §10.
- Use pnpm for all JS packages and scripts (never npm, npx or yarn).
- Work through `docs/TASKS.md` in order. Stop at each checkpoint (✋) and show the result before continuing.
- When a task is done, follow "Doing a task" in `docs/TASKS.md`: delete its block, add its one-line entry under Done, remove its `(planned, …)` markers from the spec, and keep the diff to that.
- Work asked for in chat that is worth remembering (a feature, behaviour change, new script or workflow) gets an `(on request)` line in `docs/TASKS.md` Done; see "Doing a task" there.
