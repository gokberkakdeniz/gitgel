import { entryKey } from '../../lib/entryKey';
import type { EntryRef, EntrySummary, RepoScan } from '../../lib/types';

/**
 * Table rows of an unsaved project, from the stored scan: active entries carry their full
 * summary; other branches only what the scan knows about them.
 */
export function draftRows(entries: EntryRef[], scan: Record<string, RepoScan>): EntrySummary[] {
  return entries.map((ref) => {
    const key = entryKey(ref);
    const repo = scan[ref.repoId];
    const active = repo?.active.find((e) => e.key === key);
    if (active) return active;
    const other = repo?.others.find((o) => o.branch === ref.branch);
    return {
      key,
      repoId: ref.repoId,
      repoName: repo?.name ?? ref.repoId,
      branch: ref.branch,
      worktreePath: ref.worktreePath,
      headSha: null,
      shortSha: null,
      base: repo?.defaultBase ?? null,
      baseIsCustom: false,
      ahead: null,
      behind: null,
      files: null,
      add: null,
      del: null,
      uncommitted: null,
      conflicts: 0,
      lastCommitAt: other?.lastCommitAt ?? null,
      changedAt: null,
      upstream: null,
      operation: null,
      state: other?.merged ? 'merged' : 'ok',
      error: null,
    };
  });
}
