import { Menu, MenuItem, MenuLabel } from '../../components/Menu';
import { t } from '../../i18n';
import { formatCount } from '../../lib/format';
import { gitCherryPick } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import type { EntrySummary, HistoryCommit } from '../../lib/types';
import { startGitAction } from '../../scripts/runs';
import { operationPill } from '../../sync/operation';

/** Where a commit can be cherry-picked: the repository's checked-out entries but `own` (the
 * History's), in scan order. */
export function cherryTargets(active: EntrySummary[], own: EntrySummary | undefined): EntrySummary[] {
  return active.filter((e) => e.worktreePath && e.key !== own?.key);
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
      <MenuLabel>{t('cherry.target', { sha: commit.shortSha })}</MenuLabel>
      {targets.map((e) => {
        const parts = [tildifyHome(e.worktreePath ?? '')];
        if (e.operation) parts.push(operationPill(e.operation, true));
        else if (e.uncommitted) parts.push(t('branches.uncommittedPart', { n: formatCount(e.uncommitted) }));
        return (
          <MenuItem
            key={e.key}
            icon="branch"
            desc={parts.join(' · ')}
            disabled={!!e.operation}
            title={e.operation ? t('branches.checkoutBusy') : undefined}
            onSelect={() => {
              onDone();
              void cherryPick(repoId, commit, e);
            }}
          >
            {e.branch ?? e.shortSha}
          </MenuItem>
        );
      })}
    </Menu>
  );
}
