import { describe, expect, it } from 'vitest';
import { baseNameError, parseDays } from './parse';

describe('settings input', () => {
  it('accepts valid, new base names', () => {
    expect(baseNameError('develop', ['main'])).toBeNull();
    expect(baseNameError('origin/HEAD', ['main'])).toBeNull();
    expect(baseNameError('release/2.0', [])).toBeNull();
  });

  it('rejects duplicates and invalid ref names', () => {
    expect(baseNameError('main', ['origin/HEAD', 'main'])).toBe('main is already in the list');
    for (const bad of [
      '',
      'release candidate',
      'a..b',
      'a~1',
      'x:y',
      'feat/',
      '/x',
      '-x',
      'a.lock',
      '.hidden',
      'a//b',
      'a@{1}',
      'end.',
    ]) {
      expect(baseNameError(bad, [])).toBe('Not a valid branch name');
    }
  });

  it('accepts 1–365 whole days', () => {
    expect(parseDays(' 14 ')).toBe(14);
    expect(parseDays('0')).toBeNull();
    expect(parseDays('366')).toBeNull();
    expect(parseDays('2.5')).toBeNull();
    expect(parseDays('abc')).toBeNull();
  });
});
