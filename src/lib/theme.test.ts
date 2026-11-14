import { describe, expect, it } from 'vitest';
import { setCustomThemes, themeOf } from '../themes';
import { choiceOf, resolveEffective, themeChoices } from './theme';

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

describe('themeChoices', () => {
  it('has System, Light and Dark for a theme with both modes', () => {
    const github = themeChoices().filter((c) => c.theme === 'github');
    expect(github.map((c) => c.appearance)).toEqual(['system', 'light', 'dark']);
    expect(github[0].name).toBe('GitHub');
  });

  it('has only the mode of a theme with one', () => {
    const night = { id: 'night', name: 'Night', dark: themeOf('gitgel').dark };
    setCustomThemes([{ name: 'night.json', content: JSON.stringify(night) }]);
    expect(
      themeChoices()
        .filter((c) => c.theme === 'night')
        .map((c) => c.appearance),
    ).toEqual(['dark']);
    expect(choiceOf({ theme: 'night', appearance: 'system' })).toEqual({ theme: 'night', appearance: 'dark' });
    expect(resolveEffective({ theme: 'night', appearance: 'light' }, false)).toBe('night-dark');
    setCustomThemes([]);
    expect(choiceOf({ theme: 'night', appearance: 'dark' })).toEqual({ theme: 'gitgel', appearance: 'dark' });
  });
});
