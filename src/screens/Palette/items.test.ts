import { describe, expect, it } from 'vitest';
import type { EntrySummary, RepoScan } from '../../lib/types';
import { paletteItems, searchPalette } from './items';

const NOW = 1_800_000_000;
const DAY = 86_400;

function entry(branch: string | null, extra: Partial<EntrySummary>): EntrySummary {
  return {
    key: branch ? `r_1:${branch}` : 'r_1:@/wt/d',
    repoId: 'r_1',
    repoName: 'web-app',
    branch,
    worktreePath: null,
    headSha: 'abcdef1234',
    shortSha: 'abcdef1',
    base: 'main',
    baseIsCustom: false,
    ahead: 2,
    behind: 0,
    files: 4,
    add: 1,
    del: 0,
    uncommitted: null,
    conflicts: 0,
    lastCommitAt: NOW - 3 * DAY,
    changedAt: null,
    upstream: null,
    state: 'ok',
    error: null,
    ...extra,
  };
}

const scan: RepoScan = {
  repo: { id: 'r_1', path: '/code/web-app' },
  name: 'web-app',
  status: 'ok',
  error: null,
  defaultBase: 'main',
  defaultBaseSource: 'origin/HEAD',
  baseBranch: null,
  active: [
    entry('session-token-refresh', { worktreePath: '/wt/token-refresh', uncommitted: 1 }),
    entry('feat/token-store', {}),
    entry('in-project', {}),
    entry('squashed', { state: 'merged' }),
  ],
  others: [
    { repoId: 'r_1', repoName: 'web-app', branch: 'fix/token-expiry', lastCommitAt: NOW - 41 * DAY, merged: true },
    { repoId: 'r_1', repoName: 'web-app', branch: 'old-feature', lastCommitAt: NOW - 60 * DAY, merged: false },
  ],
  stashes: [],
};

const items = paletteItems([scan], new Set(['r_1:in-project']), 'Session auth', NOW);
const meta = (key: string) => items.find((i) => i.key === key)!;

describe('paletteItems', () => {
  it('groups entries and writes their meta lines', () => {
    expect(meta('r_1:session-token-refresh')).toMatchObject({
      group: 'worktrees',
      meta: 'web-app · ↑2 · 4 files · ● 1 uncommitted',
      tag: null,
    });
    expect(meta('r_1:feat/token-store')).toMatchObject({ group: 'active', meta: 'web-app · ↑2 · 4 files · 3d ago' });
    expect(meta('r_1:in-project')).toMatchObject({
      meta: 'web-app · already in Session auth',
      tag: 'in project',
      disabled: true,
    });
    expect(meta('r_1:squashed')).toMatchObject({ meta: 'web-app · merged into main · 3d ago', tag: 'merged' });
    expect(meta('r_1:fix/token-expiry')).toMatchObject({
      group: 'older',
      meta: 'web-app · merged into main · 41d ago',
      tag: 'merged',
    });
    expect(meta('r_1:old-feature').meta).toBe('web-app · 60d ago');
  });
});

describe('searchPalette', () => {
  it('hides older branches until there is a query', () => {
    expect(searchPalette(items, '').map((i) => i.group)).not.toContain('older');
  });

  it('finds all three groups for "token", in group order', () => {
    const groups = searchPalette(items, 'token').map((i) => i.group);
    expect(groups).toEqual(['worktrees', 'active', 'older']);
  });
});
