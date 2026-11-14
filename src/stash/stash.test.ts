import { describe, expect, it } from 'vitest';
import type { EntrySummary, FileChange } from '../lib/types';
import type { ReviewStash } from '../screens/Review/stashes';
import { stashPush } from './StashDialog';
import { stashTargets } from './StashTargetMenu';

const entry = (repoName: string, branch: string | null, worktreePath: string | null): EntrySummary => ({
  key: `${repoName}:${branch ?? worktreePath}`,
  repoId: repoName,
  repoName,
  branch,
  worktreePath,
  headSha: 'abc1234',
  shortSha: 'abc1234',
  base: 'main',
  baseIsCustom: false,
  ahead: 1,
  behind: 0,
  files: 1,
  add: 1,
  del: 0,
  uncommitted: worktreePath ? 1 : null,
  conflicts: 0,
  lastCommitAt: 0,
  changedAt: null,
  upstream: null,
  operation: null,
  state: 'ok',
  error: null,
});

const file = (path: string, kind: FileChange['kind']): FileChange => ({
  path,
  oldPath: null,
  kind,
  add: 1,
  del: 0,
  binary: false,
  oldOid: null,
  newOid: null,
});

describe('stashTargets', () => {
  it('lists checked-out entries, the stash branch first', () => {
    const stash = { branch: 'b' } as ReviewStash;
    const active = [entry('web-app', 'main', '/main'), entry('web-app', 'x', null), entry('web-app', 'b', '/b')];
    expect(stashTargets(stash, active).map((e) => e.branch)).toEqual(['b', 'main']);
  });
});

describe('stashPush', () => {
  const a = entry('web-app', 'a', '/wt/a');
  const renamed: FileChange = { ...file('new-name.ts', 'R'), oldPath: 'old-name.ts' };
  const files = [file('x.ts', 'M'), file('new.ts', 'U'), renamed];

  it('sends no paths for all the files, or when every file is picked', () => {
    const all = { repoId: 'web-app', branch: 'a', worktreePath: null, paths: null, untracked: true };
    expect(stashPush(a, files, null)).toEqual(all);
    expect(stashPush(a, files, [...files])).toEqual(all);
  });

  it('sends the picked paths once, a rename with its old path, untracked only when one is picked', () => {
    // A file staged and changed again is picked as two rows.
    expect(stashPush(a, files, [file('x.ts', 'M'), file('x.ts', 'M'), renamed])).toEqual({
      repoId: 'web-app',
      branch: 'a',
      worktreePath: null,
      paths: ['x.ts', 'old-name.ts', 'new-name.ts'],
      untracked: false,
    });
    expect(stashPush(a, files, [file('new.ts', 'U')]).untracked).toBe(true);
  });

  it('names a detached worktree by its folder', () => {
    expect(stashPush(entry('web-app', null, '/wt/d'), files, null).worktreePath).toBe('/wt/d');
  });
});
