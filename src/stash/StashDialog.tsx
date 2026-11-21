import { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { t } from '../i18n';
import type { EntryRef, EntrySummary, FileChange, StashLines, StashPush } from '../lib/types';
import { pushStashLines, pushStashes } from './actions';
import styles from './StashDialog.module.css';

/** What to stash in an entry's worktree: `picked` of its uncommitted `files` (a staged and an
 * unstaged row of one file count once), or all of them (no paths) with `null` or when every file
 * is picked; a rename goes with its old path, untracked files when one is among them. */
export function stashPush(entry: EntrySummary, files: FileChange[], picked: FileChange[] | null): StashPush {
  const paths = new Set((picked ?? files).map((f) => f.path));
  const mine = files.filter((f) => paths.has(f.path));
  const all = !picked || mine.length === files.length;
  return {
    repoId: entry.repoId,
    branch: entry.branch,
    worktreePath: entry.branch === null ? entry.worktreePath : null,
    paths: all ? null : mine.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path])),
    untracked: (all ? files : mine).some((f) => f.kind === 'U'),
  };
}

/** Picked lines of one file of an entry (the diff's Stash Selected Lines…). */
export interface StashLinesPush {
  entry: EntryRef;
  lines: StashLines;
}

/** Stash Changes (flow P4): a modal that asks only for the stash's message (Changes' Stash All
 * Changes…, a file's Stash Changes…, the diff's Stash Selected Lines…). */
export function StashDialog({
  push,
  sub,
  onClose,
}: {
  push: StashPush | StashLinesPush;
  sub: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const stash = () => {
    onClose();
    void ('lines' in push ? pushStashLines(push.entry, push.lines, message) : pushStashes([push], message));
  };
  return (
    <Modal aria-label={t('stash.dialogTitle')} width={480} paddingTop={160} onClose={onClose}>
      <div
        onKeyDown={(e) => {
          // Listed in lib/shortcuts.ts.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            stash();
          }
        }}
      >
        <ModalHeader title={t('stash.dialogTitle')} sub={sub} subMono onClose={onClose} />
        <div className={styles.body}>
          <Input
            size={36}
            aria-label={t('stash.messageLabel')}
            placeholder={t('stash.messageLabel')}
            value={message}
            onChange={setMessage}
            autoFocus
          />
        </div>
        <ModalFooter>
          <Button size={36} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size={36} kbd="↵" onClick={stash}>
            {t('stash.stashBtn')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
