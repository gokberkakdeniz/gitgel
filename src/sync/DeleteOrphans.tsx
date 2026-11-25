// Delete Orphan Branches (SPEC §15 "Delete orphan branches"): from a Branches repo band's ⋮, a
// list of the repository's left-over local branches (upstream gone, or merged) to delete in one
// git action.
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { SpinnerIcon } from '../components/icons';
import { MenuDivider, MenuItem } from '../components/Menu';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Pill } from '../components/Pill';
import { t } from '../i18n';
import { ageText, ageTitle, cnt } from '../lib/format';
import { getOrphanBranches, gitDeleteBranches } from '../lib/ipc';
import { saveNotes } from '../lib/notes';
import type { OrphanBranch } from '../lib/types';
import { useInvoke } from '../lib/useInvoke';
import { startGitAction, useRuns } from '../scripts/runs';
import { useData } from '../state/data';
import { leaveDeletedBranch } from '../state/nav';
import styles from './DeleteOrphans.module.css';
import { useGitActionRunning } from './operation';

/** The modal is open for this repository. */
const useDeleteOrphans = create<{ repo: { id: string; name: string } | null }>()(() => ({ repo: null }));

/** "Delete Orphan Branches…" at the end of a repo band's ⋮ menu. Disabled while a git action runs. */
export function DeleteOrphansItem({
  repoId,
  repoName,
  onDone,
}: {
  repoId: string;
  repoName: string;
  onDone: () => void;
}) {
  const running = useGitActionRunning(repoId);
  return (
    <>
      <MenuDivider />
      <MenuItem
        icon="trash"
        danger
        disabled={running}
        title={running ? t('sync.gitBusy') : undefined}
        onSelect={() => {
          onDone();
          useDeleteOrphans.setState({ repo: { id: repoId, name: repoName } });
        }}
      >
        {t('branches.orphansMenu')}
      </MenuItem>
    </>
  );
}

function deleteOrphans(repoId: string, branches: OrphanBranch[]): Promise<void> {
  const count = cnt(branches.length);
  return startGitAction(
    t('branches.orphansBtn'),
    t('branches.orphansDeleting', { ...count }),
    () =>
      gitDeleteBranches(
        repoId,
        branches.map((b) => ({ name: b.name, tip: b.tip })),
      ),
    {
      done: t('branches.orphansDeleted', { ...count }),
      // Once they are gone, their notes go and their Reviews leave, as Delete Branch's.
      onStart: (runId) => {
        const ended = () => {
          const r = useRuns.getState().runs[runId];
          if (!r || r.status === 'running') return false;
          if (r.status === 'exited' && r.exitCode === 0) {
            const notes = useData.getState().notes;
            for (const b of branches) {
              const key = `${repoId}:${b.name}`;
              if (notes[key]) void saveNotes(key, []);
              leaveDeletedBranch(repoId, b.name);
            }
          }
          return true;
        };
        if (ended()) return;
        const off = useRuns.subscribe(() => ended() && off());
      },
    },
  );
}

/** The open Delete Orphan Branches modal, if any. */
export function DeleteOrphansModal() {
  const repo = useDeleteOrphans((s) => s.repo);
  if (!repo) return null;
  return (
    <OrphansModal
      key={repo.id}
      repoId={repo.id}
      repoName={repo.name}
      onClose={() => useDeleteOrphans.setState({ repo: null })}
    />
  );
}

function OrphansModal({ repoId, repoName, onClose }: { repoId: string; repoName: string; onClose: () => void }) {
  const { data: list, error } = useInvoke(() => getOrphanBranches(repoId), [repoId], { repoIds: [repoId] });
  // Every branch starts checked; these were unchecked.
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const picked = (list ?? []).filter((b) => !off.has(b.name));
  const toggle = (name: string, on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (on) next.delete(name);
      else next.add(name);
      return next;
    });
  const all = !!list && picked.length === list.length;
  const empty = !!list && list.length === 0;

  return (
    <Modal aria-label={t('branches.orphansTitle')} width={560} onClose={onClose}>
      <ModalHeader title={t('branches.orphansTitle')} sub={repoName} subMono />
      {!list ? (
        <div className={styles.state}>{error ? error.message : <SpinnerIcon size={16} className={styles.spin} />}</div>
      ) : empty ? (
        <div className={styles.state}>{t('branches.orphansNone')}</div>
      ) : (
        <div className={styles.body}>
          <div className={styles.list}>
            <div className={styles.head}>
              <Checkbox
                aria-label={t('branches.orphansAll')}
                checked={all}
                mixed={!all && picked.length > 0}
                onChange={() => setOff(all ? new Set(list.map((b) => b.name)) : new Set())}
              />
              <span>{t('branches.orphansCount', { ...cnt(list.length) })}</span>
            </div>
            <div className={styles.rows}>
              {list.map((b) => (
                <label key={b.name} className={styles.row}>
                  <Checkbox checked={!off.has(b.name)} onChange={(e) => toggle(b.name, e.target.checked)} />
                  <span className={styles.name} title={b.name}>
                    {b.name}
                  </span>
                  <Pill tone={b.reason === 'gone' ? 'neutral' : 'success'} size="sm">
                    {t(b.reason === 'gone' ? 'branches.orphanGone' : 'branches.orphanMerged')}
                  </Pill>
                  <span className={styles.age} title={ageTitle(b.lastCommitAt)}>
                    {ageText(b.lastCommitAt)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      <ModalFooter note={list && !empty ? t('branches.orphansSelected', { ...cnt(picked.length) }) : undefined}>
        {list && !empty ? (
          <>
            <Button autoFocus onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={picked.length === 0}
              onClick={() => {
                onClose();
                void deleteOrphans(repoId, picked);
              }}
            >
              {t('branches.orphansBtn')}
            </Button>
          </>
        ) : (
          <Button autoFocus onClick={onClose}>
            {t('common.close')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
