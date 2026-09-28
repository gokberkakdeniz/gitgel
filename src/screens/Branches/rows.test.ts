import { describe, expect, it } from 'vitest';
import type { Config, EntrySummary, RepoScan } from '../../lib/types';
import { branchCount, branchGroups, matchesFilter, projectsOf, scopeCounts } from './rows';

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
    files: 1,
    add: 1,
    del: 0,
    uncommitted: null,
    lastCommitAt: at,
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
    active,
    others: [],
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
  settings: { defaultBaseOrder: ['main'], activeDays: 14, diffView: 'split', ignoreWhitespace: false, diffContext: 'changes', diffContextLines: 3, zoom: 100, appearance: 'system', terminal: 'terminal', terminalApp: '' },
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
