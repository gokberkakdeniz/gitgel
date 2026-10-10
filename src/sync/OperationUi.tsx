import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { MenuDivider, MenuItem } from '../components/Menu';
import { Pill } from '../components/Pill';
import { stopAsking } from '../lib/prompts';
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

/** Review's banner for one entry with an operation in progress (T2): what and where, Abort and
 * Continue. Danger while a conflicted file keeps git's markers, warning once none does. */
export function OperationBanner({ entry, op }: { entry: EntrySummary; op: Operation }) {
  const running = useGitActionRunning(entry.repoId);
  const { parts, tone } = operationBanner(entry, op);
  const blocked = continueBlocked(op);
  const busy = running ? 'A git action is running' : undefined;
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      <span className={styles.text}>
        {parts.map((p, i) =>
          p.name ? (
            <span key={i} className={styles.name}>
              {p.text}
            </span>
          ) : (
            p.text
          ),
        )}
      </span>
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
  const where =
    op.kind === 'rebase'
      ? [op.onto && `on ${op.onto}`, op.step !== null && op.total !== null && `stopped at ${op.step} of ${op.total}`]
      : [operationTooltip(op)];
  const back = entry.shortSha ? `The branch goes back to ${entry.shortSha}. ` : '';
  return (
    <ConfirmModal
      aria-label={`Abort the ${verb}`}
      title={`Abort the ${verb}?`}
      width={460}
      onClose={close}
      context={[
        { icon: 'branch', text: entryLabel(entry) },
        { icon: 'rebase', text: where.filter(Boolean).join(' · ') || operationTooltip(op) },
      ]}
      note={`${back}Resolved conflicts are lost.`}
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
