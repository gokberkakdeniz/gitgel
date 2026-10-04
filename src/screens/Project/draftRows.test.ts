import { describe, expect, it } from 'vitest';
import type { EntrySummary, RepoScan } from '../../lib/types';
import { draftRows } from './draftRows';

const active = { key: 'r_1:feat', repoId: 'r_1', branch: 'feat', ahead: 3 } as EntrySummary;
const scan: Record<string, RepoScan> = {
  r_1: {
    repo: { id: 'r_1', path: '/code/web-app' },
    name: 'web-app',
    status: 'ok',
    error: null,
    defaultBase: 'main',
    defaultBaseSource: 'main',
    active: [active],
    others: [{ repoId: 'r_1', repoName: 'web-app', branch: 'old', lastCommitAt: 42, merged: true }],
    stashes: [],
  },
};

describe('draftRows', () => {
  it('uses the scan summary for active entries and a light row for others', () => {
    const rows = draftRows(
      [
        { repoId: 'r_1', branch: 'feat', worktreePath: null },
        { repoId: 'r_1', branch: 'old', worktreePath: null },
      ],
      scan,
    );
    expect(rows[0]).toBe(active);
    expect(rows[1]).toMatchObject({ key: 'r_1:old', repoName: 'web-app', base: 'main', lastCommitAt: 42, state: 'merged', ahead: null });
  });
});
