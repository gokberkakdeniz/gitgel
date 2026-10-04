import { describe, expect, it } from 'vitest';
import type { EntrySummary, FileChange, ReviewGroup } from '../lib/types';
import type { ReviewStash } from '../screens/Review/stashes';
import { stashNote, stashRows } from './StashDialog';
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
  lastCommitAt: 0,
  changedAt: null,
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

const group = (e: EntrySummary, uncommitted: FileChange[]): ReviewGroup => ({
  entry: e,
  mergeBase: null,
  files: { committed: [], uncommitted, all: uncommitted },
  commits: [],
  stackHint: null,
});

describe('stashRows', () => {
  it('lists checked-out entries with their uncommitted and untracked files', () => {
    const rows = stashRows([
      group(entry('web-app', 'a', '/wt/a'), [file('x.ts', 'M'), file('new.ts', 'U')]),
      group(entry('web-app', 'b', null), []),
      group(entry('api', 'c', '/wt/c'), []),
    ]);
    expect(rows.map((r) => [r.entry.branch, r.files, r.untracked])).toEqual([
      ['a', 2, 1],
      ['c', 0, 0],
    ]);
  });
});

describe('stashNote', () => {
  it('says how many stashes a repo gets when it gets several', () => {
    expect(stashNote([entry('web-app', 'a', '/a')])).toBe('One stash per entry, same message.');
    expect(stashNote([entry('web-app', 'a', '/a'), entry('web-app', 'b', '/b'), entry('api', 'c', '/c')])).toBe(
      'One stash per entry, same message. Both are in web-app, so its stack gets 2 new stashes.',
    );
    expect(stashNote(['a', 'b', 'c'].map((b) => entry('web-app', b, `/${b}`)))).toBe(
      'One stash per entry, same message. 3 are in web-app, so its stack gets 3 new stashes.',
    );
  });
});

describe('stashTargets', () => {
  it('lists checked-out entries, the stash branch first', () => {
    const stash = { branch: 'b' } as ReviewStash;
    const active = [entry('web-app', 'main', '/main'), entry('web-app', 'x', null), entry('web-app', 'b', '/b')];
    expect(stashTargets(stash, active).map((e) => e.branch)).toEqual(['b', 'main']);
  });
});
