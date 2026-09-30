// Which entries the Branches screen lists: every active entry, optionally only those in no
// project ("Not in a project").
import { entryKey } from '../../lib/entryKey';
import type { Config, EntrySummary, ProjectConfig, RepoScan } from '../../lib/types';

export type BranchScope = 'all' | 'unassigned';

export interface RepoGroup {
  scan: RepoScan;
  rows: EntrySummary[];
}

export function projectKeys(config: Config): Set<string> {
  return new Set(config.projects.flatMap((p) => p.entries.map(entryKey)));
}

/** The projects that contain the entry, in config order. */
export function projectsOf(config: Config, key: string): ProjectConfig[] {
  return config.projects.filter((p) => p.entries.some((e) => entryKey(e) === key));
}

/** Lowercase words; `-`, `/`, `_` and `.` count as spaces, so `to be` finds `to-be-deleted`. */
function words(text: string): string {
  return text.toLowerCase().replace(/[-/_.\s]+/g, ' ').trim();
}

/**
 * Every word of the filter must appear, in any order, in the branch (or short SHA), worktree
 * path or repo name: `feat queue` finds `feat/job-queue`, `api queue` finds it in api-server.
 */
export function matchesFilter(e: EntrySummary, filter: string): boolean {
  const terms = words(filter).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [e.branch, e.shortSha, e.headSha, e.worktreePath, e.repoName]
    .filter((s): s is string => !!s)
    .map(words)
    .join(' ');
  return terms.every((t) => haystack.includes(t));
}

/**
 * Repo groups in display order: repos with the newest activity first, rows newest first (as
 * scanned). Repos without rows are left out, except missing repos, which are listed last so
 * their "path not found" band stays visible (only while not filtering), and `keepRepoId`, the
 * repo being focused.
 */
export function branchGroups(
  config: Config,
  scans: RepoScan[],
  filter: string,
  scope: BranchScope = 'all',
  keepRepoId?: string,
): RepoGroup[] {
  const inProject = projectKeys(config);
  const groups: RepoGroup[] = [];
  const missing: RepoGroup[] = [];
  for (const scan of scans) {
    if (scan.status === 'missing') {
      if (!filter.trim() && scope === 'all') missing.push({ scan, rows: [] });
      continue;
    }
    const rows = scan.active.filter(
      (e) => (scope === 'all' || !inProject.has(e.key)) && matchesFilter(e, filter),
    );
    if (rows.length > 0 || scan.repo.id === keepRepoId || (scan.status === 'error' && !filter.trim())) {
      groups.push({ scan, rows });
    }
  }
  const newest = (g: RepoGroup) => Math.max(0, ...g.rows.map((r) => r.changedAt ?? r.lastCommitAt ?? 0));
  groups.sort((a, b) => newest(b) - newest(a));
  return [...groups, ...missing];
}

/** Counts for the scope selector, independent of the text filter. */
export function scopeCounts(config: Config | null, scans: RepoScan[]): Record<BranchScope, number> {
  if (!config) return { all: 0, unassigned: 0 };
  const inProject = projectKeys(config);
  let all = 0;
  let unassigned = 0;
  for (const s of scans) {
    for (const e of s.active) {
      all++;
      if (!inProject.has(e.key)) unassigned++;
    }
  }
  return { all, unassigned };
}

/** The sidebar count: every active branch, whatever the scope. */
export function branchCount(config: Config | null, scans: RepoScan[]): number {
  return scopeCounts(config, scans).all;
}

/** The Diff cell: ahead (`↑4`, plus `↓2` when behind the base), files, uncommitted ("—" when
 * unknown; uncommitted is unknown when the entry is not checked out), and its tooltip. */
export function afu(e: EntrySummary): { a: string; f: string; u: string; title: string } {
  const behind = e.behind ?? 0;
  const a = e.ahead === null ? '—' : `↑${e.ahead}${behind > 0 ? ` ↓${behind}` : ''}`;
  const f = e.files === null ? '—' : String(e.files);
  const u = e.uncommitted === null ? '—' : String(e.uncommitted);
  const ahead = e.ahead === null ? '— ahead' : `${e.ahead} ahead${behind > 0 ? ` · ${behind} behind` : ''}`;
  const title = `${ahead} · ${f} files · ${e.uncommitted === null ? 'not checked out' : `${u} uncommitted`}`;
  return { a, f, u, title };
}
