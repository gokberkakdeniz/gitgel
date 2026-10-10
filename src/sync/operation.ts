// Operations git left half done (SPEC §15 "Operations in progress"): a rebase, merge, cherry-pick
// or revert stopped in an entry's worktree, started from Gitgel or not. Continue and Abort are git
// actions.
import { create } from 'zustand';
import { gitOperation } from '../lib/ipc';
import type { EntryRef, EntrySummary, FileChange, Operation, OperationKind } from '../lib/types';
import { startGitAction, useRuns } from '../scripts/runs';
import { useData } from '../state/data';

const NAMES: Record<OperationKind, { pill: string; title: string; verb: string }> = {
  rebase: { pill: 'rebasing', title: 'Rebase', verb: 'rebase' },
  merge: { pill: 'merging', title: 'Merge', verb: 'merge' },
  cherry_pick: { pill: 'cherry-picking', title: 'Cherry-Pick', verb: 'cherry-pick' },
  revert: { pill: 'reverting', title: 'Revert', verb: 'revert' },
};

/** "Rebase", "Cherry-Pick": for Continue Rebase, Abort Merge. */
export function operationTitle(op: Operation): string {
  return NAMES[op.kind].title;
}

/** `rebasing 2/4` (Branches), `rebasing` when `short` (Review's narrower group line). */
export function operationPill(op: Operation, short = false): string {
  const p = !short && op.step !== null && op.total !== null ? ` ${op.step}/${op.total}` : '';
  return `${NAMES[op.kind].pill}${p}`;
}

/** Where it paused: `commit 2 of 4`, else the commit. */
function pausedAt(op: Operation): string | null {
  if (op.step !== null && op.total !== null) return `commit ${op.step} of ${op.total}`;
  return op.commit;
}

/** What is in progress, in words: `Rebasing onto main`, `Merging origin/feat`, `Cherry-picking
 * abc1234`. */
function doing(op: Operation): string {
  switch (op.kind) {
    case 'rebase':
      return op.onto ? `Rebasing onto ${op.onto}` : 'Rebasing';
    case 'merge':
      return op.other ? `Merging ${op.other}` : 'Merging';
    case 'cherry_pick':
      return op.commit ? `Cherry-picking ${op.commit}` : 'Cherry-picking';
    case 'revert':
      return op.commit ? `Reverting ${op.commit}` : 'Reverting';
  }
}

/** The pill's tooltip (and the Abort dialog's row): `Rebasing onto main, paused at commit 2 of 4`. */
export function operationTooltip(op: Operation): string {
  const at = op.kind === 'rebase' ? pausedAt(op) : null;
  return at ? `${doing(op)}, paused at ${at}` : doing(op);
}

/** The conflicts pill's tooltip: which files still have conflicts. */
export function conflictsTooltip(e: EntrySummary): string {
  const files = e.operation?.unresolved ?? [];
  return files.length > 0 ? `Conflicts in ${files.join(', ')}` : 'Merge conflicts in the working tree';
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

/** A piece of the banner's text: words, or a ref or SHA (mono). */
export type BannerPart = { text: string } | { ref: string };

/** Review's one-line banner (T2): `Resolve conflicts to continue rebasing` + the entry's names +
 * `(2/4)`; `Continue rebasing` once no conflicted file keeps git's markers. History's (T4) has no
 * names, so a merge ends at what it merges (`… merging main`). */
export function operationBanner(
  op: Operation,
  names = true,
): { tone: 'danger' | 'warning'; lead: BannerPart[]; progress: string | null } {
  const conflicts = op.unresolved.length > 0;
  const lead: BannerPart[] = [{ text: conflicts ? 'Resolve conflicts to continue ' : 'Continue ' }];
  switch (op.kind) {
    case 'rebase':
      lead.push({ text: 'rebasing' });
      break;
    case 'merge':
      lead.push({ text: 'merging ' }, op.other ? { ref: op.other } : { text: 'a branch' }, ...(names ? [{ text: ' into' }] : []));
      break;
    case 'cherry_pick':
      lead.push({ text: 'cherry-picking ' }, op.commit ? { ref: op.commit } : { text: 'a commit' }, ...(names ? [{ text: ' onto' }] : []));
      break;
    case 'revert':
      lead.push({ text: 'reverting ' }, op.commit ? { ref: op.commit } : { text: 'a commit' }, ...(names ? [{ text: ' on' }] : []));
      break;
  }
  const progress = op.step !== null && op.total !== null ? `(${op.step}/${op.total})` : null;
  return { tone: conflicts ? 'danger' : 'warning', lead, progress };
}

/** Why Continue cannot run now, or null. */
export function continueBlocked(op: Operation): string | null {
  return op.unresolved.length > 0 ? 'Fix the conflicts first' : null;
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

export function continueOperation(e: EntrySummary, op: Operation): Promise<void> {
  const branch = e.branch ?? e.shortSha ?? '';
  const done = {
    rebase: `Rebased ${branch}${op.onto ? ` onto ${op.onto}` : ''}`,
    merge: `Merged ${op.other ? `${op.other} ` : ''}into ${branch}`,
    cherry_pick: `Cherry-picked ${op.commit ? `${op.commit} ` : ''}onto ${branch}`,
    revert: `Reverted ${op.commit ? `${op.commit} ` : ''}on ${branch}`,
  }[op.kind];
  // A next commit that conflicts too ends the run with an error: git says so in the output.
  return startGitAction(`Continue ${operationTitle(op)}`, () => gitOperation(refOf(e), false), { openOnFail: true, done });
}

export function abortOperation(e: EntrySummary, op: Operation): Promise<void> {
  const branch = e.branch ?? e.shortSha ?? '';
  const done = `Aborted the ${NAMES[op.kind].verb} of ${branch}`;
  return startGitAction(`Abort ${operationTitle(op)}`, () => gitOperation(refOf(e), true), { openOnFail: true, done });
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
