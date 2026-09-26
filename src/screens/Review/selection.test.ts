import { describe, expect, it } from 'vitest';
import type { EntrySummary, FileChange, ReviewGroup } from '../../lib/types';
import { compareLabel, defaultMode, dirLabel, resolveSelection } from './selection';

const file = (path: string, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  oldPath: null,
  kind: 'M',
  add: 1,
  del: 0,
  binary: false,
  oldOid: 'a',
  newOid: 'b',
  ...extra,
});

const group = (key: string, paths: string[]) =>
  ({
    entry: { key },
    files: { committed: paths.map((p) => file(p)), uncommitted: [], all: [] },
  }) as unknown as ReviewGroup;

const groups = [group('r:empty', []), group('r:a', ['x.ts', 'y.ts']), group('r:b', ['z.ts'])];

describe('resolveSelection', () => {
  it('defaults to the first file of the first entry with files', () => {
    expect(resolveSelection(groups, 'committed', null)).toEqual({ key: 'r:a', path: 'x.ts' });
    expect(resolveSelection([group('r:empty', [])], 'committed', null)).toBeNull();
  });

  it('keeps a selection that is still listed', () => {
    const sel = { key: 'r:b', path: 'z.ts' };
    expect(resolveSelection(groups, 'committed', sel)).toBe(sel);
  });

  it('falls back to the first file of the same entry, then of any entry', () => {
    expect(resolveSelection(groups, 'committed', { key: 'r:a', path: 'gone.ts' })).toEqual({
      key: 'r:a',
      path: 'x.ts',
    });
    expect(resolveSelection(groups, 'committed', { key: 'r:gone', path: 'z.ts' })).toEqual({
      key: 'r:a',
      path: 'x.ts',
    });
  });
});

describe('dirLabel', () => {
  it('shows the folder, the old path of renames and untracked files', () => {
    expect(dirLabel(file('src/auth/session.ts'))).toBe('src/auth');
    expect(dirLabel(file('package.json'))).toBe('.');
    expect(dirLabel(file('src/auth/tokens.ts', { kind: 'R', oldPath: 'src/auth/token.ts' }))).toBe(
      'src/auth ← src/auth/token.ts',
    );
    expect(dirLabel(file('scripts/debug.ts', { kind: 'U' }))).toBe('scripts · untracked');
  });
});

describe('defaultMode', () => {
  const g = (committed: number, uncommitted: number) =>
    ({
      files: {
        committed: Array.from({ length: committed }, (_, i) => file(`c${i}`)),
        uncommitted: Array.from({ length: uncommitted }, (_, i) => file(`u${i}`)),
        all: [],
      },
    }) as unknown as ReviewGroup;

  it('is committed unless only uncommitted changes exist', () => {
    expect(defaultMode([g(2, 1)])).toBe('committed');
    expect(defaultMode([g(0, 0)])).toBe('committed');
    expect(defaultMode([g(0, 3), g(0, 0)])).toBe('uncommitted');
  });
});

describe('compareLabel', () => {
  const entry = (worktreePath: string | null) =>
    ({ branch: 'feat/x', shortSha: 'abc1234', worktreePath }) as EntrySummary;

  it('names both sides of each mode', () => {
    expect(compareLabel('committed', entry('/wt'))).toBe('merge-base ↔ feat/x');
    expect(compareLabel('uncommitted', entry('/wt'))).toBe('HEAD ↔ working tree');
    expect(compareLabel('all', entry('/wt'))).toBe('merge-base ↔ working tree');
    expect(compareLabel('all', entry(null))).toBe('merge-base ↔ feat/x');
  });
});
