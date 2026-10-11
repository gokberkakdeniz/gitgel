// Pure helpers for projects on the frontend.
import { t } from '../i18n';
import { cnt, formatCount } from './format';
import { entryKey } from './entryKey';
import type { Config, EntryRef, EntrySummary, OtherBranch } from './types';

/** First free name of the form `Untitled Project`, `Untitled Project 2`, … */
export function untitledName(config: Config | null): string {
  const taken = new Set((config?.projects ?? []).map((p) => p.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? t('project.untitled') : t('project.untitledN', { n: formatCount(n) });
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
  if (entries.length === 0) return t('project.empty');
  if (entries.length === 1) return t('project.singleEntry', { repo: entries[0].repoName });
  const repos = new Set(entries.map((e) => e.repoId)).size;
  return t('project.multiEntries', { ...cnt(entries.length), m: String(repos), e: formatCount(repos) });
}

export function keysOf(refs: EntryRef[]): string[] {
  return refs.map(entryKey);
}
