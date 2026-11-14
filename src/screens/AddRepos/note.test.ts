import { describe, expect, it } from 'vitest';
import type { FolderCheck } from '../../lib/types';
import { note } from './AddReposSheet';

const check = (c: Partial<FolderCheck>): FolderCheck => ({
  input: '/x',
  kind: 'repo',
  repoPath: '/r/web-app',
  via: null,
  duplicateOf: null,
  defaultBase: null,
  ...c,
});

describe('sheet notes', () => {
  it.each<[Partial<FolderCheck>, string]>([
    [{ defaultBase: 'main' }, 'Git repository · default base main'],
    [{}, 'Git repository · no default base found'],
    [{ kind: 'resolved', via: 'worktree' }, 'Worktree of /r/web-app · adds the main repository'],
    [{ kind: 'resolved', via: 'subdir' }, 'Inside /r/web-app · adds the repository root'],
    [
      { kind: 'duplicate', via: 'worktree', duplicateOf: 'batch' },
      'Worktree of /r/web-app · already in this list, skipped',
    ],
    [{ kind: 'duplicate', via: 'worktree', duplicateOf: 'config' }, 'Worktree of /r/web-app · already added, skipped'],
    [{ kind: 'duplicate', duplicateOf: 'config' }, 'Already added · skipped'],
    [{ kind: 'duplicate', duplicateOf: 'batch' }, 'Already in this list · skipped'],
    [{ kind: 'not_git', repoPath: null }, 'Not a git repository · skipped'],
  ])('%o', (c, expected) => {
    expect(note(check(c))).toBe(expected);
  });
});
