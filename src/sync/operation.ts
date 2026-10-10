// Operations git left half done (SPEC §15 "Operations in progress"): a rebase, merge, cherry-pick
// or revert stopped in an entry's worktree, started from Gitgel or not. Continue and Abort are git
// actions.
import { create } from 'zustand';
import { gitOperation } from '../lib/ipc';
import { plural } from '../lib/format';
import type { EntryRef, EntrySummary, Operation, OperationKind } from '../lib/types';
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

function progress(op: Operation): string | null {
  return op.step !== null && op.total !== null ? `${op.step} of ${op.total}` : null;
}

/** `rebasing 2/4` (Branches), `rebasing` when `short` (Review's narrower group line). */
export function operationPill(op: Operation, short = false): string {
  const p = !short && op.step !== null && op.total !== null ? ` ${op.step}/${op.total}` : '';
  return `${NAMES[op.kind].pill}${p}`;
}

/** The pill's tooltip: `Rebasing on main · 2 of 4`, `Merging origin/feat`. */
export function operationTooltip(op: Operation): string {
  const name = NAMES[op.kind].pill;
  const head = name.charAt(0).toUpperCase() + name.slice(1);
  if (op.kind === 'rebase') return [op.onto ? `${head} on ${op.onto}` : head, progress(op)].filter(Boolean).join(' · ');
  return op.other ? `${head} ${op.other}` : head;
}

/** `repo / branch` (the short SHA when detached). */
export function entryLabel(e: EntrySummary): string {
  return `${e.repoName} / ${e.branch ?? e.shortSha ?? ''}`;
}

/** The banner's parts: what is in progress (names apart, shown in mono) and how it stands. */
export function operationBanner(e: EntrySummary, op: Operation): { parts: { text: string; name?: boolean }[]; tone: 'danger' | 'warning' } {
  const who = { text: entryLabel(e), name: true };
  const parts: { text: string; name?: boolean }[] = [];
  switch (op.kind) {
    case 'rebase':
      parts.push({ text: 'Rebasing ' }, who);
      if (op.onto) parts.push({ text: ' on ' }, { text: op.onto, name: true });
      break;
    case 'merge':
      parts.push({ text: 'Merging ' });
      if (op.other) parts.push({ text: op.other, name: true }, { text: ' into ' });
      parts.push(who);
      break;
    case 'cherry_pick':
      parts.push({ text: 'Cherry-picking ' });
      if (op.other) parts.push({ text: op.other, name: true }, { text: ' onto ' });
      parts.push(who);
      break;
    case 'revert':
      parts.push({ text: 'Reverting ' });
      if (op.other) parts.push({ text: op.other, name: true }, { text: ' in ' });
      parts.push(who);
      break;
  }
  const p = progress(op);
  if (p) parts.push({ text: ` · ${p}` });
  if (op.unresolved > 0) parts.push({ text: ` · ${plural(op.unresolved, 'conflict', 'conflicts')}` });
  else if (e.conflicts > 0) parts.push({ text: ' · conflicts resolved' });
  return { parts, tone: op.unresolved > 0 ? 'danger' : 'warning' };
}

/** Why Continue cannot run now, or null. */
export function continueBlocked(op: Operation): string | null {
  return op.unresolved > 0 ? 'Resolve the conflicts first' : null;
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
  const other = op.other ? `${op.other} ` : '';
  const done = {
    rebase: `Rebased ${branch}${op.onto ? ` on ${op.onto}` : ''}`,
    merge: `Merged ${other}into ${branch}`,
    cherry_pick: `Cherry-picked ${other}onto ${branch}`,
    revert: `Reverted ${other}in ${branch}`,
  }[op.kind];
  // A next commit that conflicts too ends the run with an error: git says so in the output.
  return startGitAction(`Continue ${operationTitle(op)}`, () => gitOperation(refOf(e), false), { openOnFail: true, done });
}

export function abortOperation(e: EntrySummary, op: Operation): Promise<void> {
  const branch = e.branch ?? e.shortSha ?? '';
  const done = op.kind === 'rebase' ? `Aborted the rebase of ${branch}` : `Aborted the ${NAMES[op.kind].verb} in ${branch}`;
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
