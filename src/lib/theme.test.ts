import { describe, expect, it } from 'vitest';
import { resolveEffective } from './theme';

describe('resolveEffective', () => {
  it('keeps an explicit choice whatever the system does', () => {
    expect(resolveEffective('light', true)).toBe('gitgel-light');
    expect(resolveEffective('light', false)).toBe('gitgel-light');
    expect(resolveEffective('dark', true)).toBe('gitgel-dark');
    expect(resolveEffective('dark', false)).toBe('gitgel-dark');
  });

  it('follows the system when set to system', () => {
    expect(resolveEffective('system', true)).toBe('gitgel-dark');
    expect(resolveEffective('system', false)).toBe('gitgel-light');
  });

  it.each(['github-light', 'github-dark'] as const)('keeps %s independent of the system appearance', (theme) => {
    expect(resolveEffective(theme, true)).toBe(theme);
    expect(resolveEffective(theme, false)).toBe(theme);
  });
});
