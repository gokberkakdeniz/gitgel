// Writing stashes (SPEC §15): each is a git action, run and shown like a script.
import { create } from 'zustand';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import { stashApply, stashDrop, stashPush } from '../lib/ipc';
import type { EntrySummary, StashPush } from '../lib/types';
import type { ReviewStash } from '../screens/Review/stashes';
import { startGitAction } from '../scripts/runs';
import { useData } from '../state/data';

interface StashUi {
  /** The Drop confirmation is open for these stashes (P6). */
  dropping: ReviewStash[] | null;
  /** The Apply / Pop dialog is open for these stashes: which worktree (of each repository). */
  applying: { stashes: ReviewStash[]; pop: boolean } | null;
}

export const useStashUi = create<StashUi>()(() => ({ dropping: null, applying: null }));

/** Apply and Pop ask for the worktree first. */
export function askApply(stashes: ReviewStash[], pop: boolean): void {
  if (stashes.length > 0) useStashUi.setState({ applying: { stashes, pop } });
}

/** Drop asks first unless Settings › Prompts › "Dropping stashes" is off. */
export function askDrop(stashes: ReviewStash[]): void {
  if (stashes.length === 0) return;
  if (useData.getState().config?.settings.prompts.discardStash === false) void dropStashes(stashes);
  else useStashUi.setState({ dropping: stashes });
}

/** The stashes by repository, in list order: a git action is one repository's. */
export function byRepo(list: ReviewStash[]): ReviewStash[][] {
  const groups = new Map<string, ReviewStash[]>();
  for (const s of list) groups.set(s.repoId, [...(groups.get(s.repoId) ?? []), s]);
  return [...groups.values()];
}

/** One run per repository, one after another. */
export async function dropStashes(list: ReviewStash[]): Promise<void> {
  for (const group of byRepo(list)) await dropRepoStashes(group);
}

function dropRepoStashes(list: ReviewStash[]): Promise<void> {
  const refs = list.map((s) => ({ index: s.index, sha: s.sha }));
  const run = () => stashDrop(list[0].repoId, refs);
  if (list.length > 1) {
    const n = cnt(list.length);
    return startGitAction(t('stash.actDropN', { ...n }), t('stash.droppingN', { ...n }), run);
  }
  const stash = `stash@{${list[0].index}}`;
  return startGitAction(t('stash.actDrop', { stash }), t('stash.dropping', { stash }), run);
}

/** Apply (or pop) into the worktree an entry is checked out in; several stashes (one
 * repository's) in one run. */
export function applyStashes(list: ReviewStash[], target: EntrySummary, pop: boolean): Promise<void> {
  const refs = list.map((s) => ({ index: s.index, sha: s.sha }));
  const run = () => stashApply(list[0].repoId, refs, target.worktreePath ?? '', pop);
  if (list.length > 1) {
    const n = cnt(list.length);
    return startGitAction(
      t(pop ? 'stash.actPopN' : 'stash.actApplyN', { ...n }),
      t(pop ? 'stash.poppingN' : 'stash.applyingN', { ...n }),
      run,
    );
  }
  const stash = `stash@{${list[0].index}}`;
  return startGitAction(
    t(pop ? 'stash.actPop' : 'stash.actApply', { stash }),
    t(pop ? 'stash.popping' : 'stash.applying', { stash }),
    run,
  );
}

/** One stash per entry, one after another (P4). */
export function pushStashes(entries: StashPush[], message: string): Promise<void> {
  return startGitAction(t('stash.dialogTitle'), t('stash.stashing'), () => stashPush(entries, message));
}
