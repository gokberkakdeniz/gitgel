// Writing stashes (SPEC §15): each is a git action, run and shown like a script.
import { create } from 'zustand';
import { stashApply, stashDrop, stashPush } from '../lib/ipc';
import type { EntrySummary, StashPush } from '../lib/types';
import type { ReviewStash } from '../screens/Review/stashes';
import { startGitAction } from '../scripts/runs';
import { useData } from '../state/data';

interface StashUi {
  /** The Drop confirmation is open for this stash (P6). */
  dropping: ReviewStash | null;
}

export const useStashUi = create<StashUi>()(() => ({ dropping: null }));

/** Drop asks first unless Settings › Prompts › "Dropping stashes" is off. */
export function askDrop(stash: ReviewStash): void {
  if (useData.getState().config?.settings.prompts.discardStash === false) void dropStash(stash);
  else useStashUi.setState({ dropping: stash });
}

export function dropStash(st: ReviewStash): Promise<void> {
  return startGitAction(`Drop stash@{${st.index}}`, () => stashDrop(st.repoId, st.index, st.sha));
}

/** Apply (or pop) into the worktree an entry is checked out in. */
export function applyStash(st: ReviewStash, target: EntrySummary, pop: boolean): Promise<void> {
  const name = `${pop ? 'Pop' : 'Apply'} stash@{${st.index}}`;
  return startGitAction(name, () => stashApply(st.repoId, st.index, st.sha, target.worktreePath ?? '', pop));
}

/** One stash per entry, one after another (P4). */
export function pushStashes(entries: StashPush[], message: string): Promise<void> {
  return startGitAction('Stash Changes', () => stashPush(entries, message));
}
