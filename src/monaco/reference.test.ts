import { describe, expect, it } from 'vitest';
import type { RemoteInfo } from '../lib/types';
import { commitUrl, fileReference, permalink } from './reference';

const github: RemoteInfo = { base: 'https://github.com/o/r', kind: 'github' };
const gitlab: RemoteInfo = { base: 'https://gitlab.com/g/sub/r', kind: 'gitlab' };
const bitbucket: RemoteInfo = { base: 'https://bitbucket.org/o/r', kind: 'bitbucket' };
const other: RemoteInfo = { base: 'https://gitea.example.com/o/r', kind: 'other' };

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
    expect(permalink(github, 'abc123', 'src/a b.ts', 12, 12)).toBe(
      'https://github.com/o/r/blob/abc123/src/a%20b.ts#L12',
    );
    expect(permalink(github, 'abc123', 'a.ts', 12, 14, 1)).toBe('https://github.com/o/r/blob/abc123/a.ts#L12-L13');
  });

  it('shapes the link by host', () => {
    expect(permalink(gitlab, 'abc123', 'a.ts', 12, 14, 1)).toBe(
      'https://gitlab.com/g/sub/r/-/blob/abc123/a.ts#L12-L13',
    );
    expect(permalink(bitbucket, 'abc123', 'a.ts', 12, 14, 1)).toBe(
      'https://bitbucket.org/o/r/src/abc123/a.ts#lines-12:13',
    );
    expect(permalink(other, 'abc123', 'a.ts', 12, 12)).toBe('https://gitea.example.com/o/r/blob/abc123/a.ts#L12');
  });
});

describe('commitUrl', () => {
  it('links the commit by host', () => {
    expect(commitUrl(github, 'abc123')).toBe('https://github.com/o/r/commit/abc123');
    expect(commitUrl(gitlab, 'abc123')).toBe('https://gitlab.com/g/sub/r/-/commit/abc123');
    expect(commitUrl(bitbucket, 'abc123')).toBe('https://bitbucket.org/o/r/commits/abc123');
    expect(commitUrl(other, 'abc123')).toBe('https://gitea.example.com/o/r/commit/abc123');
  });
});
