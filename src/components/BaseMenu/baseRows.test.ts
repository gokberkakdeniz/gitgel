import { describe, expect, it } from 'vitest';
import type { BaseOptions } from '../../lib/types';
import { baseRows, looksLikeSha } from './baseRows';

const options: BaseOptions = {
  current: 'master',
  suggested: [{ branch: 'feat/job-queue', contains: 3, total: 5 }],
  default: { name: 'master', source: 'master' },
  branches: ['feat/job-queue', 'master', 'to-be-deleted'],
  tags: ['v1.0'],
};

describe('baseRows', () => {
  it('lists suggested, default and the other branches without repeats', () => {
    expect(baseRows(options, '').map((r) => [r.section, r.label, r.sub ?? r.note ?? ''])).toEqual([
      ['Suggested', 'feat/job-queue', 'Contains 3 of the 5 commits shown'],
      ['Default', 'master', 'current · from master'],
      ['Other branches', 'to-be-deleted', ''],
    ]);
  });

  it('filters every section and shows tags only when filtering', () => {
    expect(baseRows(options, 'v1').map((r) => r.section)).toEqual(['Tags']);
    expect(baseRows(options, 'QUEUE').map((r) => r.label)).toEqual(['feat/job-queue']);
  });

  it('recognises SHA-like text', () => {
    expect(looksLikeSha('3be91a0')).toBe(true);
    expect(looksLikeSha('3be91a')).toBe(false);
    expect(looksLikeSha('main')).toBe(false);
  });
});
