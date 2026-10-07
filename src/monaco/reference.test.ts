import { describe, expect, it } from 'vitest';
import { fileReference, permalink } from './reference';

describe('fileReference', () => {
  it('names one line or a range', () => {
    expect(fileReference('src/a.ts', 12, 12)).toBe('@src/a.ts:12');
    expect(fileReference('src/a.ts', 12, 13)).toBe('@src/a.ts:12-13');
  });

  it('leaves out a last line the selection only touches', () => {
    expect(fileReference('a.ts', 12, 14, 1)).toBe('@a.ts:12-13');
    expect(fileReference('a.ts', 12, 13, 1)).toBe('@a.ts:12');
  });
});

describe('permalink', () => {
  it('links the lines at the commit', () => {
    expect(permalink('https://github.com/o/r', 'abc123', 'src/a b.ts', 12, 12)).toBe(
      'https://github.com/o/r/blob/abc123/src/a%20b.ts#L12',
    );
    expect(permalink('https://github.com/o/r', 'abc123', 'a.ts', 12, 14, 1)).toBe(
      'https://github.com/o/r/blob/abc123/a.ts#L12-L13',
    );
  });
});
