import { describe, expect, it } from 'vitest';
import type { ProjectConfig, RepoScan, StashInfo } from '../../lib/types';
import { reviewStashes, stashMeta } from './stashes';

const NOW = 1_800_000_000;

function stash(index: number, branch: string | null, extra: Partial<StashInfo> = {}): StashInfo {
  return {
    index,
    sha: `s${index}${branch ?? ''}`,
    message: `msg ${index}`,
    branch,
    branchExists: true,
    base: 'b'.repeat(40),
    files: 2,
    createdAt: NOW - 20 * 60,
    ...extra,
  };
}

function scan(id: string, name: string, stashes: StashInfo[]): RepoScan {
  return {
    repo: { id, path: `/code/${name}` },
    name,
    status: 'ok',
    error: null,
    defaultBase: 'main',
    defaultBaseSource: 'main',
    baseBranch: null,
    active: [],
    others: [],
    remotes: [],
    stashes,
  };
}

const scans = {
  r_1: scan('r_1', 'web-app', [stash(0, 'refresh'), stash(1, 'old', { branchExists: false }), stash(2, 'cookie')]),
  r_2: scan('r_2', 'api-server', [stash(0, 'rotation')]),
};

const project: ProjectConfig = {
  id: 'p_1',
  name: 'Session',
  createdAt: '',
  entries: [
    { repoId: 'r_2', branch: 'rotation', worktreePath: null, lastKnownTip: null },
    { repoId: 'r_1', branch: 'refresh', worktreePath: null, lastKnownTip: null },
    { repoId: 'r_1', branch: null, worktreePath: '/wt/d', lastKnownTip: null },
  ],
};

describe('reviewStashes', () => {
  it('lists the stashes of the project branches in entry order', () => {
    const list = reviewStashes({ kind: 'project', projectId: 'p_1' }, [project], scans);
    expect(list.map((s) => [s.repoName, s.branch])).toEqual([
      ['api-server', 'rotation'],
      ['web-app', 'refresh'],
    ]);
  });

  it('lists one branch, or the whole stack', () => {
    const branch = { kind: 'branch', repoId: 'r_1', branch: 'cookie', worktreePath: null, tipOverride: null } as const;
    expect(reviewStashes(branch, [], scans).map((s) => s.index)).toEqual([2]);
    expect(reviewStashes({ kind: 'stashes', repoId: 'r_1' }, [], scans).map((s) => s.index)).toEqual([0, 1, 2]);
    expect(reviewStashes({ kind: 'stashes', repoId: 'r_9' }, [], scans)).toEqual([]);
  });
});

describe('stashMeta', () => {
  it('names the repo and branch, files and age', () => {
    const [refresh, old] = reviewStashes({ kind: 'stashes', repoId: 'r_1' }, [], scans);
    expect(stashMeta(refresh, true, NOW)).toBe('web-app / refresh · 2 files · 20m');
    expect(stashMeta({ ...old, files: 1 }, true, NOW)).toBe('web-app / old (deleted) · 1 file · 20m');
    expect(stashMeta({ ...old, branch: null, files: null }, false, NOW)).toBe('Detached HEAD · 20m');
  });
});
