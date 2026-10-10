import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { MenuDivider, MenuItem } from '../components/Menu';
import { Pill } from '../components/Pill';
import { stopAsking } from '../lib/prompts';
import { tildifyHome } from '../lib/paths';
import type { EntrySummary, Operation } from '../lib/types';
import styles from './OperationUi.module.css';
import {
  abortOperation,
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

/** Review's banner for one entry with an operation in progress (T2): the entry's names as the
 * entry bar shows them, then what paused where, the files that still have conflicts (each opens
 * in Uncommitted) and what to do next; Abort and Continue on the right. Danger while a conflicted
 * file keeps git's markers, warning once none does. */
export function OperationBanner({
  entry,
  op,
  onOpenFile,
}: {
  entry: EntrySummary;
  op: Operation;
  onOpenFile: (path: string) => void;
}) {
  const running = useGitActionRunning(entry.repoId);
  const { tone, what, files, next } = operationBanner(entry, op);
  const blocked = continueBlocked(op);
  const busy = running ? 'A git action is running' : undefined;
  const shown = files.slice(0, 3);
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      <div className={styles.body}>
        <div className={styles.names}>
          <span className={styles.repo}>{entry.repoName}</span>
          <span className={styles.branch}>{entry.branch ?? entry.shortSha}</span>
          {entry.worktreePath && <span className={styles.path}>{tildifyHome(entry.worktreePath)}</span>}
        </div>
        <div className={styles.message}>
          {what.map((p, i) =>
            'ref' in p ? (
              <span key={i} className={styles.ref}>
                {p.ref}
              </span>
            ) : 'sha' in p ? (
              <span key={i}>
                <span className={styles.ref}>{p.sha}</span>
                {p.subject && ` “${p.subject}”`}
              </span>
            ) : (
              p.text
            ),
          )}
          {shown.length > 0 && (
            <>
              {' Conflicts in '}
              {shown.map((path, i) => (
                <span key={path}>
                  {i > 0 && ', '}
                  <button type="button" className={styles.file} title={`Show ${path}`} onClick={() => onOpenFile(path)}>
                    {path}
                  </button>
                </span>
              ))}
              {files.length > shown.length && ` and ${files.length - shown.length} more`}.
            </>
          )}{' '}
          {next}
        </div>
      </div>
      <Button size={28} disabled={running} title={busy} onClick={() => askAbort(entry, op)}>
        Abort
      </Button>
      <Button
        variant="primary"
        size={28}
        disabled={running || !!blocked}
        title={busy ?? blocked ?? undefined}
        onClick={() => void continueOperation(entry, op)}
      >
        Continue
      </Button>
    </div>
  );
}

/** An entry menu's group while an operation is in progress, in place of Sync (T1). */
export function OperationItems({ entry, op, onDone }: { entry: EntrySummary; op: Operation; onDone: () => void }) {
  const running = useGitActionRunning(entry.repoId);
  const blocked = continueBlocked(op);
  const busy = running ? 'A git action is running' : null;
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
        Continue {title}
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
        Abort {title}
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
  const verb = title.toLowerCase();
  const name = entry.branch ?? entry.shortSha ?? '';
  const back = entry.shortSha ? `${name} goes back to ${entry.shortSha}, as before the ${verb}. ` : '';
  return (
    <ConfirmModal
      aria-label={`Abort the ${verb}`}
      title={`Abort the ${verb}?`}
      width={460}
      onClose={close}
      context={[
        { icon: 'branch', text: entryLabel(entry) },
        { icon: 'rebase', text: operationTooltip(op) },
      ]}
      note={`${back}Conflict fixes made so far are lost.`}
      dontAsk={{ checked: dontAsk, onChange: setDontAsk }}
    >
      <Button size={36} autoFocus onClick={close}>
        Cancel
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
        Abort {title}
      </Button>
    </ConfirmModal>
  );
}
