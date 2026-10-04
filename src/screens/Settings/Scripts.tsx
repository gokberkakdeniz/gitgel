import { open, save } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Pill } from '../../components/Pill';
import { Switch } from '../../components/Switch';
import { CloseIcon, EditIcon } from '../../components/icons';
import { deleteScript, exportScripts, readScriptsFile, reorderScripts, saveScript } from '../../lib/ipc';
import type { AppError, Config, ScriptConfig } from '../../lib/types';
import { ImportScripts } from '../../scripts/ImportScripts';
import { DragHandle } from '../../scripts/DragHandle';
import { newScript, ScriptEditor } from '../../scripts/ScriptEditor';
import { ScriptIcon } from '../../scripts/ScriptIcon';
import { useReorder } from '../../scripts/useReorder';
import { useUi } from '../../state/ui';
import styles from './Settings.module.css';

const FILTERS = [{ name: 'Gitgel scripts', extensions: ['json'] }];

/** Settings › Scripts (flow N5): the user's scripts in menu order. */
export function Scripts({ config }: { config: Config }) {
  const [importing, setImporting] = useState<{ path: string; scripts: ScriptConfig[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptConfig | null>(null);
  const fail = (e: unknown) => setError((e as AppError).message ?? String(e));
  const { listRef, order, dragId, handleProps } = useReorder(
    config.scripts.map((s) => s.id),
    (ids) => {
      setError(null);
      void reorderScripts(ids).catch(fail);
    },
  );
  const byId = new Map(config.scripts.map((s) => [s.id, s]));
  const shown = order.map((id) => byId.get(id)).filter((s): s is ScriptConfig => !!s);

  const remove = async (script: ScriptConfig) => {
    setError(null);
    const before = config.scripts.map((s) => s.id);
    try {
      await deleteScript(script.id);
      useUi.getState().showToast({
        message: `“${script.name}” removed`,
        actionLabel: 'Undo',
        onAction: () =>
          void saveScript(script)
            .then(() => reorderScripts(before))
            .catch(fail),
      });
    } catch (e) {
      fail(e);
    }
  };

  // Off and on at once, no toast: the row shows it.
  const setOn = (script: ScriptConfig, on: boolean) => {
    setError(null);
    void saveScript({ ...script, disabled: !on }).catch(fail);
  };

  const doExport = async () => {
    setError(null);
    const path = await save({ defaultPath: 'gitgel-scripts.json', filters: FILTERS });
    if (path) await exportScripts(path).catch(fail);
  };

  const doImport = async () => {
    setError(null);
    const picked = await open({ multiple: false, directory: false, filters: FILTERS });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    try {
      const scripts = await readScriptsFile(path);
      if (scripts.length === 0) setError('That file has no scripts.');
      else setImporting({ path, scripts });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <section className={styles.section}>
        <div className={styles.scriptsHead}>
          <div className={styles.scriptsTitle}>
            <h2 className={styles.heading}>Scripts</h2>
            <span className={styles.settingHint}>
              Your own items in the branch menus. Each runs a shell command for that branch. Drag to reorder; switch one off to take it out of the
              menus.
            </span>
          </div>
          <div className={styles.scriptsActions}>
            <Button onClick={() => void doImport()}>Import…</Button>
            <Button disabled={config.scripts.length === 0} onClick={() => void doExport()}>
              Export…
            </Button>
            <Button variant="primary" onClick={() => setEditing(newScript())}>
              + New script
            </Button>
          </div>
        </div>
        <ul ref={listRef} aria-label="Scripts" className={`${styles.card} ${styles.scriptList}`}>
          {shown.map((s) => (
            <li
              key={s.id}
              data-reorder
              className={s.id === dragId ? `${styles.scriptRow} ${styles.dragging}` : styles.scriptRow}
            >
              <DragHandle aria-label={`Move ${s.name}`} {...handleProps(s.id)} />
              <ScriptIcon name={s.icon} className={s.disabled ? styles.scriptOff : undefined} />
              <span className={styles.scriptNameCell}>
                <span className={s.disabled ? `${styles.scriptName} ${styles.scriptNameOff}` : styles.scriptName}>
                  {s.name}
                </span>
                {s.disabled && (
                  <Pill tone="neutral" size="sm">
                    off
                  </Pill>
                )}
              </span>
              <Switch
                checked={!s.disabled}
                aria-label={`${s.name} on`}
                title={s.disabled ? 'Off: in no menu. Switch on to show it' : 'On: shown in its menus. Switch off to hide it'}
                onChange={(e) => setOn(s, e.target.checked)}
              />
              <IconButton aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                <EditIcon />
              </IconButton>
              <IconButton aria-label={`Remove ${s.name}`} onClick={() => void remove(s)}>
                <CloseIcon size={13} />
              </IconButton>
            </li>
          ))}
          {config.scripts.length === 0 && <li className={styles.scriptsEmpty}>No scripts yet</li>}
        </ul>
        {error && <div className={styles.scriptsError}>{error}</div>}
        <span className={styles.settingHint}>
          Scripts run as you, with your permissions. Gitgel itself still only reads the repositories.
        </span>
      </section>
      {editing && <ScriptEditor script={editing} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportScripts path={importing.path} scripts={importing.scripts} onClose={() => setImporting(null)} />
      )}
    </>
  );
}
