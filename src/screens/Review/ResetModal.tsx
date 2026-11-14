import { useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { t } from '../../i18n';
import { cnt } from '../../lib/format';
import type { HistoryCommit } from '../../lib/types';

/** Confirm Reset to Commit (SPEC §16 "Reset to Commit"): names the branch and the commit it goes
 * back to, says how many commits leave it, and offers to discard their changes (and the
 * uncommitted ones) instead of keeping them staged. */
export function ResetModal({
  sub,
  commit,
  count,
  pushed,
  dirty,
  onClose,
  onReset,
}: {
  /** `<repo> / <branch>`. */
  sub: string;
  commit: HistoryCommit;
  /** The commits above it; null when not known (a search). */
  count: number | null;
  /** One of them is on the remote: the branch will need a force push. */
  pushed: boolean;
  /** The worktree's uncommitted changes. */
  dirty: number;
  onClose: () => void;
  onReset: (hard: boolean) => void;
}) {
  const [hard, setHard] = useState(false);
  const note = [count ? t('reset.note', cnt(count)) : '', pushed ? t('reset.forcePush') : ''].filter(Boolean).join(' ');
  return (
    <ConfirmModal
      aria-label={t('reset.title')}
      title={t('reset.title')}
      width={460}
      onClose={onClose}
      context={[
        { icon: 'branch', text: sub },
        { icon: 'history', text: `${commit.shortSha} ${commit.subject}`, title: commit.subject },
      ]}
      note={note || undefined}
      options={[
        {
          label: dirty > 0 ? t('reset.hardDirty', cnt(dirty)) : t('reset.hard'),
          checked: hard,
          onChange: setHard,
        },
      ]}
    >
      <Button size={36} autoFocus onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          onClose();
          onReset(hard);
        }}
      >
        {t('reset.button')}
      </Button>
    </ConfirmModal>
  );
}
