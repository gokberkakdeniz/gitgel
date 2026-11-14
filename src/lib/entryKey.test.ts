import { describe, expect, it } from 'vitest';
import { entryKey } from './entryKey';

describe('entryKey', () => {
  it('uses the branch when there is one', () => {
    expect(entryKey({ repoId: 'r_1', branch: 'feat/x', worktreePath: '/wt' })).toBe('r_1:feat/x');
  });

  it('uses the worktree path for detached entries', () => {
    expect(entryKey({ repoId: 'r_1', branch: null, worktreePath: '/Users/me/wt/d' })).toBe('r_1:@/Users/me/wt/d');
  });
});
