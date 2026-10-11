// Which entries the Branches screen lists: every active entry, optionally only those in no
// project ("Not in a project").
import { t } from '../../i18n';
import { cnt, formatCount } from '../../lib/format';
import { entryKey } from '../../lib/entryKey';
import type { Config, EntrySummary, ProjectConfig, RemoteBranch, RepoScan, StashInfo } from '../../lib/types';

export type BranchScope = 'all' | 'unassigned';

export interface RepoGroup {
  scan: RepoScan;
  rows: EntrySummary[];
  /** Listed under the rows (flow P1); only while the band has rows. */
  stashes: StashInfo[];
  /** Remote-tracking branches matching the filter; none while not filtering. */
  remotes: RemoteBranch[];
}

export function projectKeys(config: Config): Set<string> {
  return new Set(config.projects.flatMap((p) => p.entries.map(entryKey)));
}

/** The projects that contain the entry, in config order. */
export function projectsOf(config: Config, key: string): ProjectConfig[] {
  return config.projects.filter((p) => p.entries.some((e) => entryKey(e) === key));
}

/** The repo's base branch row: always listed, first in its band (SPEC §5, T20.3). */
export function isBaseRow(scan: RepoScan, e: EntrySummary): boolean {
  return e.branch !== null && e.branch === scan.baseBranch;
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
  return matchesWords([e.branch, e.shortSha, e.headSha, e.worktreePath, e.repoName], filter);
}

/** The same filter for a stash: its message, branch or repo name. */
export function matchesStash(s: StashInfo, repoName: string, filter: string): boolean {
  return matchesWords([s.message, s.branch, repoName], filter);
}

/** The same filter for a remote branch: its name (`origin/…`) or repo name. */
export function matchesRemote(r: RemoteBranch, repoName: string, filter: string): boolean {
  return matchesWords([r.name, repoName], filter);
}

function matchesWords(fields: (string | null)[], filter: string): boolean {
  const terms = words(filter).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((s): s is string => !!s)
    .map(words)
    .join(' ');
  return terms.every((t) => haystack.includes(t));
}

/**
 * Repo groups in display order: pinned repos first, in pin order, then the others with the
 * newest activity first; rows newest first (as scanned). While filtering, a band also lists the
 * matching remote branches. Repos without rows or remote matches are left out, except missing repos, which are listed last so
 * their "Path Not Found" band stays visible (only while not filtering), and `keepRepoId`, the
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
      if (!filter.trim() && scope === 'all') missing.push({ scan, rows: [], stashes: [], remotes: [] });
      continue;
    }
    // The base branch row comes first and stays in "Not in a project".
    const shown = scan.active.filter(
      (e) => (scope === 'all' || isBaseRow(scan, e) || !inProject.has(e.key)) && matchesFilter(e, filter),
    );
    const rows = [...shown.filter((e) => isBaseRow(scan, e)), ...shown.filter((e) => !isBaseRow(scan, e))];
    const remotes = filter.trim() ? scan.remotes.filter((r) => matchesRemote(r, scan.name, filter)) : [];
    if (rows.length > 0 || remotes.length > 0 || scan.repo.id === keepRepoId || (scan.status === 'error' && !filter.trim())) {
      const stashes = rows.length > 0 ? scan.stashes.filter((st) => matchesStash(st, scan.name, filter)) : [];
      groups.push({ scan, rows, stashes, remotes });
    }
  }
  const newest = (g: RepoGroup) =>
    Math.max(0, ...g.rows.map((r) => r.changedAt ?? r.lastCommitAt ?? 0), ...g.remotes.map((r) => r.lastCommitAt));
  groups.sort((a, b) => newest(b) - newest(a));
  const pins = config.pinnedRepos;
  const pinned = pins.flatMap((id) => [...groups, ...missing].filter((g) => g.scan.repo.id === id));
  const unpinned = (list: RepoGroup[]) => list.filter((g) => !pins.includes(g.scan.repo.id));
  return [...pinned, ...unpinned(groups), ...unpinned(missing)];
}

/** Counts for the scope selector, independent of the text filter; base branch rows are left out. */
export function scopeCounts(config: Config | null, scans: RepoScan[]): Record<BranchScope, number> {
  if (!config) return { all: 0, unassigned: 0 };
  const inProject = projectKeys(config);
  let all = 0;
  let unassigned = 0;
  for (const s of scans) {
    for (const e of s.active) {
      if (isBaseRow(s, e)) continue;
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
  const a = e.ahead === null ? '—' : `↑${formatCount(e.ahead)}${behind > 0 ? ` ↓${formatCount(behind)}` : ''}`;
  const f = e.files === null ? '—' : formatCount(e.files);
  const u = e.uncommitted === null ? '—' : formatCount(e.uncommitted);
  const ahead =
    e.ahead === null
      ? t('branches.aheadNone')
      : t('branches.aheadCount', { ...cnt(e.ahead), behind: String(behind), e: formatCount(behind) });
  const files = t('branches.filesPart', { n: f === '—' ? '—' : f });
  const un =
    e.uncommitted === null
      ? t('branches.uncheckedPart')
      : t('branches.uncommittedPart', { n: u });
  const title = `${ahead} · ${files} · ${un}`;
  return { a, f, u, title };
}

/**
 * A branch name split for a middle ellipsis: the head shrinks with "…" and the tail always shows,
 * so `…-api-client` and `…-api-client-v2` stay apart. The tail is at most the last 16 characters,
 * starting after a `-`, `/`, `_` or `.` when there is one; short names are not split.
 */
export function middleCut(name: string): [head: string, tail: string] {
  if (name.length <= 24) return [name, ''];
  const end = name.slice(-16);
  const sep = end.search(/[-/_.]/);
  const tail = sep >= 0 && sep < end.length - 1 ? end.slice(sep + 1) : end;
  return [name.slice(0, name.length - tail.length), tail];
}
