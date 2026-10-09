import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { InfoIcon } from '../components/icons';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Pill } from '../components/Pill';
import { Segmented } from '../components/Segmented';
import { importScripts } from '../lib/ipc';
import { plural } from '../lib/format';
import { tildifyHome } from '../lib/paths';
import type { AppError, ScriptConfig } from '../lib/types';
import { useData } from '../state/data';
import { useUi } from '../state/ui';
import { sameName, scriptMeta } from './describe';
import { ScriptIcon } from './ScriptIcon';
import styles from './ImportScripts.module.css';

type Choice = 'replace' | 'both' | 'skip';

/** Flow N7: every command in full before anything is imported. */
export function ImportScripts({
  path,
  scripts,
  onClose,
}: {
  path: string;
  scripts: ScriptConfig[];
  onClose: () => void;
}) {
  const existing = useData((s) => s.config?.scripts ?? []);
  const clashes = scripts.map((s) => existing.some((e) => sameName(e.name, s.name)));
  const [checked, setChecked] = useState(() => scripts.map(() => true));
  const [choices, setChoices] = useState<Choice[]>(() => scripts.map(() => 'replace'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = scripts.filter((_, i) => checked[i] && !(clashes[i] && choices[i] === 'skip'));
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const replace = scripts.filter((_, i) => checked[i] && clashes[i] && choices[i] === 'replace').map((s) => s.name);
      await importScripts(picked, replace);
      onClose();
      useUi.getState().showToast({ message: `Imported ${plural(picked.length, 'script', 'scripts')}` });
    } catch (e) {
      setError((e as AppError).message);
      setBusy(false);
    }
  };

  return (
    <Modal aria-label="Import Scripts" width={680} paddingTop={110} onClose={onClose}>
      <ModalHeader
        title="Import Scripts"
        sub={`${tildifyHome(path)} · ${plural(scripts.length, 'script', 'scripts')}`}
        subMono
        onClose={onClose}
      />
      <div className={styles.body}>
        <ul aria-label="Scripts in the file" className={styles.list}>
          {scripts.map((s, i) => (
            <li key={i} className={checked[i] ? styles.row : `${styles.row} ${styles.off}`}>
              <Checkbox
                aria-label={`Import ${s.name}`}
                className={styles.check}
                checked={checked[i]}
                onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              />
              <ScriptIcon name={s.icon} />
              <span className={styles.text}>
                <span className={styles.nameLine}>
                  <span className={styles.name}>{s.name}</span>
                  {clashes[i] ? (
                    <Pill tone="warning" size="sm">
                      Same Name Exists
                    </Pill>
                  ) : (
                    <Pill tone="accent" size="sm">
                      new
                    </Pill>
                  )}
                </span>
                <code className={styles.command}>{s.command}</code>
                <span className={styles.meta}>{scriptMeta(s)}</span>
              </span>
              {clashes[i] && (
                <Segmented<Choice>
                  aria-label={`When ${s.name} already exists`}
                  size="sm"
                  bordered
                  role="radio"
                  value={choices[i]}
                  onChange={(v) => setChoices((c) => c.map((x, j) => (j === i ? v : x)))}
                  options={[
                    { value: 'replace', label: 'Replace' },
                    { value: 'both', label: 'Keep both' },
                    { value: 'skip', label: 'Skip' },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
        <div className={styles.warning}>
          <InfoIcon size={14} />
          <span>
            Scripts run as you, with your permissions. Read each command before importing. Imported scripts ask
            before running; you can turn that off per script.
          </span>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
      <ModalFooter note={`${picked.length} of ${scripts.length} selected`}>
        <Button size={36} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={picked.length === 0 || busy} onClick={() => void run()}>
          Import {plural(picked.length, 'script', 'scripts')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
