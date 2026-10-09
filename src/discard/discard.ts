// Discard (SPEC §15 "Discard"; Hi8, D12): Uncommitted files go back to HEAD, after Confirm
// Discard Changes unless Settings › Prompts says not to ask.
import { create } from 'zustand';
import { gitDiscard } from '../lib/ipc';
import type { EntryRef, EntrySummary, FileChange } from '../lib/types';
import { startGitAction } from '../scripts/runs';
import { useData } from '../state/data';

/** More files than this: the dialog gives the count only, and always asks. */
export const MAX_LISTED = 10;

/** One entry's files to discard. */
export interface DiscardTarget {
  entry: EntryRef;
  repoName: string;
  /** The branch, or the short SHA when detached. */
  branch: string;
  files: FileChange[];
}

/** An entry's files as a discard target. */
export function targetOf(e: EntrySummary, files: FileChange[]): DiscardTarget {
  return {
    entry: { repoId: e.repoId, branch: e.branch, worktreePath: e.branch === null ? e.worktreePath : null },
    repoName: e.repoName,
    branch: e.branch ?? e.shortSha ?? '',
    files,
  };
}

export interface DiscardRequest {
  targets: DiscardTarget[];
  /** Discard All Changes (the Uncommitted row's menu): always asks, with the count. */
  all: boolean;
}

interface DiscardUi {
  /** Confirm Discard Changes is open for this. */
  asking: DiscardRequest | null;
}

export const useDiscardUi = create<DiscardUi>()(() => ({ asking: null }));

export const fileCount = (req: DiscardRequest) => req.targets.reduce((n, t) => n + t.files.length, 0);

/** The dialog lists the files (and offers "Do not show this message again") only for a few picked. */
export const listsFiles = (req: DiscardRequest) => !req.all && fileCount(req) <= MAX_LISTED;

/** Asks first unless Settings › Prompts › "Discarding changes" is off; a long list always asks. */
export function askDiscard(req: DiscardRequest): void {
  const targets = req.targets.filter((t) => t.files.length > 0);
  if (targets.length === 0) return;
  const r = { ...req, targets };
  const ask = useData.getState().config?.settings.prompts.discardChanges !== false;
  if (ask || !listsFiles(r)) useDiscardUi.setState({ asking: r });
  else void discardNow(r);
}

/** The paths a discard sends: a rename's old path too. */
export const discardPaths = (files: FileChange[]) => files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]));

export function discardNow(req: DiscardRequest): Promise<void> {
  return startGitAction('Discard changes', () =>
    gitDiscard(req.targets.map((t) => ({ ...t.entry, paths: discardPaths(t.files) }))),
  );
}
