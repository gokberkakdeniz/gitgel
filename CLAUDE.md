# Gitgel

macOS app (Tauri 2 + React/TS + Monaco) for reviewing branches and worktrees across several repos without checking anything out. Reads git through the git2 library; its few writes (stash actions) run the git binary.

- Spec (UI, behaviour, architecture, types, git rules): `docs/SPEC.md`.
- Tasks and their status: `docs/TASKS.md` (its top section says how to write and complete one).
- Visual reference per screen: `design/screens/*.dc.html` (design-tool markup, read for values; do not render or copy the template syntax).

Rules:
- Reads go through git2 (libgit2), which never writes. Anything that writes to a repository is a git action: the git CLI with a fixed command, run on the scripts' runner (`src-tauri/src/scripts/git.rs`); see `docs/SPEC.md` §0 and §10.
- Use pnpm for all JS packages and scripts (never npm, npx or yarn).
- Work through `docs/TASKS.md` in order. Stop at each checkpoint (✋) and show the result before continuing.
- When a task is done, follow "Doing a task" in `docs/TASKS.md`: delete its block, add its one-line entry under Done, remove its `(planned, …)` markers from the spec, and keep the diff to that.
- Any change that affects the design (a new or changed control, screen, state or flow) also updates the "Gitgel App Flow" design canvas (https://claude.ai/artifact/SzYAF9awmKNBf2rcZV16ZZ): edit the affected artboards there, publish, then copy the changed screens into `design/screens/`.
- Asked for a release: have the `changelog-writer` subagent (`.claude/agents/`) write the version's `CHANGELOG.md` section first (`docs/SPEC.md` §12 "Release notes": commits since the last `chore: release v…`, only what a user notices, short lines), show it, and commit it with the version bump; `pnpm release` refuses a version without one.
- Work asked for in chat that is worth remembering (a feature, behaviour change, new script or workflow) gets an `(on request)` line in `docs/TASKS.md` Done; see "Doing a task" there.
