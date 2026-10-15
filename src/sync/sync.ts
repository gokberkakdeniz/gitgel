// Fetch, pull and push of one branch (W4a): what each can do, and how a branch stands against
// its remote. Each runs as a git action (SPEC §15 "Sync").
import { gitFetch, gitPull, gitPush, gitRebaseOnBase } from '../lib/ipc';
import { t as translate } from '../i18n';
import { formatCount } from '../lib/format';
import type { EntryRef, Operation, Upstream } from '../lib/types';
import { operationTitle } from './operation';
import { startGitAction } from '../scripts/runs';

export const SYNC_ACTIONS = ['git:fetch', 'git:pull', 'git:push'];

/** A branch as sync needs it; an `EntrySummary` is one. */
export interface SyncTarget {
  repoId: string;
  repoName: string;
  branch: string | null;
  worktreePath: string | null;
  upstream: Upstream | null;
  /** A rebase or merge stopped in its worktree: Pull and Push wait for it. */
  operation?: Operation | null;
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
  if (!u?.name) pull = u ? translate('sync.notOn', { remote: u.remote }) : translate('sync.noRemote');
  else if (u.behind === 0) pull = translate('sync.nothingPull');
  else if (!t.worktreePath) pull = translate('sync.notCheckedOut');
  let push: string | null = null;
  const busy = t.operation ? translate('sync.opBusy', { op: operationTitle(t.operation) }) : null;
  if (busy && u) return { pull: busy, push: busy, diverged };
  if (!u) push = translate('sync.noRemote');
  else if (u.behind > 0) push = translate('sync.behindRemote', { remote: u.remote });
  else if (u.ahead === 0) push = translate('sync.nothingPush');
  return { pull, push, diverged };
}

/** `origin ↑2 ↓1`, `origin` when level, `not on origin · ↑3`. */
export function upstreamLabel(u: Upstream): string {
  if (!u.name)
    return u.ahead > 0
      ? translate('sync.upNotOn', { remote: u.remote, n: formatCount(u.ahead) })
      : translate('sync.upNotOnPlain', { remote: u.remote });
  return [u.remote, u.ahead > 0 && `↑${formatCount(u.ahead)}`, u.behind > 0 && `↓${formatCount(u.behind)}`].filter(Boolean).join(' ');
}

export function upstreamTitle(u: Upstream): string {
  if (!u.name) return translate('sync.upNotYet', { remote: u.remote });
  if (u.ahead === 0 && u.behind === 0) return translate('sync.upLevel', { name: u.name });
  return translate('sync.upCounts', {
    a: u.ahead === 1 ? '1' : '0',
    b: u.behind === 1 ? '1' : '0',
    na: formatCount(u.ahead),
    nb: formatCount(u.behind),
    name: u.name,
  });
}

/** The warning when the branch is ahead and behind its remote. */
export function divergedBanner(t: SyncTarget): string | null {
  const u = t.upstream;
  if (!u || !syncState(t).diverged) return null;
  return translate('sync.diverged', { n: String(u.behind), d: formatCount(u.behind), branch: t.branch ?? '', remote: u.remote });
}

function refOf(t: SyncTarget): EntryRef {
  return { repoId: t.repoId, branch: t.branch, worktreePath: t.branch === null ? t.worktreePath : null };
}

// A failed sync opens its output panel: git says there what went wrong (or asks for a password).
export function fetchRepo(t: SyncTarget): Promise<void> {
  return startGitAction(translate('sync.fetchBtn'), translate('sync.fetching'), () => gitFetch(t.repoId), {
    done: translate('sync.fetched', { repo: t.repoName }),
  });
}

export function pullBranch(t: SyncTarget, rebase = false): Promise<void> {
  return startGitAction(
    rebase ? translate('history.pullRebase') : translate('sync.pullBtn'),
    rebase ? translate('sync.pullingRebase') : translate('sync.pulling'),
    () => gitPull(refOf(t), rebase),
    { done: translate('sync.pulled', { branch: t.branch ?? '' }) },
  );
}

/** The branch rebased on its base, fresh from the base's remote when it has one (SPEC §15). */
export function rebaseOnBase(t: SyncTarget, base: string): Promise<void> {
  return startGitAction(translate('sync.rebaseOn', { base }), translate('sync.rebasingOn', { base }), () => gitRebaseOnBase(refOf(t)), {
    done: translate('sync.rebased', { branch: t.branch ?? '', base }),
  });
}

export function pushBranch(t: SyncTarget): Promise<void> {
  return startGitAction(translate('sync.pushBtn'), translate('sync.pushing'), () => gitPush(refOf(t)), {
    done: translate('sync.pushed', { branch: t.branch ?? '' }),
  });
}

/** A diverged branch over its remote (`--force-with-lease`: only what the last fetch saw). */
export function forcePushBranch(t: SyncTarget): Promise<void> {
  return startGitAction(translate('history.forcePush'), translate('sync.forcePushing'), () => gitPush(refOf(t), true), {
    done: translate('sync.forcePushed', { branch: t.branch ?? '' }),
  });
}
