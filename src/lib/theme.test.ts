import { describe, expect, it } from 'vitest';
import { isDarkTheme, resolveEffective } from './theme';

describe('resolveEffective', () => {
  it('keeps an explicit choice whatever the system does', () => {
    expect(resolveEffective('light', true)).toBe('light');
    expect(resolveEffective('light', false)).toBe('light');
    expect(resolveEffective('dark', true)).toBe('dark');
    expect(resolveEffective('dark', false)).toBe('dark');
  });

  it('follows the system when set to system', () => {
    expect(resolveEffective('system', true)).toBe('dark');
    expect(resolveEffective('system', false)).toBe('light');
  });

  it.each(['github-light', 'github-dark'] as const)('keeps %s independent of the system appearance', (theme) => {
    expect(resolveEffective(theme, true)).toBe(theme);
    expect(resolveEffective(theme, false)).toBe(theme);
  });
});

describe('isDarkTheme', () => {
  it('maps GitHub themes to the matching native appearance', () => {
    expect(isDarkTheme('github-dark')).toBe(true);
    expect(isDarkTheme('github-light')).toBe(false);
    expect(isDarkTheme('dark')).toBe(true);
    expect(isDarkTheme('light')).toBe(false);
  });
});
