import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { t } from '../../i18n';
import type { HistoryCommit } from '../../lib/types';
import styles from './SquashModal.module.css';

/** The message a squash starts with: the oldest commit's subject, then its body and the newer
 * commits' messages, oldest first (as `git rebase -i` puts them together). */
export function squashMessage(commits: HistoryCommit[]): { summary: string; description: string } {
  const [oldest, ...newer] = [...commits].reverse();
  const parts = [oldest.body, ...newer.map((c) => (c.body ? `${c.subject}\n\n${c.body}` : c.subject))];
  return { summary: oldest.subject, description: parts.filter(Boolean).join('\n\n') };
}

/** Squash Commits (Hi13): the message of the commit the picked ones become, then Squash. With a
 * commit already on the remote it says the branch will need a force push. */
export function SquashModal({
  commits,
  sub,
  pushed,
  onClose,
  onSquash,
}: {
  /** Newest first. */
  commits: HistoryCommit[];
  /** `<repo> / <branch>`. */
  sub: string;
  pushed: boolean;
  onClose: () => void;
  onSquash: (summary: string, description: string) => void;
}) {
  const [msg, setMsg] = useState(() => squashMessage(commits));
  const ok = msg.summary.trim().length > 0;
  const squash = () => {
    if (!ok) return;
    onClose();
    onSquash(msg.summary, msg.description);
  };
  return (
    <Modal aria-label={t('squash.title')} width={560} paddingTop={110} onClose={onClose}>
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault();
            squash();
          }
        }}
      >
        <ModalHeader title={t('squash.title')} sub={sub} subMono onClose={onClose} />
        <div className={styles.body}>
          <Input
            size={36}
            autoFocus
            aria-label={t('history.summaryLabel')}
            placeholder={t('history.summaryPh')}
            value={msg.summary}
            onChange={(summary) => setMsg((m) => ({ ...m, summary }))}
          />
          <textarea
            rows={6}
            aria-label={t('history.descLabel')}
            placeholder={t('history.descPh')}
            className={styles.area}
            value={msg.description}
            onChange={(e) => setMsg((m) => ({ ...m, description: e.target.value }))}
          />
          {pushed && <span className={styles.note}>{t('squash.forcePush')}</span>}
        </div>
        <ModalFooter>
          <Button size={36} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size={36} kbd="⌘↵" disabled={!ok} onClick={squash}>
            {t('squash.button')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
