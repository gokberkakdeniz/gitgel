// Fetch, pull and push of one branch (W4a): what each can do, and how a branch stands against
// its remote. Each runs as a git action (SPEC §15 "Sync").
import { gitFetch, gitPull, gitPush, gitRebaseOnBase } from '../lib/ipc';
import { plural } from '../lib/format';
import type { EntryRef, Upstream } from '../lib/types';
import { startGitAction } from '../scripts/runs';

export const SYNC_ACTIONS = ['git:fetch', 'git:pull', 'git:push'];

/** A branch as sync needs it; an `EntrySummary` is one. */
export interface SyncTarget {
  repoId: string;
  repoName: string;
  branch: string | null;
  worktreePath: string | null;
  upstream: Upstream | null;
}

/** What each action can do now, and why not (a tooltip) when it cannot. */
export interface SyncState {
  pull: string | null;
  push: string | null;
  /** Ahead and behind: Push waits for a pull. */
  diverged: boolean;
}

export function syncState(t: SyncTarget): SyncState {
  const u = t.upstream;
  const diverged = !!u?.name && u.ahead > 0 && u.behind > 0;
  let pull: string | null = null;
  if (!u?.name) pull = u ? `Not on ${u.remote}` : 'No remote';
  else if (u.behind === 0) pull = 'Nothing to pull';
  else if (!t.worktreePath) pull = 'Not checked out';
  let push: string | null = null;
  if (!u) push = 'No remote';
  else if (u.behind > 0) push = `Behind ${u.remote}, pull first`;
  else if (u.ahead === 0) push = 'Nothing to push';
  return { pull, push, diverged };
}

/** `origin ↑2 ↓1`, `origin` when level, `not on origin · ↑3`. */
export function upstreamLabel(u: Upstream): string {
  if (!u.name) return u.ahead > 0 ? `not on ${u.remote} · ↑${u.ahead}` : `not on ${u.remote}`;
  return [u.remote, u.ahead > 0 && `↑${u.ahead}`, u.behind > 0 && `↓${u.behind}`].filter(Boolean).join(' ');
}

export function upstreamTitle(u: Upstream): string {
  if (!u.name) return `Not on ${u.remote} yet (as of the last fetch)`;
  if (u.ahead === 0 && u.behind === 0) return `Level with ${u.name}`;
  return `${plural(u.ahead, 'commit', 'commits')} to push, ${plural(u.behind, 'commit', 'commits')} to pull (${u.name})`;
}

/** The warning when the branch is ahead and behind its remote. */
export function divergedBanner(t: SyncTarget): string | null {
  const u = t.upstream;
  if (!u || !syncState(t).diverged) return null;
  return `${t.branch} is behind ${u.remote} by ${plural(u.behind, 'commit', 'commits')}, so it cannot be pushed. Pull it first.`;
}

function refOf(t: SyncTarget): EntryRef {
  return { repoId: t.repoId, branch: t.branch, worktreePath: t.branch === null ? t.worktreePath : null };
}

// A failed sync opens its output panel: git says there what went wrong (or asks for a password).
export function fetchRepo(t: SyncTarget): Promise<void> {
  return startGitAction('Fetch', () => gitFetch(t.repoId), { openOnFail: true, done: `Fetched ${t.repoName}` });
}

export function pullBranch(t: SyncTarget, rebase = false): Promise<void> {
  return startGitAction(rebase ? 'Pull (rebase)' : 'Pull', () => gitPull(refOf(t), rebase), {
    openOnFail: true,
    done: `Pulled ${t.branch}`,
  });
}

/** The branch rebased on its base, fresh from the base's remote when it has one (SPEC §15). */
export function rebaseOnBase(t: SyncTarget, base: string): Promise<void> {
  return startGitAction(`Rebase on ${base}`, () => gitRebaseOnBase(refOf(t)), {
    openOnFail: true,
    done: `Rebased ${t.branch} on ${base}`,
  });
}

export function pushBranch(t: SyncTarget): Promise<void> {
  return startGitAction('Push', () => gitPush(refOf(t)), { openOnFail: true, done: `Pushed ${t.branch}` });
}

/** A diverged branch over its remote (`--force-with-lease`: only what the last fetch saw). */
export function forcePushBranch(t: SyncTarget): Promise<void> {
  return startGitAction('Force push', () => gitPush(refOf(t), true), {
    openOnFail: true,
    done: `Force pushed ${t.branch}`,
  });
}
