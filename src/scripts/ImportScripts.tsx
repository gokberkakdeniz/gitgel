import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { InfoIcon } from '../components/icons';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Pill } from '../components/Pill';
import { Segmented } from '../components/Segmented';
import { importScripts } from '../lib/ipc';
import { cnt, formatCount } from '../lib/format';
import { t } from '../i18n';
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
      useUi.getState().showToast({ message: t('scripts.imported', { ...cnt(picked.length) }) });
    } catch (e) {
      setError((e as AppError).message);
      setBusy(false);
    }
  };

  return (
    <Modal aria-label={t('scripts.importTitle')} width={680} paddingTop={110} onClose={onClose}>
      <ModalHeader
        title={t('scripts.importTitle')}
        sub={t('scripts.importSub', { path: tildifyHome(path), scripts: t('scripts.scriptCount', { ...cnt(scripts.length) }) })}
        subMono
        onClose={onClose}
      />
      <div className={styles.body}>
        <ul aria-label={t('scripts.fileList')} className={styles.list}>
          {scripts.map((s, i) => (
            <li key={i} className={checked[i] ? styles.row : `${styles.row} ${styles.off}`}>
              <Checkbox
                aria-label={t('scripts.importOne', { name: s.name })}
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
                      {t('scripts.sameName')}
                    </Pill>
                  ) : (
                    <Pill tone="accent" size="sm">
                      {t('scripts.newPill')}
                    </Pill>
                  )}
                </span>
                <code className={styles.command}>{s.command}</code>
                <span className={styles.meta}>{scriptMeta(s)}</span>
              </span>
              {clashes[i] && (
                <Segmented<Choice>
                  aria-label={t('scripts.whenExists', { name: s.name })}
                  size="sm"
                  bordered
                  role="radio"
                  value={choices[i]}
                  onChange={(v) => setChoices((c) => c.map((x, j) => (j === i ? v : x)))}
                  options={[
                    { value: 'replace', label: t('scripts.optReplace') },
                    { value: 'both', label: t('scripts.optBoth') },
                    { value: 'skip', label: t('scripts.optSkip') },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
        <div className={styles.warning}>
          <InfoIcon size={14} />
          <span>{t('scripts.importWarning')}</span>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
      <ModalFooter note={t('scripts.pickOf', { a: formatCount(picked.length), b: formatCount(scripts.length) })}>
        <Button size={36} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size={36} disabled={picked.length === 0 || busy} onClick={() => void run()}>
          {t('scripts.importBtn', { ...cnt(picked.length) })}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
