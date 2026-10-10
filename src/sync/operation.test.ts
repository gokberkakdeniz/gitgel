import { describe, expect, it, vi } from 'vitest';
import type { EntrySummary, Operation } from '../lib/types';
import { continueBlocked, operationBanner, operationPill, operationTooltip } from './operation';

vi.mock('../lib/ipc', () => ({}));

const rebase: Operation = { kind: 'rebase', onto: 'main', other: null, step: 2, total: 4, unresolved: 1 };
const merge: Operation = { kind: 'merge', onto: null, other: 'origin/x', step: null, total: null, unresolved: 0 };

const entry = (conflicts: number): EntrySummary =>
  ({ repoName: 'web-app', branch: 'feat', shortSha: 'abcdef1', conflicts }) as EntrySummary;

const text = (b: ReturnType<typeof operationBanner>) => b.parts.map((p) => p.text).join('');

describe('operation labels', () => {
  it('reads like the design', () => {
    expect(operationPill(rebase)).toBe('rebasing 2/4');
    expect(operationPill(rebase, true)).toBe('rebasing');
    expect(operationPill(merge)).toBe('merging');
    expect(operationTooltip(rebase)).toBe('Rebasing on main · 2 of 4');
    expect(operationTooltip(merge)).toBe('Merging origin/x');
  });

  it('builds the banner and its tone', () => {
    const b = operationBanner(entry(1), rebase);
    expect(text(b)).toBe('Rebasing web-app / feat on main · 2 of 4 · 1 conflict');
    expect(b.tone).toBe('danger');
    const m = operationBanner(entry(2), merge);
    expect(text(m)).toBe('Merging origin/x into web-app / feat · conflicts resolved');
    expect(m.tone).toBe('warning');
    expect(text(operationBanner(entry(0), merge))).toBe('Merging origin/x into web-app / feat');
  });

  it('continues once no file keeps its markers', () => {
    expect(continueBlocked(rebase)).toBe('Resolve the conflicts first');
    expect(continueBlocked(merge)).toBeNull();
  });
});
