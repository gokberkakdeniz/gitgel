import { open, save } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { isIconName } from '../../components/icons';
import { List } from '../../components/List';
import { deleteScript, exportScripts, readScriptsFile, reorderScripts, saveScript } from '../../lib/ipc';
import { t } from '../../i18n';
import type { AppError, Config, ScriptConfig } from '../../lib/types';
import { ImportScripts } from '../../scripts/ImportScripts';
import { newScript, ScriptEditor } from '../../scripts/ScriptEditor';
import { useReorder } from '../../scripts/useReorder';
import { useUi } from '../../state/ui';
import styles from './Settings.module.css';

const FILTER_EXTENSIONS = ['json'];

/** Settings › Scripts (flow N5): the user's scripts in menu order. */
export function Scripts({ config }: { config: Config }) {
  const [importing, setImporting] = useState<{ path: string; scripts: ScriptConfig[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptConfig | null>(null);
  const fail = (e: unknown) => setError((e as AppError).message ?? String(e));
  const { listRef, order, dragId, handleProps, rowStyle, dropBefore, dropAfter } = useReorder(
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
        message: t('settings.scriptRemoved', { name: script.name }),
        actionLabel: t('common.undo'),
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
    const filters = [{ name: t('settings.scriptsFilter'), extensions: FILTER_EXTENSIONS }];
    const path = await save({ defaultPath: 'gitgel-scripts.json', filters });
    if (path) await exportScripts(path).catch(fail);
  };

  const doImport = async () => {
    setError(null);
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t('settings.scriptsFilter'), extensions: FILTER_EXTENSIONS }],
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    try {
      const scripts = await readScriptsFile(path);
      if (scripts.length === 0) setError(t('settings.noScriptsFile'));
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
            <h2 className={styles.heading}>{t('settings.scriptsHeading')}</h2>
          </div>
          <div className={styles.scriptsActions}>
            <Button onClick={() => void doImport()}>{t('settings.scriptsImport')}</Button>
            <Button disabled={config.scripts.length === 0} onClick={() => void doExport()}>
              {t('settings.scriptsExport')}
            </Button>
            <Button variant="primary" onClick={() => setEditing(newScript())}>
              {t('settings.scriptsNew')}
            </Button>
          </div>
        </div>
        <List
          label={t('settings.scriptsList')}
          listRef={listRef}
          empty={t('settings.scriptsEmpty')}
          items={shown.map((s) => ({
            key: s.id,
            rowProps: {
              'data-reorder': true,
              className: s.id === dragId ? styles.dragging : undefined,
              style: rowStyle(s.id),
              'data-drop-before': dropBefore(s.id) || undefined,
              'data-drop-after': dropAfter(s.id) || undefined,
            },
            handle: { 'aria-label': t('settings.scriptMove', { name: s.name }), ...handleProps(s.id) },
            lead: 'tile',
            icon: isIconName(s.icon) ? s.icon : 'prompt',
            title: s.name,
            titleWeight: 500,
            off: s.disabled,
            badges: s.disabled ? [{ label: t('settings.aiOff'), tone: 'neutral' }] : undefined,
            actions: [
              {
                kind: 'switch',
                checked: !s.disabled,
                ariaLabel: t('settings.scriptOn', { name: s.name }),
                title: s.disabled ? t('settings.scriptOffHint') : t('settings.scriptOnHint'),
                onToggle: (on) => setOn(s, on),
              },
              { icon: 'edit', ariaLabel: t('settings.scriptEdit', { name: s.name }), onPress: () => setEditing(s) },
              { icon: 'close', ariaLabel: t('settings.scriptRemove', { name: s.name }), onPress: () => void remove(s) },
            ],
          }))}
        />
        {error && <div className={styles.scriptsError}>{error}</div>}
      </section>
      {editing && <ScriptEditor script={editing} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportScripts path={importing.path} scripts={importing.scripts} onClose={() => setImporting(null)} />
      )}
    </>
  );
}
