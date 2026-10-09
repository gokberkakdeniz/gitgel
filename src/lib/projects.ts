// Pure helpers for projects on the frontend.
import { entryKey } from './entryKey';
import type { Config, EntryRef, EntrySummary, OtherBranch } from './types';

/** First free name of the form `Untitled Project`, `Untitled Project 2`, … */
export function untitledName(config: Config | null): string {
  const taken = new Set((config?.projects ?? []).map((p) => p.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Untitled Project' : `Untitled Project ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** The existing project (other than `exceptId`) whose name equals `name`, ignoring case. */
export function nameConflict(config: Config | null, name: string, exceptId?: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const hit = config?.projects.find((p) => p.id !== exceptId && p.name.trim().toLowerCase() === wanted);
  return hit ? hit.name : null;
}

/** The reference stored for an entry: branch entries carry no worktree path. */
export function refOf(e: Pick<EntrySummary, 'repoId' | 'branch' | 'worktreePath'>): EntryRef {
  return { repoId: e.repoId, branch: e.branch, worktreePath: e.branch !== null ? null : e.worktreePath };
}

export function refOfOther(o: OtherBranch): EntryRef {
  return { repoId: o.repoId, branch: o.branch, worktreePath: null };
}

/** `N entries across M repos`, `1 entry · web-app`, `Empty`. */
export function entriesSummary(entries: { repoId: string; repoName: string }[]): string {
  if (entries.length === 0) return 'Empty';
  if (entries.length === 1) return `1 entry · ${entries[0].repoName}`;
  const repos = new Set(entries.map((e) => e.repoId)).size;
  return `${entries.length} entries across ${repos} ${repos === 1 ? 'repo' : 'repos'}`;
}

export function keysOf(refs: EntryRef[]): string[] {
  return refs.map(entryKey);
}
