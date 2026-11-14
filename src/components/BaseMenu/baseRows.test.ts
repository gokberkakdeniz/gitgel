import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import type { BaseCandidate, BaseOptions } from '../../lib/types';
import { AUTOMATIC_LABEL, baseRows, initialRow, looksLikeSha, type BaseRow } from './baseRows';

const candidate = (name: string, c: Partial<BaseCandidate> = {}): BaseCandidate => ({
  name,
  remote: name.includes('/'),
  ahead: 0,
  sameAs: null,
  unrelated: false,
  auto: false,
  ...c,
});

const options = (o: Partial<BaseOptions> = {}): BaseOptions => ({
  current: 'origin/master',
  suggested: [{ branch: 'feat/job-queue', contains: 3, total: 5 }],
  defaults: {
    source: 'origin/HEAD',
    candidates: [candidate('master', { ahead: 31 }), candidate('origin/master', { ahead: 4, auto: true })],
  },
  branches: ['feat/job-queue', 'master', 'to-be-deleted'],
  remotes: ['origin/token-rotation-job', 'origin/feat/job-queue'],
  tags: ['v1.0'],
  ...o,
});

const show = (rows: BaseRow[]) =>
  rows.map((r) => [
    r.section,
    r.label === AUTOMATIC_LABEL ? t(r.label) : r.label,
    r.sub ?? r.note ?? '',
    r.selected ? '✓' : '',
  ]);

const labels = (rows: BaseRow[]) => rows.map((r) => (r.label === AUTOMATIC_LABEL ? t(r.label) : r.label));

describe('baseRows', () => {
  it('starts Default with Automatic (checked without a stored base), then both forms', () => {
    expect(show(baseRows(options(), '', false, 'token-rotation-job'))).toEqual([
      ['Suggested', 'feat/job-queue', 'Contains 3 of the 5 commits shown', ''],
      ['Default', 'Automatic', 'uses origin/master', '✓'],
      ['Default', 'master', '31 commits', ''],
      ['Default', 'origin/master', '4 commits', ''],
      ['Other Branches', 'to-be-deleted', '', ''],
      ['Remote Branches', 'origin/token-rotation-job', 'same name', ''],
      ['Remote Branches', 'origin/feat/job-queue', '', ''],
    ]);
  });

  it('checks the stored base in whatever section it is, and nothing else', () => {
    const rows = baseRows(options({ current: 'to-be-deleted' }), '', true, null);
    expect(rows.filter((r) => r.selected).map((r) => r.label)).toEqual(['to-be-deleted']);
  });

  it('notes same-commit and unrelated forms; a single form is the Automatic row only', () => {
    const two = baseRows(
      options({
        defaults: {
          source: 'origin/HEAD',
          candidates: [
            candidate('master', { ahead: 1, sameAs: 'origin/master', auto: true }),
            candidate('origin/master', { ahead: null, unrelated: true }),
          ],
        },
      }),
      '',
      false,
      'x',
    ).filter((r) => r.section === 'Default');
    expect(two.map((r) => [r.label === AUTOMATIC_LABEL ? t(r.label) : r.label, r.note, !!r.disabled])).toEqual([
      ['Automatic', '1 commit', false],
      ['master', 'same as origin/master', false],
      ['origin/master', 'no common ancestor', true],
    ]);
    const one = baseRows(
      options({ defaults: { source: 'master', candidates: [candidate('master', { ahead: 2, auto: true })] } }),
      '',
      false,
      'x',
    ).filter((r) => r.section === 'Default');
    expect(labels(one)).toEqual(['Automatic']);
  });

  it('filters every section and shows tags only when filtering', () => {
    expect(baseRows(options(), 'v1', false, null).map((r) => r.section)).toEqual(['Tags']);
    expect(labels(baseRows(options(), 'auto', false, null))).toEqual(['Automatic']);
  });

  it('opens on the checked row, skipping disabled rows', () => {
    expect(labels(baseRows(options(), '', false, null))[initialRow(baseRows(options(), '', false, null))]).toBe(
      'Automatic',
    );
    const stored = baseRows(options({ current: 'master' }), '', true, null);
    expect(stored[initialRow(stored)].label).toBe('master');
  });

  it('recognises SHA-like text', () => {
    expect(looksLikeSha('3be91a0')).toBe(true);
    expect(looksLikeSha('3be91a')).toBe(false);
    expect(looksLikeSha('main')).toBe(false);
  });
});
