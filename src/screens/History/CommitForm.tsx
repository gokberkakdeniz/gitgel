import { useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { BoltIcon, MoreVerticalIcon, SpinnerIcon } from '../../components/icons';
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
 * The bolt asks the provider's CLI for a message for the checked files (SPEC §15), its menu
 * (right-click) picks the provider. */
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
  installed,
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
  provider: CommitProvider;
  /** The menu's providers: switched on and installed, in menu order. */
  providers: CommitProvider[];
  generating: boolean;
  /** The control shows when AI is on (Settings › AI). */
  aiEnabled: boolean;
  /** Whether each CLI is installed; null while unknown (nothing is disabled). */
  installed: Record<CommitProvider, boolean> | null;
  onSummary: (value: string) => void;
  onDescription: (value: string) => void;
  onCommit: () => void;
  /** The bolt generates with the default; a menu pick generates with the picked one at
   * once, leaving the default alone. */
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
  const off = !providers.includes(provider);
  const missing = (id: CommitProvider) => installed !== null && !installed[id];
  const noProviders = providers.length === 0;
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
      <div className={styles.actions}>
        {aiEnabled && (
          <div className={styles.split}>
            <IconButton
              size={32}
              aria-label={t('history.genWith', { provider: providerLabel(provider) })}
              title={
                generating
                  ? t('history.askingMsg')
                  : off
                    ? t('history.provOff', { provider: providerLabel(provider) })
                    : missing(provider)
                      ? t('history.provMissing', { provider: providerLabel(provider) })
                      : t('history.genWith', { provider: providerLabel(provider) })
              }
              active={menu !== null}
              disabled={!canGenerate || off || missing(provider)}
              onClick={() => onGenerate()}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(e.currentTarget.getBoundingClientRect());
              }}
              className={styles.splitMain}
            >
              {generating ? <SpinnerIcon size={14} className={styles.spin} /> : <BoltIcon size={14} />}
            </IconButton>
            <IconButton
              size={32}
              aria-label={t('history.pickProvider')}
              title={noProviders ? t('history.turnOnFirst') : t('history.pickProvider')}
              active={menu !== null}
              disabled={noProviders}
              onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
              className={styles.splitMenu}
            >
              <MoreVerticalIcon size={15} />
            </IconButton>
          </div>
        )}
        {menu && (
          <Popover anchorRect={menu} width={220} above onClose={() => setMenu(null)}>
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
      </div>
    </form>
  );
}
