import { Menu, MenuItem } from '../../components/Menu';
import { t } from '../../i18n';
import { gitCherryPick } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import type { EntrySummary, HistoryCommit } from '../../lib/types';
import { startGitAction } from '../../scripts/runs';

/** Where a commit can be cherry-picked: the repository's checked-out entries but `own` (the
 * History's) and those with an operation in progress, in scan order. */
export function cherryTargets(active: EntrySummary[], own: EntrySummary | undefined): EntrySummary[] {
  return active.filter((e) => e.worktreePath && e.key !== own?.key && !e.operation);
}

/** `git cherry-pick` of the commit in the target's worktree; a conflict stops it there (flow T). */
export function cherryPick(repoId: string, c: HistoryCommit, target: EntrySummary): Promise<void> {
  const sha = c.shortSha;
  return startGitAction(
    t('cherry.act', { sha }),
    t('cherry.running', { sha }),
    () => gitCherryPick(repoId, c.sha, target.worktreePath ?? ''),
    { done: t('sync.doneCherry', { commit: sha, branch: target.branch ?? target.shortSha }) },
  );
}

/** Cherry-Pick to (Hi11): the picker beside the commit menu's item, like Apply to (P5). */
export function CherryPickMenu({
  repoId,
  commit,
  targets,
  autoFocus = true,
  onDone,
}: {
  repoId: string;
  commit: HistoryCommit;
  targets: EntrySummary[];
  /** Focus the first item (not when it opened on hover). */
  autoFocus?: boolean;
  onDone: () => void;
}) {
  return (
    <Menu aria-label={t('cherry.targetAria')} autoFocus={autoFocus}>
      {targets.map((e) => (
        <MenuItem
          key={e.key}
          icon="branch"
          desc={tildifyHome(e.worktreePath ?? '')}
          oneLine
          onSelect={() => {
            onDone();
            void cherryPick(repoId, commit, e);
          }}
        >
          {e.branch ?? e.shortSha}
        </MenuItem>
      ))}
    </Menu>
  );
}
