import { describe, expect, it } from 'vitest';
import { basename, dirname, tildify } from './paths';

describe('tildify', () => {
  it('replaces the home prefix', () => {
    expect(tildify('/Users/me/code/web-app', '/Users/me')).toBe('~/code/web-app');
    expect(tildify('/Users/me/code/web-app', '/Users/me/')).toBe('~/code/web-app');
    expect(tildify('/Users/me', '/Users/me')).toBe('~');
  });

  it('leaves other paths alone', () => {
    expect(tildify('/Users/meg/code', '/Users/me')).toBe('/Users/meg/code');
    expect(tildify('/opt/repo', '/Users/me')).toBe('/opt/repo');
    expect(tildify('/Users/me/x', null)).toBe('/Users/me/x');
  });
});

describe('basename / dirname', () => {
  it('splits posix paths', () => {
    expect(basename('/Users/me/code/web-app')).toBe('web-app');
    expect(basename('/Users/me/code/web-app/')).toBe('web-app');
    expect(basename('file.ts')).toBe('file.ts');
    expect(dirname('/Users/me/code/web-app')).toBe('/Users/me/code');
    expect(dirname('src/auth/session.ts')).toBe('src/auth');
    expect(dirname('/top')).toBe('/');
    expect(dirname('file.ts')).toBe('');
  });
});
