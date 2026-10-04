import { useEffect, useMemo, useState } from 'react';
import { getBaseOptions, setBranchBase, verifyRef } from '../../lib/ipc';
import { useInvoke } from '../../lib/useInvoke';
import { useData } from '../../state/data';
import { CheckIcon } from '../icons';
import { Input } from '../Input';
import { Popover } from '../Popover';
import { AUTO_TITLE, baseRows, initialRow, looksLikeSha, type BaseRow } from './baseRows';
import styles from './BaseMenu.module.css';

interface Props {
  repoId: string;
  entryKey: string;
  branchName: string;
  anchorRect: DOMRect;
  onClose: () => void;
  /** After the base was saved. */
  onChosen?: (base: string) => void;
}

/** Choose the base of one branch: suggested (stacked), default (local and remote forms), other
 * branches, remote branches, tags or a SHA. */
export function BaseMenu({ repoId, entryKey, branchName, anchorRect, onClose, onChosen }: Props) {
  const { data } = useInvoke(() => getBaseOptions(repoId, entryKey), [repoId, entryKey]);
  // A base stored for this branch (else the nearest default applies).
  const custom = useData((s) => !!s.config?.branchBases[entryKey]);
  const ownBranch = useMemo(() => {
    const rest = entryKey.slice(entryKey.indexOf(':') + 1);
    return rest.startsWith('@') ? null : rest;
  }, [entryKey]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [sha, setSha] = useState<string | null>(null);

  // A commit SHA typed into the filter can be used directly.
  useEffect(() => {
    setSha(null);
    if (!looksLikeSha(query)) return;
    let live = true;
    void verifyRef(repoId, query.trim()).then((full) => live && setSha(full));
    return () => {
      live = false;
    };
  }, [repoId, query]);

  const rows = useMemo(() => {
    const list = data ? baseRows(data, query, custom, ownBranch) : [];
    if (sha) list.push({ section: 'Commit', value: sha, label: `Use ${sha.slice(0, 7)}` });
    return list;
  }, [data, query, custom, ownBranch, sha]);
  // Opens on the base in use; typing starts again from the top.
  useEffect(() => {
    setActive(query ? Math.max(0, rows.findIndex((r) => !r.disabled)) : initialRow(rows));
    // Only when the options arrive or the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query]);

  // Automatic forgets the stored base (the nearest default applies again); any other row stores it.
  const choose = async (row: BaseRow) => {
    if (row.disabled) return;
    await setBranchBase(entryKey, row.auto ? null : row.value);
    onClose();
    const used = row.auto ? data?.defaults?.candidates.find((c) => c.auto)?.name : row.value;
    if (used) onChosen?.(used);
  };
  // ↑ / ↓ skip rows that cannot be chosen.
  const step = (from: number, dir: 1 | -1) => {
    const n = rows.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (!rows[i].disabled) return i;
    }
    return from;
  };

  let lastSection: string | null = null;
  return (
    <Popover anchorRect={anchorRect} width={340} onClose={onClose}>
      <div role="listbox" aria-label={`Choose base for ${branchName}`} className={styles.menu}>
        <div className={styles.filterRow}>
          <Input
            autoFocus
            leftIcon="search"
            mono
            clearable
            size={32}
            aria-label="Search branches"
            placeholder="Search"
            className={styles.filter}
            value={query}
            onChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (rows.length) setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1));
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault();
                void choose(rows[active]);
              }
            }}
          />
        </div>
        <div className={styles.list}>
          {rows.map((row, i) => {
            const title = row.section !== lastSection && row.section !== 'Commit' ? row.section : null;
            lastSection = row.section;
            const dim = row.section === 'Other branches' || row.section === 'Remote branches';
            const cls = [styles.row, row.sub && styles.stacked, i === active && styles.active, row.disabled && styles.disabled]
              .filter(Boolean)
              .join(' ');
            const nameCls =
              row.section === 'Commit' ? styles.use : row.auto ? styles.plain : dim ? `${styles.name} ${styles.dim}` : styles.name;
            return (
              <div key={`${row.section}:${row.value}`}>
                {title && (
                  <div className={styles.section}>
                    <span>{title}</span>
                    {title === 'Default' && data?.defaults && <span className={styles.source}>from {data.defaults.source}</span>}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={!!row.selected}
                  aria-disabled={row.disabled || undefined}
                  title={row.disabled ? 'No common ancestor with this branch' : row.auto ? AUTO_TITLE : undefined}
                  className={cls}
                  onMouseMove={() => !row.disabled && setActive(i)}
                  onClick={() => void choose(row)}
                >
                  {/* The base in use: one check, whatever the section. */}
                  <span className={row.selected ? styles.check : `${styles.check} ${styles.hidden}`}>
                    <CheckIcon />
                  </span>
                  <span className={row.sub ? styles.text : styles.grow}>
                    <span className={nameCls}>{row.label}</span>
                    {row.sub && <span className={styles.sub}>{row.sub}</span>}
                  </span>
                  {row.note && <span className={styles.note}>{row.note}</span>}
                </button>
              </div>
            );
          })}
          {data && rows.length === 0 && <div className={styles.empty}>No matching refs</div>}
        </div>
      </div>
    </Popover>
  );
}
