import { describe, expect, it } from 'vitest';
import type { EntrySummary, RepoScan } from '../lib/types';
import { baseChoices, defaultParent, folderName } from './branchDefaults';

const scan = (over: Partial<RepoScan>): RepoScan =>
  ({
    repo: { id: 'r', path: '/code/web-app' },
    name: 'web-app',
    status: 'ok',
    error: null,
    defaultBase: 'main',
    defaultBaseSource: 'main',
    baseBranch: 'main',
    active: [],
    others: [],
    remotes: [],
    stashes: [],
    ...over,
  }) as RepoScan;

describe('new branch', () => {
  it('offers the default base first, then local branches by name, then remote ones', () => {
    const s = scan({
      defaultBase: 'origin/main',
      active: [{ branch: 'main' }, { branch: 'feat/z' }, { branch: null }] as EntrySummary[],
      others: [{ repoId: 'r', repoName: 'web-app', branch: 'feat/a', lastCommitAt: 0, merged: false }],
      remotes: [{ name: 'origin/wip', lastCommitAt: 0 }],
    });
    expect(baseChoices(s)).toEqual(['origin/main', 'main', 'feat/a', 'feat/z', 'origin/wip']);
  });

  it('puts the worktree beside the repository, slashes as dashes', () => {
    expect(defaultParent('/code/web-app/')).toBe('/code/web-app-worktrees');
    expect(folderName(' feat/job-queue ')).toBe('feat-job-queue');
  });
});
