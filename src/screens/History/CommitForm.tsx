import { useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { SparklesIcon, SpinnerIcon } from '../../components/icons';
import { Input } from '../../components/Input';
import { Menu, MenuItem, MenuLabel } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { cnt } from '../../lib/format';
import { t } from '../../i18n';
import type { CommitProvider } from '../../lib/types';
import { providerLabel } from '../../lib/ai';
import styles from './CommitForm.module.css';

/** The commit form under History's list while Uncommitted is picked (W1a): summary, description
 * and the button; ⌘↵ in either field commits. Locked while the commit (and its hooks) runs.
 * The ✦ at the summary's end asks the default provider's CLI for a message for the checked
 * files (SPEC §15); right-click on it generates with another one. */
export function CommitForm({
  rev,
  summary,
  description,
  files,
  committing,
  blocked,
  provider,
  providers,
  generating,
  aiEnabled,
  onSummary,
  onDescription,
  onCommit,
  onGenerate,
}: {
  rev: string;
  summary: string;
  description: string;
  /** Files checked. */
  files: number;
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
  /** The ✦ generates with the default; a menu pick generates with the picked one at once,
   * leaving the default alone. */
  onGenerate: (provider?: CommitProvider) => void;
}) {
  const ready = summary.trim() !== '' && files > 0 && !blocked;
  const submitOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !e.metaKey) return;
    e.preventDefault();
    if (ready && !committing) onCommit();
  };
  const why = committing
    ? t('history.hooksRunning')
    : (blocked ?? (files === 0 ? t('history.checkFile') : summary.trim() === '' ? t('history.writeSummary') : t('history.commitTo', { rev })));
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const canGenerate = files > 0 && !blocked && !committing && !generating;
  const generateWith = provider ? t('history.genWith', { provider: providerLabel(provider) }) : '';
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
            <IconButton
              size={24}
              aria-label={generateWith}
              title={generating ? t('history.askingMsg') : generateWith}
              active={menu !== null}
              disabled={!canGenerate}
              onClick={() => onGenerate()}
              onContextMenu={(e) => {
                e.preventDefault();
                if (providers.length > 0) setMenu(e.currentTarget.getBoundingClientRect());
              }}
              className={styles.generate}
            >
              {generating ? <SpinnerIcon size={13} className={styles.spin} /> : <SparklesIcon size={14} />}
            </IconButton>
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
      {menu && (
        <Popover anchorRect={menu} width={220} alignRight onClose={() => setMenu(null)}>
          <Menu aria-label={t('history.genWithMenu')}>
            <MenuLabel>{t('history.genWithMenu')}</MenuLabel>
            {providers.map((id) => (
              <MenuItem
                key={id}
                onSelect={() => {
                  onGenerate(id);
                  setMenu(null);
                }}
              >
                {providerLabel(id)}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      <Button
        type="submit"
        variant="primary"
        className={styles.commit}
        icon={committing ? 'spinner' : undefined}
        disabled={!ready || committing}
        title={why}
      >
        {committing ? t('history.committing') : files > 0 ? t('history.commitFiles', { ...cnt(files) }) : t('history.commitBtn')}
      </Button>
    </form>
  );
}
