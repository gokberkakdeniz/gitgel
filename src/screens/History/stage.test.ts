import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../lib/types';
import { withMoves } from './stage';

const f = (path: string, kind: FileChange['kind'], add = 1): FileChange => ({
  path,
  oldPath: null,
  kind,
  add,
  del: 0,
  binary: false,
  oldOid: null,
  newOid: null,
});

describe('withMoves', () => {
  // a: staged and changed again; b: staged; c: unstaged; u: untracked. `whole` is against HEAD.
  const index = { staged: [f('a', 'M', 1), f('b', 'A')], unstaged: [f('a', 'M', 2), f('c', 'M'), f('u', 'U')] };
  const whole = [f('a', 'M', 3), f('b', 'A'), f('c', 'M'), f('u', 'U')];
  const paths = (l: FileChange[]) => l.map((x) => x.path);

  it('leaves the index alone without moves', () => {
    expect(withMoves(index, whole, undefined)).toBe(index);
  });

  it('stages a file whole, its later changes too', () => {
    const r = withMoves(index, whole, { a: 'staged' });
    expect(paths(r.staged)).toEqual(['a', 'b']);
    expect(r.staged[0].add).toBe(3);
    expect(paths(r.unstaged)).toEqual(['c', 'u']);
  });

  it('unstages a file whole; a new one is untracked again', () => {
    const r = withMoves(index, whole, { a: 'unstaged', b: 'unstaged' });
    expect(r.staged).toEqual([]);
    expect(paths(r.unstaged)).toEqual(['a', 'b', 'c', 'u']);
    expect(r.unstaged[1].kind).toBe('U');
  });

  it('stages an untracked file as new', () => {
    const r = withMoves(index, whole, { u: 'staged' });
    expect(paths(r.staged)).toEqual(['a', 'b', 'u']);
    expect(r.staged[2].kind).toBe('A');
  });
});
