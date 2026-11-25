# Scan performance on a large repository

Analysis of an exported log (2026-11-24) from a machine where one repository ("frontend") scans
slowly. Not tasks yet: when a fix is decided it becomes a task in `docs/TASKS.md`. See the entry in
`docs/NOTES.md`.

## The repository

- A large frontend monorepo: 1429 local branches outside the active list, 26 active entries,
  19 worktrees (all of the same repository), a stash stack shared by all of them.
- A second, smaller repository on the same machine scans in 0.3–1 s (5.4 s on a cold start).
- Gitgel 0.2.8 → 0.2.10, libgit2 1.9.7, macOS aarch64.

## Numbers

The last log file (2026-11-12 → 2026-11-24) has 435 scans of the repository. The phase names are
the ones `scan.rs` logs (`scan <name>: … (base, worktrees, branches, remotes, nearest, status,
stats, upstream, merged, stashes)`). The times are per scan; a phase that runs per entry is
summed.

| Phase | Median | p90 | Max |
|---|---|---|---|
| **total** | **2048 ms** | **4965 ms** | **185 500 ms** |
| upstream | 1309 ms | 1863 ms | 17 274 ms |
| remotes | 222 ms | 602 ms | 5 913 ms |
| base | 53 ms | 88 ms | 2 027 ms |
| branches | 49 ms | 114 ms | 7 857 ms |
| stashes | 14 ms | 42 ms | 21 281 ms |
| worktrees | 9.2 ms | 110 ms | 2 821 ms |
| status | 6.6 ms | 576 ms | 150 948 ms |
| merged | 1.3 ms | 4.1 ms | 1 552 ms |
| nearest | 0.1 ms | 1477 ms | 16 264 ms |
| stats | 0.1 ms | 351 ms | 5 134 ms |

43 of the 435 scans took over 5 s. Over the same 12 days the watcher logged 1210 events.

The slow scans fall into three groups.

### 1. The first scan after launch: 43–59 s, 1.3 GB

Every launch, without exception:

| When | Total | status (19×) | stashes | Memory |
|---|---|---|---|---|
| 2026-11-19 09:55 | 48 157 ms | 26 963 ms | 18 379 ms | 1171 MB |
| 2026-11-19 11:15 | 45 639 ms | 27 316 ms | 15 850 ms | 1249 MB |
| 2026-11-23 10:47 | 58 218 ms | 33 450 ms | 21 281 ms | 1297 MB |
| 2026-11-23 13:33 | 59 472 ms | 36 771 ms | 20 221 ms | 1304 MB |
| 2026-11-24 09:56 | 51 077 ms | 31 795 ms | 16 735 ms | 1371 MB |

After each of them: `libgit2 object cache 255/256 MB` (full), then `memory: 1371 → 86 MB after
closing repositories`.

Causes:

- **status.** The cache (`cache.rs`) lives in memory only, so after a launch every worktree's
  uncommitted list is computed again: `diff::uncommitted` = HEAD ↔ working tree with the index,
  untracked files included and recursed (`include_untracked`, `recurse_untracked_dirs`,
  `show_untracked_content`), then rename detection. libgit2 has neither fsmonitor nor the
  untracked cache, and Gitgel never updates the index's stat data (it would write the index), so
  each worktree walks and stats the whole tree: ~1.4–1.9 s per worktree here. Repositories are
  scanned in parallel (`scan_all`, `std::thread::scope`), but the worktrees of one repository are
  read one after the other inside `fill` → `summarize` → `worktree_state` (`scan.rs`): 19 × ~1.7 s
  ≈ 32 s.
- **stashes.** `stashes()` (`scan.rs`) computes `stash::changes` for every stash whose changes are
  not cached, which after a launch is all of them: a tree diff against its first parent with rename
  detection, plus, for a stash taken with `-u`, a diff of the whole untracked tree (the third
  parent). The log does not say how many stashes there are; 15–21 s suggests many, or some with
  large untracked trees (build output, dependencies).
- **Memory.** Both read many objects; the libgit2 object cache fills up (256 MB) and the process
  peaks at ~1.3 GB until the repositories are closed after the scan.

### 2. Every other scan: 0.5–4.5 s

- **upstream is the steady cost**: 1.2–2 s on almost every scan, about two thirds of the median
  scan. `upstream()` → `branch_upstream()` (`scan.rs`) runs `history::ahead_behind` (a
  `merge_base` plus `graph_ahead_behind`) for each of the 26 branches with a remote, on every scan,
  with no cache, although the result depends only on the two tips. Repositories are closed after a
  scan, so each scan also starts with a cold object cache and parses the commits again.
- **nearest** (the nearest-default rule) is ~1.5–2 s on some scans and 0 on the rest. It is cached
  by (repo, tip, local default tip, remote default tip), so a miss for all 25 entries at once means
  the local or the remote default moved, most likely a fetch moving `origin/<default>` (an IDE or a
  terminal fetching on its own). Not confirmed: the log has no fetch entries from outside Gitgel.
  Such a scan also often has a slow `stats` (new bases).
- **status** for a single changed worktree costs 2.4–3 s (the same full walk as above, for one
  worktree), e.g. 2026-11-19 13:53–13:59, every few minutes.
- **remotes** (remote-tracking branches with no local twin) costs 0.1–0.7 s per scan.

### 3. Rare outliers: 80–185 s, almost all in status

| When | Total | Slowest phase |
|---|---|---|
| 2026-11-18 09:55 | 185 500 ms | status 15× 148 843 ms (nearest 16 264, upstream 17 274) |
| 2026-11-19 16:06 | 175 174 ms | status 16× 150 948 ms |
| 2026-11-23 16:46 | 89 915 ms | status 19× 82 442 ms |
| 2026-11-19 16:01 | 24 953 ms | status 16× 14 149 ms |

These look like a worktree being scanned while its files change in bulk (a checkout, a dependency
install, a build writing output that is not ignored). The log also has "file changed before we
could read it (Filesystem/GenericError)" warnings for two branches of this repository. Not
confirmed: the log does not say which worktree was slow.

### Older versions (for reference)

Logs from 0.1.x (2026-09/10) show a different bottleneck, already gone: `remotes` 60–90 s per scan
(2026-10-12 → 10-13), and the status of 4 worktrees taking 6 s with no cache. In 0.2.x `remotes`
is under 1 s.

## What we can do in Gitgel

In order of value for the effort:

1. **Cache the upstream comparison** by (repo, tip, upstream tip), like `committed_stats` and
   `nearest`, and drop it in `prune` with the other tip-keyed entries. Removes ~1.3 s from the
   median scan (≈ 2 s → ≈ 0.7 s). Small change in `scan.rs` / `cache.rs`.
2. **Read the worktrees of one repository in parallel.** Each worktree already has its own
   `Repository` from the pool (`ctx.pool.get(worktree)`); only the main worktree uses the
   repository the scan holds. Computing `worktree_state` for all worktrees on a few threads before
   (or while) the branches are summarized would cut the ~32 s of a cold start by roughly the
   number of cores. The rest of `summarize` stays on the scan's thread.
3. **Keep the stash changes on disk**, keyed by stash SHA (a stash never changes; `prune_stashes`
   already drops the ones gone from the stack). Alternatively, send the scan without the stash file
   counts and fill them in afterwards. Either removes ~15–20 s from a cold start.
4. **Keep other SHA-keyed results on disk** too (`committed_stats`, `nearest`, upstream once
   cached), so a launch does not start from nothing. The uncommitted lists cannot be kept: the
   working tree may have changed while the app was closed.
5. **Look into the nearest misses**: confirm that a moved remote default causes them (log the
   default tips with the scan) and, if so, whether a remote default moving should recompute only
   the entries whose answer can change.
6. **The outliers**: log which worktree a slow status belongs to (e.g. any worktree over 5 s), and
   consider not rescanning a worktree whose watcher is still receiving a burst of events (debounce
   longer while events keep coming).

## What the user can do now

- `git commit-graph write --reachable` (or `git maintenance start`, which keeps it up to date)
  in the repository. A commit-graph speeds up the commit walks (upstream, nearest, merged, stats)
  when libgit2 reads it; whether libgit2 1.9 reads it without `core.commitGraph=true` is not
  verified, so set that too.
- `git stash list | wc -l`: drop old stashes, above all ones taken with `-u` (`git stash show
  --include-untracked stash@{n}` shows what they hold).
- Remove worktrees no longer used (`git worktree list`, `git worktree remove`): each one costs a
  full walk on launch and after every change in it.
- In each worktree, `git status --porcelain | wc -l`: a large count usually means build output or
  dependencies that `.gitignore` misses, which Gitgel reads with their content
  (`show_untracked_content`).
- `git count-objects -vH` and, with many loose objects, `git gc`.

## How the log was read

- Per-phase numbers: every `scan frontend:` line of the last log file, split on `, ` inside the
  parentheses (`<phase>[ cached][ N×] <ms> ms`).
- Cold starts: a `Gitgel <version>` line (launch) followed by the first scan of the repository;
  the scan line's trailing `· N MB` is the process memory.
