import { useEffect, useMemo, useState } from 'react';
import { getBaseOptions, setBranchBase, verifyRef } from '../../lib/ipc';
import { useInvoke } from '../../lib/useInvoke';
import { Popover } from '../Popover';
import { baseRows, looksLikeSha, type BaseRow } from './baseRows';
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

/** Choose the base of one branch: suggested (stacked), default, other branches, tags or a SHA. */
export function BaseMenu({ repoId, entryKey, branchName, anchorRect, onClose, onChosen }: Props) {
  const { data } = useInvoke(() => getBaseOptions(repoId, entryKey), [repoId, entryKey]);
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
    const list = data ? baseRows(data, query) : [];
    if (sha) list.push({ section: 'Commit', value: sha, label: `Use ${sha.slice(0, 7)}` });
    return list;
  }, [data, query, sha]);
  useEffect(() => setActive(0), [query]);

  const choose = async (row: BaseRow) => {
    const isDefault = row.value === data?.default?.name;
    await setBranchBase(entryKey, isDefault ? null : row.value);
    onClose();
    onChosen?.(row.value);
  };

  let lastSection: string | null = null;
  return (
    <Popover anchorRect={anchorRect} width={340} onClose={onClose}>
      <div role="listbox" aria-label={`Choose base for ${branchName}`} className={styles.menu}>
        <div className={styles.filterRow}>
          <input
            autoFocus
            aria-label="Filter branches"
            placeholder="Filter branches, tags, SHAs"
            className={styles.filter}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = rows.length;
                if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
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
            const cls = [styles.row, row.sub && styles.stacked, i === active && styles.active].filter(Boolean).join(' ');
            return (
              <div key={`${row.section}:${row.value}`}>
                {title && <div className={styles.section}>{title}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cls}
                  onMouseMove={() => setActive(i)}
                  onClick={() => void choose(row)}
                >
                  <span className={row.section === 'Commit' ? styles.use : styles.name}>{row.label}</span>
                  {row.sub && <span className={styles.sub}>{row.sub}</span>}
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
