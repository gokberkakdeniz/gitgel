import { useState, type KeyboardEvent } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Input } from '../components/Input';
import { ConfirmModal } from '../components/ConfirmModal';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Segmented } from '../components/Segmented';
import { Select } from '../components/Select';
import { getBaseOptions } from '../lib/ipc';
import { t } from '../i18n';
import { tildifyHome } from '../lib/paths';
import { useInvoke } from '../lib/useInvoke';
import { useData } from '../state/data';
import { fillName, initialInputs, shownInputs, startScript, useRuns, type RunRequest } from './runs';
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
  const [values, setValues] = useState(() => initialInputs(script));
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
      ? t('scripts.pickBranch')
      : t('scripts.fillToRun', { label: missing.input.label })
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
      <ConfirmModal
        aria-label={t('scripts.runTitle')}
        title={t('scripts.runTitle')}
        width={460}
        onClose={onClose}
        onKeyDown={onKeyDown}
        context={[
          { icon: script.icon, text: name },
          { icon: 'branch', text: where },
          ...(folder ? [{ icon: 'folder' as const, text: tildifyHome(folder), title: folder }] : []),
        ]}
      >
        <Button size={36} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size={36} kbd="⌘↵" autoFocus onClick={run}>
          {t('scripts.runBtn')}
        </Button>
      </ConfirmModal>
    );
  }

  return (
    <Modal aria-label={t('scripts.runFormTitle')} width={600} paddingTop={110} onClose={onClose}>
      <div className={styles.dialog} onKeyDown={onKeyDown}>
        <ModalHeader
          title={t('scripts.runFormTitle')}
          sub={`${name} · ${where}${folder ? ` · ${tildifyHome(folder)}` : ''}`}
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
                    { value: '', label: t('scripts.pickOne'), disabled: true },
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
                    { value: '', label: t('scripts.pickBranchPh'), disabled: true },
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
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size={36} kbd="⌘↵" disabled={!!missing} onClick={run}>
            {t('scripts.runBtn')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
