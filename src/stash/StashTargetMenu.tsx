import { Menu, MenuItem } from '../components/Menu';
import { t } from '../i18n';
import { tildifyHome } from '../lib/paths';
import type { EntrySummary } from '../lib/types';
import type { ReviewStash } from '../screens/Review/stashes';
import { useData } from '../state/data';
import { applyStash } from './actions';

/** The repository's checked-out entries, the branch the stash was taken on first. */
export function stashTargets(st: ReviewStash, active: EntrySummary[]): EntrySummary[] {
  const trees = active.filter((e) => e.worktreePath);
  const own = trees.filter((e) => st.branch !== null && e.branch === st.branch);
  return [...own, ...trees.filter((e) => !own.includes(e))];
}

/** Apply to… / Pop to… (flow P5): where the stash goes. */
export function StashTargetMenu({
  stash,
  pop,
  autoFocus = true,
  onDone,
}: {
  stash: ReviewStash;
  pop: boolean;
  /** Focus the first item (not when it opened on hover). */
  autoFocus?: boolean;
  onDone: () => void;
}) {
  const active = useData((s) => s.scan[stash.repoId]?.active);
  const targets = stashTargets(stash, active ?? []);
  return (
    <Menu aria-label={t(pop ? 'stash.targetAriaPop' : 'stash.targetAriaApply')} autoFocus={autoFocus}>
      {targets.map((e) => (
        <MenuItem
          key={e.key}
          icon="branch"
          desc={tildifyHome(e.worktreePath ?? '')}
          oneLine
          onSelect={() => {
            onDone();
            void applyStash(stash, e, pop);
          }}
        >
          {e.branch ?? e.shortSha}
        </MenuItem>
      ))}
    </Menu>
  );
}
