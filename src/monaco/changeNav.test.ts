import { describe, expect, it } from 'vitest';
import { hunkAtScroll, hunkTarget, next, prev, type Hunk } from './changeNav';

const files = ['g1\0a.ts', 'g1\0b.ts', 'g2\0c.ts'];
const at = (index: number | null, count: number, fileIndex: number) => ({ index, count, files, fileIndex });

describe('next / prev', () => {
  it('walks the hunks of a file', () => {
    expect(next(at(null, 3, 1))).toEqual({ kind: 'hunk', index: 0 });
    expect(next(at(0, 3, 1))).toEqual({ kind: 'hunk', index: 1 });
    expect(prev(at(2, 3, 1))).toEqual({ kind: 'hunk', index: 1 });
  });

  it('continues into the neighbouring files at the edges', () => {
    expect(next(at(2, 3, 1))).toEqual({ kind: 'file', key: 'g2\0c.ts', land: 'first' });
    expect(prev(at(0, 3, 1))).toEqual({ kind: 'file', key: 'g1\0a.ts', land: 'last' });
  });

  it('stops at the very first and last change', () => {
    expect(prev(at(0, 2, 0))).toBeNull();
    expect(next(at(1, 2, 2))).toBeNull();
  });

  it('goes to the first / last listed file from a file the filter hides', () => {
    expect(next(at(2, 3, -1))).toEqual({ kind: 'file', key: 'g1\0a.ts', land: 'first' });
    expect(prev(at(0, 3, -1))).toEqual({ kind: 'file', key: 'g2\0c.ts', land: 'last' });
    // Its own changes still come first.
    expect(next(at(0, 3, -1))).toEqual({ kind: 'hunk', index: 1 });
  });

  it('moves straight between files when a file has no line changes', () => {
    expect(next(at(null, 0, 1))).toEqual({ kind: 'file', key: 'g2\0c.ts', land: 'first' });
    expect(prev(at(null, 0, 1))).toEqual({ kind: 'file', key: 'g1\0a.ts', land: 'last' });
  });
});

describe('hunks', () => {
  const hunks: Hunk[] = [
    { originalStart: 3, originalEnd: 3, modifiedStart: 3, modifiedEnd: 4 },
    { originalStart: 20, originalEnd: 22, modifiedStart: 20, modifiedEnd: 0 },
    { originalStart: 50, originalEnd: 0, modifiedStart: 49, modifiedEnd: 55 },
  ];

  it('lands everything in the modified editor when unified', () => {
    expect(hunkTarget(hunks[1], true)).toEqual({ side: 'modified', line: 20 });
    expect(hunkTarget({ originalStart: 1, originalEnd: 2, modifiedStart: 0, modifiedEnd: 0 }, true)).toEqual({
      side: 'modified',
      line: 1,
    });
  });

  it('lands deletions on the original side', () => {
    expect(hunkTarget(hunks[0])).toEqual({ side: 'modified', line: 3 });
    expect(hunkTarget(hunks[1])).toEqual({ side: 'original', line: 20 });
    expect(hunkTarget(hunks[2])).toEqual({ side: 'modified', line: 49 });
  });

  it('follows manual scrolling', () => {
    expect(hunkAtScroll(hunks, 1)).toBe(0);
    expect(hunkAtScroll(hunks, 5)).toBe(1);
    expect(hunkAtScroll(hunks, 21)).toBe(2);
    expect(hunkAtScroll(hunks, 900)).toBe(2);
    expect(hunkAtScroll([], 1)).toBeNull();
  });
});
