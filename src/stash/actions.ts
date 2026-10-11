// Writing stashes (SPEC §15): each is a git action, run and shown like a script.
import { create } from 'zustand';
import { t } from '../i18n';
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
  const stash = `stash@{${st.index}}`;
  return startGitAction(t('stash.actDrop', { stash }), t('stash.dropping', { stash }), () =>
    stashDrop(st.repoId, st.index, st.sha),
  );
}

/** Apply (or pop) into the worktree an entry is checked out in. */
export function applyStash(st: ReviewStash, target: EntrySummary, pop: boolean): Promise<void> {
  const stash = `stash@{${st.index}}`;
  const name = t(pop ? 'stash.actPop' : 'stash.actApply', { stash });
  const running = t(pop ? 'stash.popping' : 'stash.applying', { stash });
  return startGitAction(name, running, () => stashApply(st.repoId, st.index, st.sha, target.worktreePath ?? '', pop));
}

/** One stash per entry, one after another (P4). */
export function pushStashes(entries: StashPush[], message: string): Promise<void> {
  return startGitAction(t('stash.dialogTitle'), t('stash.stashing'), () => stashPush(entries, message));
}
