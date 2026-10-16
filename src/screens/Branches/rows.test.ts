import { describe, expect, it } from 'vitest';
import type { Config, EntrySummary, RepoScan, StashInfo } from '../../lib/types';
import { afu, branchCount, branchGroups, matchesFilter, middleCut, projectsOf, scopeCounts } from './rows';

function entry(repoId: string, branch: string | null, at: number, extra: Partial<EntrySummary> = {}): EntrySummary {
  const worktreePath = extra.worktreePath ?? null;
  return {
    key: branch !== null ? `${repoId}:${branch}` : `${repoId}:@${worktreePath}`,
    repoId,
    repoName: repoId === 'r_1' ? 'web-app' : 'api-server',
    branch,
    worktreePath,
    headSha: 'abcdef1234',
    shortSha: 'abcdef1',
    base: 'main',
    baseIsCustom: false,
    ahead: 1,
    behind: 0,
    files: 1,
    add: 1,
    del: 0,
    uncommitted: null,
    conflicts: 0,
    lastCommitAt: at,
    changedAt: null,
    upstream: null,
    operation: null,
    state: 'ok',
    error: null,
    ...extra,
  };
}

function scan(id: string, active: EntrySummary[], status: RepoScan['status'] = 'ok'): RepoScan {
  return {
    repo: { id, path: `/code/${id}` },
    name: id,
    status,
    error: null,
    defaultBase: 'main',
    defaultBaseSource: 'main',
    baseBranch: null,
    active,
    others: [],
    remotes: [],
    stashes: [],
  };
}

const config: Config = {
  version: 1,
  repos: [],
  branchBases: {},
  projects: [
    {
      id: 'p_1',
      name: 'P',
      createdAt: '',
      entries: [{ repoId: 'r_1', branch: 'in-project', worktreePath: null, lastKnownTip: null }],
    },
  ],
  settings: { newBranchCheckout: 'main', defaultBaseOrder: ['main'], activeDays: 14, diffView: 'split', ignoreWhitespace: false, diffContext: 'changes', diffContextLines: 3, zoom: 100, language: 'system', dateFormat: 'MMM d, yyyy', timeFormat: 'HH:mm', numberFormat: 'plain-comma', preferAbsoluteDates: false, diffTabSize: 4, appearance: 'system', sidebarVisible: true, terminal: 'auto', terminalCommand: '', checkUpdates: true, lastSeenVersion: '', prompts: { removeRepositories: true, discardChanges: true, discardStash: true, deleteProjects: true, abortOperation: true, amendPushed: true }, ai: { enabled: true, order: ['opencode', 'claude', 'cursor', 'antigravity', 'codex', 'foundation'], opencode: { enabled: true, model: null, effort: null, prompt: null }, claude: { enabled: true, model: null, effort: null, prompt: null }, cursor: { enabled: true, model: null, effort: null, prompt: null }, antigravity: { enabled: true, model: null, effort: null, prompt: null }, codex: { enabled: true, model: null, effort: null, prompt: null }, foundation: { enabled: true, model: null, effort: null, prompt: null } } },
  scripts: [],
  pinnedRepos: [],
};

const scans = [
  scan('r_1', [entry('r_1', 'a', 100), entry('r_1', 'in-project', 500)]),
  scan('r_2', [entry('r_2', 'b', 300), entry('r_2', null, 50, { worktreePath: '/wt/detached' })]),
  scan('r_3', []),
  scan('r_4', [], 'missing'),
];

describe('branchGroups', () => {
  it('lists every active entry by default, newest repo first, missing last', () => {
    const groups = branchGroups(config, scans, '');
    expect(groups.map((g) => [g.scan.repo.id, g.rows.map((r) => r.branch)])).toEqual([
      ['r_1', ['a', 'in-project']],
      ['r_2', ['b', null]],
      ['r_4', []],
    ]);
  });

  it('puts pinned repos first, in pin order, missing ones included', () => {
    const groups = branchGroups({ ...config, pinnedRepos: ['r_4', 'r_2'] }, scans, '');
    expect(groups.map((g) => g.scan.repo.id)).toEqual(['r_4', 'r_2', 'r_1']);
  });

  it('"Not in a project" drops project entries and empty repos', () => {
    const groups = branchGroups(config, scans, '', 'unassigned');
    expect(groups.map((g) => [g.scan.repo.id, g.rows.map((r) => r.branch)])).toEqual([
      ['r_2', ['b', null]],
      ['r_1', ['a']],
    ]);
  });

  it('filters rows and hides missing repos while filtering', () => {
    const groups = branchGroups(config, scans, '  DETACH ');
    expect(groups.map((g) => [g.scan.repo.id, g.rows.map((r) => r.key)])).toEqual([
      ['r_2', ['r_2:@/wt/detached']],
    ]);
  });
});

describe('branchGroups focus', () => {
  it('keeps the focused repo even without rows', () => {
    const groups = branchGroups(config, scans, '', 'all', 'r_3');
    expect(groups.map((g) => [g.scan.repo.id, g.rows.length])).toEqual([
      ['r_1', 2],
      ['r_2', 2],
      ['r_3', 0],
      ['r_4', 0],
    ]);
  });
});

describe('matchesFilter', () => {
  it('matches branch, short SHA, worktree path and repo name', () => {
    const e = entry('r_1', 'feat/Billing', 1, { worktreePath: '/Users/me/wt/pay' });
    expect(matchesFilter(e, 'billing')).toBe(true);
    expect(matchesFilter(e, 'wt/pay')).toBe(true);
    expect(matchesFilter(e, 'web')).toBe(true);
    expect(matchesFilter(e, 'nope')).toBe(false);
    expect(matchesFilter(entry('r_1', null, 1), 'ABCDEF1')).toBe(true);
  });

  it('matches words across separators, in any order', () => {
    const tbd = entry('r_2', 'to-be-deleted', 1);
    const queue = entry('r_2', 'feat/job-queue', 1);
    expect(matchesFilter(tbd, 'to be')).toBe(true);
    expect(matchesFilter(tbd, 'deleted to')).toBe(true);
    expect(matchesFilter(tbd, 'to-be')).toBe(true);
    expect(matchesFilter(queue, 'feat queue')).toBe(true);
    expect(matchesFilter(queue, 'job/queue')).toBe(true);
    expect(matchesFilter(queue, 'api queue')).toBe(true);
    expect(matchesFilter(queue, 'feat billing')).toBe(false);
    expect(matchesFilter(queue, '   ')).toBe(true);
  });
});

describe('counts', () => {
  it('counts all active entries and those in no project, whatever the filter', () => {
    expect(scopeCounts(config, scans)).toEqual({ all: 4, unassigned: 3 });
    expect(branchCount(config, scans)).toBe(4);
    expect(branchCount(null, scans)).toBe(0);
  });

  it('lists the projects of an entry', () => {
    expect(projectsOf(config, 'r_1:in-project').map((p) => p.name)).toEqual(['P']);
    expect(projectsOf(config, 'r_1:a')).toEqual([]);
  });
});

describe('afu', () => {
  it('shows ahead / files / uncommitted, with dashes for what is unknown', () => {
    expect(afu(entry('r_1', 'a', 1, { ahead: 4, files: 9, uncommitted: 3, worktreePath: '/wt' }))).toEqual({
      a: '↑4',
      f: '9',
      u: '3',
      title: '4 ahead · 9 files · 3 uncommitted',
    });
    expect(afu(entry('r_1', 'c', 1, { ahead: 1, behind: 2, files: 1, uncommitted: 0, worktreePath: '/wt' }))).toEqual({
      a: '↑1 ↓2',
      f: '1',
      u: '0',
      title: '1 ahead · 2 behind · 1 files · 0 uncommitted',
    });
    expect(afu(entry('r_1', 'b', 1, { ahead: null, files: null }))).toEqual({
      a: '—',
      f: '—',
      u: '—',
      title: '— ahead · — files · not checked out',
    });
  });
});

describe('middleCut', () => {
  it('keeps short names whole', () => {
    expect(middleCut('feat/billing-v2')).toEqual(['feat/billing-v2', '']);
  });

  it('keeps the end after a separator, so names that differ only at the end stay apart', () => {
    expect(middleCut('feature/PROJ-4821-add-retry-with-exponential-backoff-to-the-api-client')).toEqual([
      'feature/PROJ-4821-add-retry-with-exponential-backoff-to-',
      'the-api-client',
    ]);
    expect(middleCut('feature/PROJ-4821-add-retry-with-exponential-backoff-to-the-api-client-v2')[1]).toBe(
      'api-client-v2',
    );
  });

  it('takes the last 16 characters when they have no separator', () => {
    expect(middleCut('abcdefghijklmnopqrstuvwxyz0123')).toEqual(['abcdefghijklmn', 'opqrstuvwxyz0123']);
  });
});

describe('stashes under a band', () => {
  const st = (index: number, message: string, branch: string): StashInfo => ({
    index,
    sha: `s${index}`,
    message,
    branch,
    branchExists: true,
    base: 'b',
    files: 1,
    createdAt: 0,
  });
  const repo = { ...scan('r_1', [entry('r_1', 'feat/x', 5)]), stashes: [st(0, 'debug logging', 'feat/x'), st(1, 'wip', 'old')] };
  const empty = { ...scan('r_2', []), stashes: [st(0, 'lonely', 'gone')] };

  it('lists the stack with the rows, filtered like the rows', () => {
    expect(branchGroups(config, [repo], '')[0].stashes.map((s) => s.index)).toEqual([0, 1]);
    expect(branchGroups(config, [repo], 'logging')).toEqual([]);
    expect(branchGroups(config, [repo], 'feat')[0].stashes.map((s) => s.index)).toEqual([0]);
  });

  it('keeps a band without rows hidden', () => {
    expect(branchGroups(config, [empty], '')).toEqual([]);
  });
});

describe('remote branches under a band', () => {
  const remotes = [
    { name: 'origin/colleague/job-queue', lastCommitAt: 900 },
    { name: 'origin/old-spike', lastCommitAt: 10 },
  ];
  const repo = { ...scan('r_1', [entry('r_1', 'feat/x', 5)]), remotes };
  const only = { ...scan('r_2', []), remotes };

  it('lists none while not filtering', () => {
    expect(branchGroups(config, [repo, only], '').map((g) => [g.scan.repo.id, g.remotes])).toEqual([['r_1', []]]);
  });

  it('lists the matching ones while filtering, and a band with only remote matches', () => {
    const groups = branchGroups(config, [repo, only], 'job queue');
    expect(groups.map((g) => [g.scan.repo.id, g.rows.length, g.remotes.map((r) => r.name)])).toEqual([
      ['r_1', 0, ['origin/colleague/job-queue']],
      ['r_2', 0, ['origin/colleague/job-queue']],
    ]);
  });
});

describe('base branch row', () => {
  const withBase = (active: EntrySummary[]): RepoScan => ({ ...scan('r_1', active), baseBranch: 'main' });
  const main = entry('r_1', 'main', 1, { ahead: 0 });
  const fresh = entry('r_1', 'feature', 50);
  const inProject = entry('r_1', 'in-project', 40);

  it('comes first in its band and stays in "Not in a project"', () => {
    const scans = [withBase([fresh, inProject, main])];
    expect(branchGroups(config, scans, '')[0].rows.map((r) => r.branch)).toEqual(['main', 'feature', 'in-project']);
    expect(branchGroups(config, scans, '', 'unassigned')[0].rows.map((r) => r.branch)).toEqual(['main', 'feature']);
    expect(branchGroups(config, scans, 'feature')[0].rows.map((r) => r.branch)).toEqual(['feature']);
  });

  it('keeps a repo listed with nothing else active', () => {
    expect(branchGroups(config, [withBase([main])], '').map((g) => g.rows.length)).toEqual([1]);
  });

  it('is left out of the counts', () => {
    expect(scopeCounts(config, [withBase([fresh, inProject, main])])).toEqual({ all: 2, unassigned: 1 });
    expect(branchCount(config, [withBase([main])])).toBe(0);
  });
});

