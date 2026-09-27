import { describe, expect, it } from 'vitest';
import { resolveEffective } from './theme';

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
});
