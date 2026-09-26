import { describe, expect, it } from 'vitest';
import { parseBaseOrder, parseDays } from './parse';

describe('settings input', () => {
  it('splits the base order on arrows, commas and >', () => {
    expect(parseBaseOrder('origin/HEAD → main → master')).toEqual(['origin/HEAD', 'main', 'master']);
    expect(parseBaseOrder(' master , main> develop ')).toEqual(['master', 'main', 'develop']);
    expect(parseBaseOrder(' → , ')).toEqual([]);
  });

  it('accepts 1–365 whole days', () => {
    expect(parseDays(' 14 ')).toBe(14);
    expect(parseDays('0')).toBeNull();
    expect(parseDays('366')).toBeNull();
    expect(parseDays('2.5')).toBeNull();
    expect(parseDays('abc')).toBeNull();
  });
});
