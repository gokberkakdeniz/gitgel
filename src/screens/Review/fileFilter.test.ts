import { describe, expect, it } from 'vitest';
import { fileMatches, filterTerms, firstHit } from './fileFilter';

describe('filterTerms', () => {
  it('splits on spaces and lowercases', () => {
    expect(filterTerms('  Auth  Test ')).toEqual(['auth', 'test']);
    expect(filterTerms('   ')).toEqual([]);
  });
});

describe('fileMatches', () => {
  const f = (path: string, oldPath: string | null = null) => ({ path, oldPath });

  it('needs every term somewhere in the path, in any order', () => {
    expect(fileMatches(f('src/auth/session.ts'), ['auth', 'sess'])).toBe(true);
    expect(fileMatches(f('src/auth/session.ts'), ['sess', 'src'])).toBe(true);
    expect(fileMatches(f('src/auth/session.ts'), ['auth', 'token'])).toBe(false);
  });

  it('counts a rename’s old path', () => {
    expect(fileMatches(f('src/auth/tokens.ts', 'src/auth/token.ts'), ['token.ts'])).toBe(true);
    expect(fileMatches(f('src/auth/tokens.ts', 'lib/old.ts'), ['old', 'tokens'])).toBe(true);
  });

  it('matches everything without terms', () => {
    expect(fileMatches(f('a.ts'), [])).toBe(true);
  });
});

describe('firstHit', () => {
  it('splits around the first term that occurs, keeping the original case', () => {
    expect(firstHit('SessionStore.ts', ['store', 'session'])).toEqual(['Session', 'Store', '.ts']);
    expect(firstHit('src/auth', ['missing', 'auth'])).toEqual(['src/', 'auth', '']);
  });

  it('is null when nothing occurs', () => {
    expect(firstHit('src/auth', ['token'])).toBeNull();
  });
});
