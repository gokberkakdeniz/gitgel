import { describe, expect, it } from 'vitest';
import { THEME_CHOICES, resolveEffective } from './theme';

describe('resolveEffective', () => {
  it('keeps an explicit mode whatever the system does', () => {
    expect(resolveEffective({ theme: 'gitgel', appearance: 'light' }, true)).toBe('gitgel-light');
    expect(resolveEffective({ theme: 'gitgel', appearance: 'dark' }, false)).toBe('gitgel-dark');
    expect(resolveEffective({ theme: 'github', appearance: 'light' }, true)).toBe('github-light');
  });

  it('follows the system in any theme when set to system', () => {
    expect(resolveEffective({ theme: 'gitgel', appearance: 'system' }, true)).toBe('gitgel-dark');
    expect(resolveEffective({ theme: 'github', appearance: 'system' }, true)).toBe('github-dark');
    expect(resolveEffective({ theme: 'github', appearance: 'system' }, false)).toBe('github-light');
  });

  it('reads a theme that is not there as the default', () => {
    expect(resolveEffective({ theme: 'gone', appearance: 'dark' }, false)).toBe('gitgel-dark');
  });
});

describe('THEME_CHOICES', () => {
  it('has System, Light and Dark for every theme', () => {
    const github = THEME_CHOICES.filter((c) => c.theme === 'github');
    expect(github.map((c) => c.appearance)).toEqual(['system', 'light', 'dark']);
    expect(github[0].name).toBe('GitHub');
  });
});
