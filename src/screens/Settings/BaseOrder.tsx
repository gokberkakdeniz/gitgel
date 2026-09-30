// Settings › Repositories › Default base: an ordered list edited one branch at a time, so
// there is no separator to type (docs/SPEC.md §5, design flow M4/M5).
import { useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from '../../components/icons';
import { Input } from '../../components/Input';
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
          Default base
        </span>
        <span className={styles.settingHint}>Tried in order when a branch has no base set</span>
      </span>
      <div className={styles.baseColumn}>
        <div className={styles.baseCard}>
          <ol aria-label="Default base order" className={styles.baseList}>
            {list.map((name, i) => (
              <li key={name} className={styles.baseRow}>
                <span className={styles.baseIndex}>{i + 1}</span>
                <span className={styles.baseName} title={name}>
                  {name}
                </span>
                <span className={styles.baseActions}>
                  <button
                    type="button"
                    aria-label={`Move ${name} up`}
                    className={styles.baseAction}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name} down`}
                    className={styles.baseAction}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </button>
                  {/* The list is never empty: the last branch cannot be removed. */}
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    className={styles.baseAction}
                    disabled={list.length === 1}
                    onClick={() => save(list.filter((_, j) => j !== i))}
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          {draft === null ? (
            <button type="button" className={styles.baseAdd} onClick={() => setDraft('')}>
              + Add branch
            </button>
          ) : (
            <div className={styles.baseAddField}>
              <Input
                autoFocus
                mono
                size={28}
                aria-label="Add a base branch"
                placeholder="Branch name, e.g. develop"
                value={draft}
                invalid={!!error}
                onChange={(v) => {
                  setDraft(v);
                  setError(null);
                }}
                onBlur={() => {
                  if (draft.trim() === '') cancel();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                  else if (e.key === 'Escape') {
                    e.stopPropagation();
                    cancel();
                  }
                }}
              />
            </div>
          )}
        </div>
        {draft !== null && (
          <span className={error ? styles.baseError : styles.settingHint}>{error ?? '↵ add · esc cancel'}</span>
        )}
      </div>
    </div>
  );
}
