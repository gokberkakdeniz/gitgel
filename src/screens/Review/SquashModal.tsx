import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { t } from '../../i18n';
import { generateMessageStart } from '../../lib/ipc';
import type { CommitProvider, EntryRef, HistoryCommit } from '../../lib/types';
import { generateMessage } from './generate';
import { GenerateButton } from './GenerateButton';
import styles from './SquashModal.module.css';

/** The message a squash starts with: the oldest commit's subject, then its body and the newer
 * commits' messages, oldest first (as `git rebase -i` puts them together). */
export function squashMessage(commits: HistoryCommit[]): { summary: string; description: string } {
  const [oldest, ...newer] = [...commits].reverse();
  const parts = [oldest.body, ...newer.map((c) => (c.body ? `${c.subject}\n\n${c.body}` : c.subject))];
  return { summary: oldest.subject, description: parts.filter(Boolean).join('\n\n') };
}

/** Squash Commits (Hi13): the message of the commit the picked ones become, then Squash. With a
 * commit already on the remote it says the branch will need a force push. The ✦ at the summary's
 * end asks a provider's CLI for a message for the commits' changes as one (SPEC §15). */
export function SquashModal({
  commits,
  entry,
  sub,
  pushed,
  provider,
  providers,
  aiEnabled,
  onClose,
  onSquash,
}: {
  /** Newest first. */
  commits: HistoryCommit[];
  entry: EntryRef;
  /** `<repo> / <branch>`. */
  sub: string;
  pushed: boolean;
  /** The ✦'s provider, as the commit form's; null (no ✦) when the menu is empty. */
  provider: CommitProvider | null;
  providers: CommitProvider[];
  /** The ✦ shows when AI is on (Settings › AI). */
  aiEnabled: boolean;
  onClose: () => void;
  onSquash: (summary: string, description: string) => void;
}) {
  const [msg, setMsg] = useState(() => squashMessage(commits));
  const ok = msg.summary.trim().length > 0;
  const [generating, setGenerating] = useState(false);
  // An answer that lands after the modal closed is dropped.
  // (Set again on mount: StrictMode's second mount follows a cleanup.)
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const generate = (forced?: CommitProvider) => {
    const active = forced ?? provider;
    if (!active || generating) return;
    setGenerating(true);
    generateMessage(
      active,
      () =>
        generateMessageStart(
          entry,
          [],
          active,
          null,
          commits.map((c) => c.sha),
        ),
      {
        ended: () => open.current && setGenerating(false),
        answer: (summary, description) => open.current && setMsg({ summary, description }),
      },
    );
  };
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
            rightText={
              aiEnabled &&
              provider && (
                <GenerateButton
                  provider={provider}
                  providers={providers}
                  generating={generating}
                  disabled={false}
                  onGenerate={generate}
                />
              )
            }
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
