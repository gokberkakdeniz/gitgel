import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { cnt } from '../../lib/format';
import { t } from '../../i18n';
import type { CommitProvider } from '../../lib/types';
import { GenerateButton } from './GenerateButton';
import styles from './CommitForm.module.css';

/** The commit form under Review's list while Uncommitted is picked (W1a): summary, description
 * and the button; ⌘↵ in either field commits. Locked while the commit (and its hooks) runs.
 * Amending (Hi10) it stays whatever row is picked, says so above the button and needs no files.
 * The ✦ at the summary's end asks the default provider's CLI for a message for the checked
 * files (SPEC §15); right-click on it generates with another one. */
export function CommitForm({
  rev,
  summary,
  description,
  files,
  amend,
  committing,
  blocked,
  provider,
  providers,
  generating,
  aiEnabled,
  onSummary,
  onDescription,
  onCommit,
  onStopAmend,
  onGenerate,
}: {
  rev: string;
  summary: string;
  description: string;
  /** Files checked. */
  files: number;
  /** Amending (Hi10): the newest commit's short SHA; null for a new commit. */
  amend: string | null;
  committing: boolean;
  /** Why Commit cannot run besides an empty summary or no files; null when nothing blocks it. */
  blocked: string | null;
  /** The ✦'s provider: the menu's topmost; null (no ✦) when the menu is empty. */
  provider: CommitProvider | null;
  /** The menu's providers: switched on and installed, in menu order. */
  providers: CommitProvider[];
  generating: boolean;
  /** The ✦ shows when AI is on (Settings › AI). */
  aiEnabled: boolean;
  onSummary: (value: string) => void;
  onDescription: (value: string) => void;
  onCommit: () => void;
  /** Stop amending: the form goes back to a new commit. */
  onStopAmend: () => void;
  /** The ✦ generates with the default; a menu pick generates with the picked one at once,
   * leaving the default alone. */
  onGenerate: (provider?: CommitProvider) => void;
}) {
  const ready = summary.trim() !== '' && (files > 0 || amend !== null) && !blocked;
  const submitOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !e.metaKey) return;
    e.preventDefault();
    if (ready && !committing) onCommit();
  };
  const why = committing
    ? t('history.hooksRunning')
    : (blocked ??
      (files === 0 && amend === null
        ? t('history.checkFile')
        : summary.trim() === ''
          ? t('history.writeSummary')
          : amend !== null
            ? t('history.amendTo', { sha: amend, rev })
            : t('history.commitTo', { rev })));
  const canGenerate = (files > 0 || amend !== null) && !blocked && !committing;
  return (
    <form
      aria-label={t('history.commitForm')}
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !committing) onCommit();
      }}
    >
      <Input
        size={32}
        value={summary}
        onChange={onSummary}
        placeholder={t('history.summaryPh')}
        aria-label={t('history.summaryLabel')}
        disabled={committing}
        onKeyDown={submitOnKey}
        rightText={
          aiEnabled &&
          provider && (
            <GenerateButton
              provider={provider}
              providers={providers}
              generating={generating}
              disabled={!canGenerate}
              onGenerate={onGenerate}
            />
          )
        }
      />
      <textarea
        aria-label={t('history.descLabel')}
        placeholder={t('history.descPh')}
        className={styles.description}
        value={description}
        disabled={committing}
        onChange={(e) => onDescription(e.target.value)}
        onKeyDown={submitOnKey}
      />
      {amend !== null && (
        <div className={styles.amend} role="note">
          <div className={styles.amendRule}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5.5M12 7.5v.01" />
            </svg>
          </div>
          <p className={styles.amendText}>
            {t('amend.noteBefore')} <strong>{t('amend.noteCommit')}</strong>.{' '}
            <button type="button" className={styles.stop} disabled={committing} onClick={onStopAmend}>
              {t('amend.stop')}
            </button>{' '}
            {t('amend.noteAfter')}
          </p>
        </div>
      )}
      <Button
        type="submit"
        variant="primary"
        className={styles.commit}
        icon={committing ? 'spinner' : undefined}
        disabled={!ready || committing}
        title={why}
      >
        {committing
          ? amend !== null
            ? t('history.amending')
            : t('history.committing')
          : amend !== null
            ? t('amend.button')
            : files > 0
              ? t('history.commitFiles', { ...cnt(files) })
              : t('history.commitBtn')}
      </Button>
    </form>
  );
}
