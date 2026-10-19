import { describe, expect, it } from 'vitest';
import type { Hunk } from './changeNav';
import { cutHunks, hunkAt, hunkAtZone, stagedContent, wholeCut, withoutEmptySide } from './lineStage';

const h = (originalStart: number, originalEnd: number, modifiedStart: number, modifiedEnd: number): Hunk => ({
  originalStart,
  originalEnd,
  modifiedStart,
  modifiedEnd,
});

// a b c d e → a B c X Y d (b changed, X Y added after c, e removed): Monaco's line changes.
const original = 'a\nb\nc\nd\ne\n';
const modified = 'a\nB\nc\nX\nY\nd\n';
const hunks = [h(2, 2, 2, 2), h(3, 0, 4, 5), h(5, 5, 6, 0)];
const pick = (side: 'original' | 'modified', from: number, to: number) => ({
  side,
  from,
  to,
  lines: side === 'original' ? 6 : 7,
});

describe('stagedContent', () => {
  it('takes whole changes', () => {
    expect(stagedContent(original, modified, hunks.map(wholeCut), false)).toBe(modified);
    expect(stagedContent(original, modified, [wholeCut(hunks[1])], false)).toBe('a\nb\nc\nX\nY\nd\ne\n');
    expect(stagedContent(original, modified, [wholeCut(hunks[2])], false)).toBe('a\nb\nc\nd\n');
  });

  it('takes picked lines of an insertion', () => {
    expect(stagedContent(original, modified, cutHunks(hunks, pick('modified', 5, 5)), false)).toBe(
      'a\nb\nc\nY\nd\ne\n',
    );
  });

  it('takes a deletion only when the pick spans it', () => {
    // Line 6 (d) is above the removed e, line 7 the empty last line below it.
    expect(cutHunks(hunks, pick('modified', 6, 6))).toEqual([]);
    expect(stagedContent(original, modified, cutHunks(hunks, pick('modified', 6, 7)), false)).toBe('a\nb\nc\nd\n');
  });

  it('pairs lines of a change with as many on both sides', () => {
    const o = 'a\nb\nc\n';
    const m = 'A\nB\nC\n';
    const one = [h(1, 3, 1, 3)];
    expect(stagedContent(o, m, cutHunks(one, pick('modified', 2, 2)), false)).toBe('a\nB\nc\n');
    expect(stagedContent(o, m, cutHunks(one, pick('original', 3, 3)), false)).toBe('a\nb\nC\n');
  });

  it('takes the other side whole when the counts differ', () => {
    const o = 'a\nb\nz\n';
    const m = 'A\nz\n';
    const one = [h(1, 2, 1, 1)];
    // The new line picked replaces both old ones; one old line picked takes the new one with it.
    expect(stagedContent(o, m, cutHunks(one, pick('modified', 1, 1)), false)).toBe('A\nz\n');
    expect(stagedContent(o, m, cutHunks(one, pick('original', 2, 2)), false)).toBe('a\nA\nz\n');
  });

  it('unstages picked lines back to the original', () => {
    // Staged diff: HEAD → index. Unstaging X only leaves the rest staged.
    expect(stagedContent(original, modified, cutHunks(hunks, pick('modified', 4, 4)), true)).toBe(
      'a\nB\nc\nY\nd\n',
    );
    expect(stagedContent(original, modified, hunks.map(wholeCut), true)).toBe(original);
  });

  it('keeps line ends and a missing last newline', () => {
    expect(stagedContent('a\r\nb', 'a\r\nb\r\nc', [wholeCut(h(2, 0, 3, 3))], false)).toBe('a\r\nb\r\nc');
    expect(stagedContent('a', 'a\nb', [wholeCut(h(1, 0, 2, 2))], false)).toBe('a\nb');
    expect(stagedContent('', 'x\ny\n', cutHunks([h(0, 0, 1, 2)], { side: 'modified', from: 1, to: 1, lines: 3 }), false)).toBe(
      'x\n',
    );
  });
});

describe('withoutEmptySide', () => {
  // Monaco shows an empty side as one empty line, replaced by the whole file.
  it('stages picked lines of a new file without that line', () => {
    const m = 'x\ny\nz\n';
    const hs = withoutEmptySide([h(1, 1, 1, 4)], '', m);
    expect(stagedContent('', m, cutHunks(hs, { side: 'modified', from: 1, to: 2, lines: 4 }), false)).toBe('x\ny\n');
    // Unstaging picked lines of a file added in the index keeps the rest.
    expect(stagedContent('', m, cutHunks(hs, { side: 'modified', from: 2, to: 2, lines: 4 }), true)).toBe('x\nz\n');
    expect(stagedContent('', m, hs.map(wholeCut), false)).toBe(m);
  });

  it('stages picked deletions of a deleted file', () => {
    const o = 'x\ny\nz\n';
    const hs = withoutEmptySide([h(1, 4, 1, 1)], o, '');
    expect(stagedContent(o, '', cutHunks(hs, { side: 'original', from: 2, to: 2, lines: 4 }), false)).toBe('x\nz\n');
    expect(stagedContent(o, '', hs.map(wholeCut), false)).toBe('');
  });
});

describe('hunkAt', () => {
  it('finds the change with lines on the side at the line', () => {
    expect(hunkAt(hunks, 'modified', 4)).toBe(hunks[1]);
    expect(hunkAt(hunks, 'modified', 3)).toBeNull();
    expect(hunkAt(hunks, 'original', 5)).toBe(hunks[2]);
    expect(hunkAt(hunks, 'original', 4)).toBeNull();
  });

  it('finds the change of a unified view zone', () => {
    expect(hunkAtZone(hunks, 6)).toBe(hunks[2]);
    expect(hunkAtZone(hunks, 1)).toBe(hunks[0]);
    expect(hunkAtZone(hunks, 3)).toBeNull();
  });
});
