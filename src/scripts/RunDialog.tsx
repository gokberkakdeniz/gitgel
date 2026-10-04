import { useState, type KeyboardEvent } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Icon } from '../components/icons';
import { Input } from '../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Segmented } from '../components/Segmented';
import { Select } from '../components/Select';
import { getBaseOptions } from '../lib/ipc';
import { tildifyHome } from '../lib/paths';
import { useInvoke } from '../lib/useInvoke';
import { useData } from '../state/data';
import { fillName, rememberedInputs, shownInputs, startScript, useRuns, type RunRequest } from './runs';
import styles from './RunDialog.module.css';

/** The run dialog of the pick in `useRuns.dialog` (flow O). */
export function RunDialogHost() {
  const request = useRuns((s) => s.dialog);
  if (!request) return null;
  return <RunDialog request={request} onClose={() => useRuns.setState({ dialog: null })} />;
}

function RunDialog({ request, onClose }: { request: RunRequest; onClose: () => void }) {
  const { script, entry, menu, project } = request;
  const repoPath = useData((s) => s.config?.repos.find((r) => r.id === entry.repoId)?.path ?? '');
  const [values, setValues] = useState(() => rememberedInputs(script, entry));
  const shown = shownInputs(script, entry, menu, project, values);
  const hasBranch = shown.some(({ input }) => input.type === 'branch');
  const { data: options } = useInvoke(() => getBaseOptions(entry.repoId, entry.key), [entry.key], {
    enabled: hasBranch,
  });

  const missing = shown.find(
    ({ input }) => input.required && input.type !== 'checkbox' && !(values[input.id] ?? input.default).trim(),
  );
  const note = missing
    ? missing.input.type === 'branch'
      ? 'Pick a branch to run'
      : `Fill in ${missing.input.label} to run`
    : '';
  const folder = script.runsIn === 'worktree' ? (entry.worktreePath ?? '') : repoPath;
  const branch = entry.branch ?? entry.shortSha ?? '';

  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }));
  const run = () => {
    if (missing) return;
    onClose();
    const sent = Object.fromEntries(shown.map(({ input }) => [input.id, values[input.id] ?? input.default]));
    void startScript(script, entry, menu, project, sent);
  };
  // Listed in lib/shortcuts.ts.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      run();
    }
  };

  const name = fillName(script.name, entry);
  const where = `${entry.repoName} / ${branch}`;

  // "Ask before running" with nothing to fill in: a short confirmation (flow O3).
  if (shown.length === 0) {
    return (
      <Modal aria-label={`Run ${name}`} width={460} paddingTop={180} onClose={onClose}>
        <div className={styles.confirm} onKeyDown={onKeyDown}>
          <div className={styles.confirmTitle}>Run “{name}”?</div>
          <div className={styles.context}>
            <span className={styles.contextRow}>
              <Icon name="branch" size={14} className={styles.contextIcon} />
              <span className={styles.contextText}>{where}</span>
            </span>
            {folder && (
              <span className={styles.contextRow} title={folder}>
                <Icon name="folder" size={14} className={styles.contextIcon} />
                <span className={styles.contextText}>{tildifyHome(folder)}</span>
              </span>
            )}
          </div>
          <div className={styles.actions}>
            <Button size={36} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size={36} kbd="⌘↵" autoFocus onClick={run}>
              Run
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal aria-label={name} width={600} paddingTop={110} onClose={onClose}>
      <div className={styles.dialog} onKeyDown={onKeyDown}>
        <ModalHeader
          title={name}
          sub={`${where}${folder ? ` · ${tildifyHome(folder)}` : ''}`}
          subMono
          onClose={onClose}
        />
        <div className={styles.body}>
          {shown.map(({ input, error }, i) => {
            const value = values[input.id] ?? input.default;
            const id = `run-input-${input.id}`;
            const field =
              input.type === 'checkbox' ? (
                <Checkbox
                  label={input.label}
                  checked={value === '1'}
                  autoFocus={i === 0}
                  onChange={(e) => set(input.id, e.target.checked ? '1' : '')}
                />
              ) : input.type === 'select' && input.options.length <= 4 ? (
                <Segmented
                  aria-label={input.label}
                  size="sm"
                  bordered
                  role="radio"
                  value={value}
                  onChange={(v) => set(input.id, v)}
                  options={input.options.map((o) => ({ value: o, label: o }))}
                />
              ) : input.type === 'select' ? (
                <Select
                  aria-label={input.label}
                  className={styles.select}
                  value={value}
                  onChange={(v) => set(input.id, v)}
                  options={[
                    { value: '', label: 'Pick one', disabled: true },
                    ...input.options.map((o) => ({ value: o, label: o })),
                  ]}
                />
              ) : input.type === 'branch' ? (
                <Select
                  aria-label={input.label}
                  className={styles.select}
                  icon="branch"
                  mono
                  value={value}
                  onChange={(v) => set(input.id, v)}
                  options={[
                    { value: '', label: 'Pick a branch', disabled: true },
                    ...(options?.branches ?? (value ? [value] : [])).map((b) => ({ value: b, label: b })),
                  ]}
                />
              ) : input.type === 'textarea' ? (
                <textarea
                  id={id}
                  rows={3}
                  spellCheck={false}
                  autoFocus={i === 0}
                  className={styles.area}
                  value={value}
                  onChange={(e) => set(input.id, e.target.value)}
                />
              ) : (
                <Input
                  id={id}
                  size={36}
                  className={styles.full}
                  autoFocus={i === 0}
                  value={value}
                  onChange={(v) => set(input.id, v)}
                />
              );
            return (
              <div key={input.id} className={styles.field}>
                {input.type !== 'checkbox' && (
                  <label htmlFor={id} className={styles.label}>
                    {input.label}
                  </label>
                )}
                {field}
                {error && <span className={styles.error}>{error}</span>}
              </div>
            );
          })}
        </div>
        <ModalFooter note={note}>
          <Button size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size={36} kbd="⌘↵" disabled={!!missing} onClick={run}>
            Run
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
