// Operations git left half done (SPEC §15 "Operations in progress"): a rebase, merge, cherry-pick
// or revert stopped in an entry's worktree, started from Gitgel or not. Continue and Abort are git
// actions.
import { create } from 'zustand';
import { formatCount } from '../lib/format';
import { t } from '../i18n';
import { gitOperation } from '../lib/ipc';
import type { EntryRef, EntrySummary, FileChange, Operation, OperationKind } from '../lib/types';
import { startGitAction, useRuns } from '../scripts/runs';
import { useData } from '../state/data';

const NAMES: Record<OperationKind, { pill: string; title: string; verb: string }> = {
  rebase: { pill: 'sync.pillRebasing', title: 'sync.titleRebase', verb: 'sync.verbRebase' },
  merge: { pill: 'sync.pillMerging', title: 'sync.titleMerge', verb: 'sync.verbMerge' },
  cherry_pick: { pill: 'sync.pillCherry', title: 'sync.titleCherry', verb: 'sync.verbCherry' },
  revert: { pill: 'sync.pillReverting', title: 'sync.titleRevert', verb: 'sync.verbRevert' },
};

/** "Rebase", "Cherry-Pick": for Continue Rebase, Abort Merge. */
export function operationTitle(op: Operation): string {
  return t(NAMES[op.kind].title);
}

/** `rebasing 2/4` (Branches), `rebasing` when `short` (Review's narrower group line). */
export function operationPill(op: Operation, short = false): string {
  const p = !short && op.step !== null && op.total !== null ? ` ${op.step}/${op.total}` : '';
  return `${t(NAMES[op.kind].pill)}${p}`;
}

/** Where it paused: `commit 2 of 4`, else the commit. */
function pausedAt(op: Operation): string | null {
  if (op.step !== null && op.total !== null)
    return t('sync.pausedAt', { step: formatCount(op.step), total: formatCount(op.total) });
  return op.commit;
}

/** What is in progress, in words: `Rebasing onto main`, `Merging origin/feat`, `Cherry-picking
 * abc1234`. */
function doing(op: Operation): string {
  switch (op.kind) {
    case 'rebase':
      return op.onto ? t('sync.doingRebaseOn', { x: op.onto }) : t('sync.doingRebase');
    case 'merge':
      return op.other ? t('sync.doingMerge', { x: op.other }) : t('sync.doingMergePlain');
    case 'cherry_pick':
      return op.commit ? t('sync.doingCherry', { x: op.commit }) : t('sync.doingCherryPlain');
    case 'revert':
      return op.commit ? t('sync.doingRevert', { x: op.commit }) : t('sync.doingRevertPlain');
  }
}

/** The pill's tooltip (and the Abort dialog's row): `Rebasing onto main, paused at commit 2 of 4`. */
export function operationTooltip(op: Operation): string {
  const at = op.kind === 'rebase' ? pausedAt(op) : null;
  return at ? t('sync.pausedTip', { doing: doing(op), at }) : doing(op);
}

/** The conflicts pill's tooltip: which files still have conflicts. */
export function conflictsTooltip(e: EntrySummary): string {
  const files = e.operation?.unresolved ?? [];
  return files.length > 0
    ? t('sync.conflictsIn', { files: files.join(', ') })
    : t('sync.conflictsTree');
}

/** A file row's conflict mark (T2): only for a conflicted file of an operation in progress. */
export function conflictOf(e: EntrySummary, f: FileChange): 'unresolved' | 'resolved' | undefined {
  if (f.kind !== 'C' || !e.operation) return undefined;
  return e.operation.unresolved.includes(f.path) ? 'unresolved' : 'resolved';
}

/** `repo / branch` (the short SHA when detached). */
export function entryLabel(e: EntrySummary): string {
  return `${e.repoName} / ${e.branch ?? e.shortSha ?? ''}`;
}

/** Review's one-line banner (T2) as a single sentence: `Resolve conflicts to continue
 * rebasing` + the entry's names + `(2/4)`; History's (T4) has no names, so a merge ends at
 * what it merges (`… merging main`). One sentence (not word parts), so agglutinative
 * languages can order it freely; the ref keeps no special styling. */
export function operationBanner(
  op: Operation,
  names = true,
): { tone: 'danger' | 'warning'; lead: string; progress: string | null } {
  const conflicts = op.unresolved.length > 0;
  const start = conflicts ? 'Resolve' : 'Continue';
  const tail = names ? '' : 'Short';
  let lead: string;
  switch (op.kind) {
    case 'rebase':
      lead = t(conflicts ? 'sync.leadRebaseResolve' : 'sync.leadRebaseContinue');
      break;
    case 'merge': {
      const other = op.other ?? t('sync.someBranch');
      lead = t(`sync.leadMerge${start}${tail}`, { other });
      break;
    }
    case 'cherry_pick': {
      const commit = op.commit ?? t('sync.someCommit');
      lead = t(`sync.leadCherry${start}${tail}`, { commit });
      break;
    }
    case 'revert': {
      const commit = op.commit ?? t('sync.someCommit');
      lead = t(`sync.leadRevert${start}${tail}`, { commit });
      break;
    }
  }
  const progress = op.step !== null && op.total !== null ? `(${op.step}/${op.total})` : null;
  return { tone: conflicts ? 'danger' : 'warning', lead, progress };
}

/** Why Continue cannot run now, or null. */
export function continueBlocked(op: Operation): string | null {
  return op.unresolved.length > 0 ? t('sync.fixFirst') : null;
}

/** The git action running in the entry's repository, if any (one at a time per repository). */
export function useGitActionRunning(repoId: string): boolean {
  return useRuns((s) =>
    Object.values(s.runs).some((r) => r.status === 'running' && r.repoId === repoId && r.scriptId.startsWith('git:')),
  );
}

function refOf(e: EntrySummary): EntryRef {
  return { repoId: e.repoId, branch: e.branch, worktreePath: e.branch === null ? e.worktreePath : null };
}

/** The verb for Abort ("Abort the rebase?"): translated directly, never lowercased. */
export function operationVerb(op: Operation): string {
  return t(NAMES[op.kind].verb);
}

export function continueOperation(e: EntrySummary, op: Operation): Promise<void> {
  const branch = e.branch ?? e.shortSha ?? '';
  const done = {
    rebase: op.onto ? t('sync.rebased', { branch, base: op.onto }) : t('sync.rebasedPlain', { branch }),
    merge: op.other
      ? t('sync.doneMerged', { other: op.other, branch })
      : t('sync.doneMergedPlain', { branch }),
    cherry_pick: op.commit
      ? t('sync.doneCherry', { commit: op.commit, branch })
      : t('sync.doneCherryPlain', { branch }),
    revert: op.commit
      ? t('sync.doneRevert', { commit: op.commit, branch })
      : t('sync.doneRevertPlain', { branch }),
  }[op.kind];
  // A next commit that conflicts too ends the run with an error: git says so in the output.
  return startGitAction(
    t('sync.actContinue', { title: operationTitle(op) }),
    t('sync.continuing', { verb: operationVerb(op) }),
    () => gitOperation(refOf(e), false),
    { openOnFail: true, done },
  );
}

export function abortOperation(e: EntrySummary, op: Operation): Promise<void> {
  const branch = e.branch ?? e.shortSha ?? '';
  const done = t('sync.doneAborted', { verb: operationVerb(op), branch });
  return startGitAction(
    t('sync.actAbort', { title: operationTitle(op) }),
    t('sync.aborting', { verb: operationVerb(op) }),
    () => gitOperation(refOf(e), true),
    { openOnFail: true, done },
  );
}

interface OperationUi {
  /** The Abort confirmation is open for this entry (T3). */
  aborting: { entry: EntrySummary; op: Operation } | null;
}

export const useOperationUi = create<OperationUi>()(() => ({ aborting: null }));

/** Abort asks first unless Settings › Prompts › "Aborting a rebase or merge" is off. */
export function askAbort(entry: EntrySummary, op: Operation): void {
  if (useData.getState().config?.settings.prompts.abortOperation === false) void abortOperation(entry, op);
  else useOperationUi.setState({ aborting: { entry, op } });
}
