// Delete Branch (SPEC §15 "Delete branch"): a git action from the branch menus, after a
// confirmation that can stash the checkout's changes and delete the branch on its remote too.
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '../components/Button';
import { ConfirmModal, type ConfirmContext } from '../components/ConfirmModal';
import { MenuDivider, MenuItem } from '../components/Menu';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import { getBranchLoss, gitDeleteBranch } from '../lib/ipc';
import { tildifyHome } from '../lib/paths';
import { useInvoke } from '../lib/useInvoke';
import type { EntrySummary } from '../lib/types';
import { startGitAction, useRuns } from '../scripts/runs';
import { useData } from '../state/data';
import { leaveDeletedBranch } from '../state/nav';
import styles from './DeleteBranch.module.css';
import { useGitActionRunning } from './operation';

/** The confirmation is open for this entry. */
const useDeleteBranch = create<{ entry: EntrySummary | null }>()(() => ({ entry: null }));

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** Where the branch is checked out: nowhere, the repository folder (it switches to the base
 * branch first) or a linked worktree (removed first). */
function checkout(entry: EntrySummary, repoPath: string | undefined): 'none' | 'main' | 'linked' {
  if (!entry.worktreePath) return 'none';
  return repoPath && trimSlash(entry.worktreePath) === trimSlash(repoPath) ? 'main' : 'linked';
}

/** "Delete Branch…" at the end of a branch menu: a local branch that is there, is not its repo's
 * base and has no operation in progress. Disabled while a git action runs. */
export function DeleteBranchItem({
  entry,
  onDone,
  divider = true,
}: {
  entry: EntrySummary;
  onDone: () => void;
  /** Project's menu has one above Remove from Project already. */
  divider?: boolean;
}) {
  const base = useData((s) => s.scan[entry.repoId]?.baseBranch ?? null);
  const repoPath = useData((s) => s.config?.repos.find((r) => r.id === entry.repoId)?.path);
  const running = useGitActionRunning(entry.repoId);
  if (
    !entry.branch ||
    !entry.headSha ||
    entry.branch === base ||
    entry.operation ||
    entry.state === 'repo_missing' ||
    entry.state === 'branch_deleted' ||
    // The repository folder needs a base branch to switch to.
    (checkout(entry, repoPath) === 'main' && !base)
  )
    return null;
  return (
    <>
      {divider && <MenuDivider />}
      <MenuItem
        icon="trash"
        danger
        disabled={running}
        title={running ? t('sync.gitBusy') : undefined}
        onSelect={() => {
          onDone();
          useDeleteBranch.setState({ entry });
        }}
      >
        {t('branches.deleteMenu')}
      </MenuItem>
    </>
  );
}

function deleteBranch(e: EntrySummary, remote: boolean, stash: boolean): Promise<void> {
  const branch = e.branch ?? '';
  return startGitAction(
    t('branches.actDelete', { branch }),
    t('branches.deleting', { branch }),
    () => gitDeleteBranch(e.repoId, branch, e.headSha ?? '', remote, stash),
    {
      done: t('branches.deleted', { branch }),
      // Once it is gone, its Review or History leaves (to Branches, or back into the project).
      onStart: (runId) => {
        const ended = () => {
          const r = useRuns.getState().runs[runId];
          if (!r || r.status === 'running') return false;
          if (r.status === 'exited' && r.exitCode === 0) leaveDeletedBranch(e.repoId, branch);
          return true;
        };
        if (ended()) return;
        const off = useRuns.subscribe(() => ended() && off());
      },
    },
  );
}

/** Confirms deleting `useDeleteBranch.entry`. The note says what else happens: commits on no
 * other branch, tag or remote (danger; with the remote option, the remote's copies count too),
 * the folder switching to the base or the worktree going, uncommitted changes lost when they are
 * not stashed. Options: stash those changes (checked), delete the remote branch too. */
export function DeleteBranchModal() {
  const entry = useDeleteBranch((s) => s.entry);
  const base = useData((s) => (entry ? (s.scan[entry.repoId]?.baseBranch ?? null) : null));
  const repoPath = useData((s) => (entry ? s.config?.repos.find((r) => r.id === entry.repoId)?.path : undefined));
  const [stash, setStash] = useState(true);
  const [remote, setRemote] = useState(false);
  const { data: loss } = useInvoke(
    () => getBranchLoss(entry?.repoId ?? '', entry?.branch ?? ''),
    [entry?.repoId, entry?.branch],
    { enabled: !!entry?.branch, repoIds: entry ? [entry.repoId] : [] },
  );
  if (!entry?.branch) return null;
  const close = () => {
    setStash(true);
    setRemote(false);
    useDeleteBranch.setState({ entry: null });
  };
  const branch = entry.branch;
  const where = checkout(entry, repoPath);
  const dirty = where === 'none' ? 0 : (entry.uncommitted ?? 0);
  const onRemote = entry.upstream?.name ?? null;
  const context: ConfirmContext[] = [{ icon: 'branch', text: `${entry.repoName} / ${branch}` }];
  if (entry.worktreePath) context.push({ icon: 'folder', text: tildifyHome(entry.worktreePath) });
  const lost = (remote && onRemote ? loss?.lostWithRemote : loss?.lost) ?? 0;
  const rest = [
    where === 'main' && t('branches.deleteSwitch', { base: base ?? '' }),
    where === 'linked' && t('branches.deleteWorktree'),
    dirty > 0 && !stash && t('branches.deleteLost', { ...cnt(dirty) }),
  ]
    .filter(Boolean)
    .join(' ');
  const note =
    lost > 0 ? (
      <>
        <span className={styles.lost}>{t('branches.deleteCommitsLost', { ...cnt(lost) })}</span>
        {rest && ` ${rest}`}
      </>
    ) : (
      rest
    );
  const options = [
    ...(dirty > 0 ? [{ label: t('branches.deleteStash', { ...cnt(dirty) }), checked: stash, onChange: setStash }] : []),
    ...(onRemote ? [{ label: t('branches.deleteRemote', { name: onRemote }), checked: remote, onChange: setRemote }] : []),
  ];
  return (
    <ConfirmModal
      aria-label={t('branches.deleteTitle')}
      title={t('branches.deleteTitle')}
      width={460}
      onClose={close}
      context={context}
      note={note || undefined}
      options={options.length ? options : undefined}
    >
      <Button size={36} autoFocus onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          close();
          // A clean checkout stashes nothing; only an unchecked box drops changes.
          void deleteBranch(entry, remote && !!onRemote, dirty === 0 || stash);
        }}
      >
        {t('branches.deleteBtn')}
      </Button>
    </ConfirmModal>
  );
}
