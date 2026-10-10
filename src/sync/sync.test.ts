import { describe, expect, it, vi } from 'vitest';
import type { Upstream } from '../lib/types';
import { divergedBanner, syncState, upstreamLabel, type SyncTarget } from './sync';

vi.mock('../lib/ipc', () => ({}));

const up = (ahead: number, behind: number, name: string | null = 'origin/x'): Upstream => ({
  remote: 'origin',
  name,
  ahead,
  behind,
  mergeBase: null,
});

const target = (upstream: Upstream | null, worktreePath: string | null = '/wt/x'): SyncTarget => ({
  repoId: 'web-app',
  repoName: 'web-app',
  branch: 'x',
  worktreePath,
  upstream,
});

describe('upstreamLabel', () => {
  it('reads like the design', () => {
    expect(upstreamLabel(up(2, 1))).toBe('origin ↑2 ↓1');
    expect(upstreamLabel(up(1, 0))).toBe('origin ↑1');
    expect(upstreamLabel(up(0, 0))).toBe('origin');
    expect(upstreamLabel(up(3, 0, null))).toBe('not on origin · ↑3');
  });
});

describe('syncState', () => {
  it('pulls a checked-out branch that is behind', () => {
    expect(syncState(target(up(0, 2))).pull).toBeNull();
    expect(syncState(target(up(0, 2), null)).pull).toBe('Not checked out');
    expect(syncState(target(up(1, 0))).pull).toBe('Nothing to pull');
    expect(syncState(target(up(1, 0, null))).pull).toBe('Not on origin');
  });

  it('pushes what is ahead and not behind, checked out or not, new branches too', () => {
    expect(syncState(target(up(1, 0), null)).push).toBeNull();
    expect(syncState(target(up(3, 0, null))).push).toBeNull();
    expect(syncState(target(up(0, 0))).push).toBe('Nothing to push');
    expect(syncState(target(up(2, 1))).push).toBe('Behind origin, pull first');
    expect(syncState(target(null)).push).toBe('No remote');
  });

  it('waits for an operation in progress', () => {
    const op = { kind: 'rebase' as const, onto: 'main', other: null, commit: null, subject: null, step: 2, total: 4, unresolved: ['a.ts'] };
    const st = syncState({ ...target(up(2, 1)), operation: op });
    expect([st.pull, st.push]).toEqual(['Rebase in progress', 'Rebase in progress']);
  });

  it('warns when diverged', () => {
    expect(syncState(target(up(2, 1))).diverged).toBe(true);
    expect(divergedBanner(target(up(2, 1)))).toBe(
      'x is behind origin by 1 commit, so it cannot be pushed. Pull it first.',
    );
    expect(divergedBanner(target(up(0, 1)))).toBeNull();
  });
});
