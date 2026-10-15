import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { MenuDivider, MenuItem } from '../components/Menu';
import { Pill } from '../components/Pill';
import { t } from '../i18n';
import { stopAsking } from '../lib/prompts';
import { tildifyHome } from '../lib/paths';
import type { EntrySummary, Operation } from '../lib/types';
import styles from './OperationUi.module.css';
import {
  abortOperation,
  abortTitle,
  askAbort,
  continueBlocked,
  continueOperation,
  entryLabel,
  operationBanner,
  operationPill,
  operationTitle,
  operationTooltip,
  useGitActionRunning,
  useOperationUi,
} from './operation';

/** The warning pill of an entry with an operation in progress (Branches line 2, Review group). */
export function OperationPill({ op, short }: { op: Operation; short?: boolean }) {
  return (
    <Pill tone="warning" size="sm" title={operationTooltip(op)}>
      {operationPill(op, short)}
    </Pill>
  );
}

/** Review's one-line banner for an entry with an operation in progress (T2): `Resolve conflicts
 * to continue rebasing` and the entry's names as the entry bar shows them, `(2/4)`; Abort and
 * Continue on the right. Danger while a conflicted file keeps git's markers (the file rows say
 * which), warning (`Continue rebasing …`) once none does. */
export function OperationBanner({
  entry,
  op,
  names = true,
}: {
  entry: EntrySummary;
  op: Operation;
  /** History (T4): no names, its header has them. */
  names?: boolean;
}) {
  const running = useGitActionRunning(entry.repoId);
  const { tone, lead, progress } = operationBanner(op, names);
  const blocked = continueBlocked(op);
  const busy = running ? t('sync.gitBusy') : undefined;
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      <span className={styles.line}>
        <span>{lead}</span>
        {names && (
          <>
            <span className={styles.repo}>{entry.repoName}</span>
            <span className={styles.branch}>{entry.branch ?? entry.shortSha}</span>
            {entry.worktreePath && <span className={styles.path}>{tildifyHome(entry.worktreePath)}</span>}
          </>
        )}
        {progress && <span>{progress}</span>}
      </span>
      <Button size={28} disabled={running} title={busy} onClick={() => askAbort(entry, op)}>
        {t('sync.abortBtn')}
      </Button>
      <Button
        variant="primary"
        size={28}
        disabled={running || !!blocked}
        title={busy ?? blocked ?? undefined}
        onClick={() => void continueOperation(entry, op)}
      >
        {t('sync.continueBtn')}
      </Button>
    </div>
  );
}

/** An entry menu's group while an operation is in progress, in place of Sync (T1). */
export function OperationItems({ entry, op, onDone }: { entry: EntrySummary; op: Operation; onDone: () => void }) {
  const running = useGitActionRunning(entry.repoId);
  const blocked = continueBlocked(op);
  const busy = running ? t('sync.gitBusy') : null;
  const title = operationTitle(op);
  return (
    <>
      <MenuDivider />
      <MenuItem
        icon="arrow-right"
        disabled={running || !!blocked}
        title={busy ?? blocked ?? undefined}
        onSelect={() => {
          onDone();
          void continueOperation(entry, op);
        }}
      >
        {t('sync.menuContinue', { title })}
      </MenuItem>
      <MenuItem
        icon="undo"
        danger
        disabled={running}
        title={busy ?? undefined}
        onSelect={() => {
          onDone();
          askAbort(entry, op);
        }}
      >
        {t('sync.menuAbort', { title })}
      </MenuItem>
    </>
  );
}

/** Abort (T3): confirms aborting `useOperationUi.aborting`. */
export function AbortOperationModal() {
  const st = useOperationUi((s) => s.aborting);
  const [dontAsk, setDontAsk] = useState(false);
  if (!st) return null;
  const { entry, op } = st;
  const close = () => {
    setDontAsk(false);
    useOperationUi.setState({ aborting: null });
  };
  const title = operationTitle(op);
  return (
    <ConfirmModal
      aria-label={abortTitle(op)}
      title={abortTitle(op)}
      width={460}
      onClose={close}
      context={[
        { icon: 'branch', text: entryLabel(entry) },
        { icon: 'rebase', text: operationTooltip(op) },
      ]}
      dontAsk={{ checked: dontAsk, onChange: setDontAsk }}
    >
      <Button size={36} autoFocus onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          if (dontAsk) stopAsking('abortOperation');
          close();
          void abortOperation(entry, op);
        }}
      >
        {t('sync.menuAbort', { title })}
      </Button>
    </ConfirmModal>
  );
}
