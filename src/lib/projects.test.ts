import { describe, expect, it } from 'vitest';
import { entriesSummary, nameConflict, refOf, untitledName } from './projects';
import type { Config } from './types';

const config = (names: string[]) =>
  ({
    projects: names.map((name, i) => ({ id: `p_${i}`, name, createdAt: '', entries: [] })),
  }) as unknown as Config;

describe('project helpers', () => {
  it('picks the first free untitled name', () => {
    expect(untitledName(config([]))).toBe('Untitled project');
    expect(untitledName(config(['untitled project', 'Untitled project 2']))).toBe('Untitled project 3');
  });

  it('finds name conflicts ignoring case and the project itself', () => {
    const c = config(['Session auth refresh']);
    expect(nameConflict(c, ' session AUTH refresh ')).toBe('Session auth refresh');
    expect(nameConflict(c, 'Session auth refresh', 'p_0')).toBeNull();
    expect(nameConflict(c, '   ')).toBeNull();
  });

  it('drops the worktree path of branch entries', () => {
    expect(refOf({ repoId: 'r', branch: 'x', worktreePath: '/wt' })).toEqual({ repoId: 'r', branch: 'x', worktreePath: null });
    expect(refOf({ repoId: 'r', branch: null, worktreePath: '/wt' })).toEqual({ repoId: 'r', branch: null, worktreePath: '/wt' });
  });

  it('summarizes entries', () => {
    expect(entriesSummary([])).toBe('Empty');
    expect(entriesSummary([{ repoId: 'r1', repoName: 'web-app' }])).toBe('1 entry · web-app');
    expect(
      entriesSummary([
        { repoId: 'r1', repoName: 'a' },
        { repoId: 'r2', repoName: 'b' },
        { repoId: 'r2', repoName: 'b' },
      ]),
    ).toBe('3 entries across 2 repos');
  });
});
