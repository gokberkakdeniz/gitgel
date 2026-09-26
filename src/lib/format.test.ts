import { describe, expect, it } from 'vitest';
import { formatAge, plural } from './format';

describe('formatAge', () => {
  const now = 1_800_000_000;
  it.each([
    [0, '1m'],
    [59, '1m'],
    [6 * 60, '6m'],
    [59 * 60 + 59, '59m'],
    [3600, '1h'],
    [23 * 3600, '23h'],
    [86400, '1d'],
    [364 * 86400, '364d'],
    [365 * 86400, '1y'],
    [800 * 86400, '2y'],
  ])('%i seconds ago → %s', (ago, expected) => {
    expect(formatAge(now - ago, now)).toBe(expected);
  });

  it('treats future times as just now', () => {
    expect(formatAge(now + 100, now)).toBe('1m');
  });
});

describe('plural', () => {
  it('picks the form by count', () => {
    expect(plural(0, 'branch', 'branches')).toBe('0 branches');
    expect(plural(1, 'branch', 'branches')).toBe('1 branch');
    expect(plural(3, 'repository', 'repositories')).toBe('3 repositories');
  });
});
