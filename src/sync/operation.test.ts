import { describe, expect, it, vi } from 'vitest';
import type { EntrySummary, Operation } from '../lib/types';
import { continueBlocked, operationBanner, operationPill, operationTooltip } from './operation';

vi.mock('../lib/ipc', () => ({}));

const rebase: Operation = {
  kind: 'rebase',
  onto: 'main',
  other: null,
  commit: 'fe7be12',
  subject: 'Refresh the session',
  step: 2,
  total: 4,
  unresolved: ['src/auth/session.ts'],
};
const merge: Operation = {
  kind: 'merge',
  onto: null,
  other: 'origin/x',
  commit: null,
  subject: null,
  step: null,
  total: null,
  unresolved: [],
};

const entry = (conflicts: number): EntrySummary =>
  ({ repoName: 'web-app', branch: 'feat', shortSha: 'abcdef1', conflicts }) as EntrySummary;

const text = (b: ReturnType<typeof operationBanner>) =>
  b.what.map((p) => ('text' in p ? p.text : 'ref' in p ? p.ref : `${p.sha} “${p.subject}”`)).join('');

describe('operation labels', () => {
  it('reads like the design', () => {
    expect(operationPill(rebase)).toBe('rebasing 2/4');
    expect(operationPill(rebase, true)).toBe('rebasing');
    expect(operationPill(merge)).toBe('merging');
    expect(operationTooltip(rebase)).toBe('Rebasing onto main, paused at commit 2 of 4');
    expect(operationTooltip(merge)).toBe('Merging origin/x');
  });

  it('says where it paused, which files conflict and what is next', () => {
    const b = operationBanner(entry(1), rebase);
    expect(text(b)).toBe('Rebasing onto main paused at commit 2 of 4, fe7be12 “Refresh the session”.');
    expect(b.files).toEqual(['src/auth/session.ts']);
    expect(b.next).toBe('Fix it in your editor, then Continue.');
    expect(b.tone).toBe('danger');

    const done = operationBanner(entry(1), { ...rebase, unresolved: [] });
    expect(done.tone).toBe('warning');
    expect(done.next).toBe('Conflicts resolved. Continue commits it and applies the remaining 2 commits.');
    expect(operationBanner(entry(1), { ...rebase, step: 4, unresolved: [] }).next).toBe(
      'Conflicts resolved. Continue commits it and finishes the rebase.',
    );

    const m = operationBanner(entry(2), merge);
    expect(text(m)).toBe('Merging origin/x into this branch paused.');
    expect(m.next).toBe('Conflicts resolved. Continue commits the merge.');
  });

  it('continues once no file keeps its markers', () => {
    expect(continueBlocked(rebase)).toBe('Fix the conflicts first');
    expect(continueBlocked(merge)).toBeNull();
  });
});
