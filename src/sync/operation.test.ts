import { describe, expect, it, vi } from 'vitest';
import type { EntrySummary, FileChange, Operation } from '../lib/types';
import { conflictOf, continueBlocked, operationBanner, operationPill, operationTooltip } from './operation';

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

const text = (b: ReturnType<typeof operationBanner>) =>
  b.lead.map((p) => ('text' in p ? p.text : p.ref)).join('') + (b.progress ? ` ${b.progress}` : '');

describe('operation labels', () => {
  it('reads like the design', () => {
    expect(operationPill(rebase)).toBe('rebasing 2/4');
    expect(operationPill(rebase, true)).toBe('rebasing');
    expect(operationPill(merge)).toBe('merging');
    expect(operationTooltip(rebase)).toBe('Rebasing onto main, paused at commit 2 of 4');
    expect(operationTooltip(merge)).toBe('Merging origin/x');
  });

  it('asks to resolve, then to continue', () => {
    const b = operationBanner(rebase);
    expect(text(b)).toBe('Resolve conflicts to continue rebasing (2/4)');
    expect(b.tone).toBe('danger');
    const done = operationBanner({ ...rebase, unresolved: [] });
    expect(text(done)).toBe('Continue rebasing (2/4)');
    expect(done.tone).toBe('warning');
    expect(text(operationBanner(merge))).toBe('Continue merging origin/x into');
    expect(text(operationBanner(merge, false))).toBe('Continue merging origin/x');
  });

  it('marks conflicted files of an operation', () => {
    const e = { operation: rebase } as EntrySummary;
    const file = (path: string, kind: FileChange['kind'] = 'C') => ({ path, kind }) as FileChange;
    expect(conflictOf(e, file('src/auth/session.ts'))).toBe('unresolved');
    expect(conflictOf(e, file('src/auth/config.ts'))).toBe('resolved');
    expect(conflictOf(e, file('src/auth/session.ts', 'M'))).toBeUndefined();
    expect(conflictOf({ operation: null } as EntrySummary, file('a'))).toBeUndefined();
  });

  it('continues once no file keeps its markers', () => {
    expect(continueBlocked(rebase)).toBe('Fix the conflicts first');
    expect(continueBlocked(merge)).toBeNull();
  });
});
