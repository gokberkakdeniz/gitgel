// Settings › Repositories › Default Base: an ordered list edited one branch at a time, so
// there is no separator to type (docs/SPEC.md §5, design flow M4/M5).
import { useState } from 'react';
import { List } from '../../components/List';
import { t } from '../../i18n';
import { updateSettings } from '../../lib/ipc';
import type { Config } from '../../lib/types';
import styles from './Settings.module.css';
import { baseNameError } from './parse';

export function BaseOrder({ config }: { config: Config }) {
  const list = config.settings.defaultBaseOrder;
  const [draft, setDraft] = useState<string | null>(null); // null: not adding
  const [error, setError] = useState<string | null>(null);

  const save = (next: string[]) => void updateSettings({ ...config.settings, defaultBaseOrder: next });
  const move = (i: number, by: -1 | 1) => {
    const next = list.slice();
    next.splice(i + by, 0, next.splice(i, 1)[0]);
    save(next);
  };
  const cancel = () => {
    setDraft(null);
    setError(null);
  };
  const add = () => {
    const name = (draft ?? '').trim();
    const why = baseNameError(name, list);
    if (why) {
      setError(why);
      return;
    }
    save([...list, name]);
    cancel();
  };

  return (
    <div role="group" aria-labelledby="base-title" className={styles.baseSetting}>
      <span className={`${styles.settingText} ${styles.baseText}`}>
        <span id="base-title" className={styles.settingName}>
          {t('settings.baseTitle')}
        </span>
        <span className={styles.settingHint}>{t('settings.baseHint')}</span>
      </span>
      <div className={styles.baseColumn}>
        <List
          label={t('settings.baseList')}
          ordered
          density="compact"
          radius={10}
          items={list.map((name, i) => ({
            key: name,
            lead: 'index',
            leadText: String(i + 1),
            title: name,
            titleMono: true,
            actionsOnHover: true,
            actions: [
              { icon: 'arrow-up', ariaLabel: t('settings.baseMoveUp', { name }), disabled: i === 0, onPress: () => move(i, -1) },
              { icon: 'arrow-down', ariaLabel: t('settings.baseMoveDown', { name }), disabled: i === list.length - 1, onPress: () => move(i, 1) },
              // The list is never empty: the last branch cannot be removed.
              {
                icon: 'close',
                ariaLabel: t('settings.baseRemove', { name }),
                disabled: list.length === 1,
                onPress: () => save(list.filter((_, j) => j !== i)),
              },
            ],
          }))}
          addLabel={t('settings.baseAdd')}
          onAdd={() => setDraft('')}
          adding={
            draft === null
              ? undefined
              : {
                  autoFocus: true,
                  'aria-label': t('settings.baseAddLabel'),
                  placeholder: t('settings.baseAddPh'),
                  value: draft,
                  invalid: !!error,
                  onChange: (v) => {
                    setDraft(v);
                    setError(null);
                  },
                  onBlur: () => {
                    if (draft.trim() === '') cancel();
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') add();
                    else if (e.key === 'Escape') {
                      e.stopPropagation();
                      cancel();
                    }
                  },
                }
          }
        />
        {error && <span className={styles.baseError}>{error}</span>}
      </div>
    </div>
  );
}
