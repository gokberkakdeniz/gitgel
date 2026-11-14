import Fuse from 'fuse.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Pill } from '../../components/Pill';
import { t } from '../../i18n';
import { agoText, cnt, formatCount } from '../../lib/format';
import { tildifyHome } from '../../lib/paths';
import type { RepoScan } from '../../lib/types';
import { revTarget, selectRoute, useNav } from '../../state/nav';
import styles from '../Palette/Palette.module.css';

type Group = 'worktrees' | 'active' | 'older' | 'remote';

const GROUP_TITLES: Record<Group, string> = {
  worktrees: 'palette.groupWorktrees',
  active: 'palette.groupActive',
  older: 'palette.groupOlder',
  remote: 'branches.remoteBranches',
};

/** Older and remote branches shown at most while searching, each. */
const SEARCH_LIMIT = 50;

interface Item {
  rev: string;
  group: Group;
  name: string;
  worktreePath: string | null;
  meta: string;
  merged: boolean;
}

/** The repo's branches, grouped as in the Add palette, plus its remote-only branches. */
function switchItems(scan: RepoScan, now: number = Date.now() / 1000): Item[] {
  const join = (parts: (string | null | false)[]) => parts.filter(Boolean).join(' · ');
  const items: Item[] = [];
  for (const e of scan.active) {
    const rev = e.branch ?? e.headSha;
    if (!rev) continue;
    const merged = e.state === 'merged';
    items.push({
      rev,
      group: e.worktreePath ? 'worktrees' : 'active',
      name: e.branch ?? e.shortSha ?? rev,
      worktreePath: e.worktreePath,
      meta: join([
        e.worktreePath && tildifyHome(e.worktreePath),
        merged ? t('palette.mergedInto', { base: e.base ?? '' }) : e.ahead !== null && `↑${formatCount(e.ahead)}`,
        !merged && e.files !== null && t('branches.fileCount', { ...cnt(e.files) }),
        !!e.uncommitted && t('palette.uncommittedCount', { n: formatCount(e.uncommitted) }),
        !e.worktreePath && !!e.lastCommitAt && agoText(e.lastCommitAt, now),
      ]),
      merged,
    });
  }
  for (const o of scan.others) {
    items.push({
      rev: o.branch,
      group: 'older',
      name: o.branch,
      worktreePath: null,
      meta: join([o.merged && t('palette.mergedInto', { base: scan.defaultBase ?? '' }), agoText(o.lastCommitAt, now)]),
      merged: o.merged,
    });
  }
  for (const r of scan.remotes) {
    items.push({
      rev: r.name,
      group: 'remote',
      name: r.name,
      worktreePath: null,
      meta: agoText(r.lastCommitAt, now),
      merged: false,
    });
  }
  return items;
}

/** Without a query: worktrees and active branches; older and remote ones only while searching. */
function searchItems(items: Item[], query: string): Item[] {
  const q = query.trim();
  const found = q
    ? new Fuse(items, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'worktreePath', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      })
        .search(q)
        .map((r) => r.item)
    : items.filter((i) => i.group === 'worktrees' || i.group === 'active');
  const byGroup = (g: Group) => found.filter((i) => i.group === g);
  return [
    ...byGroup('worktrees'),
    ...byGroup('active'),
    ...byGroup('older').slice(0, SEARCH_LIMIT),
    ...byGroup('remote').slice(0, SEARCH_LIMIT),
  ];
}

/** Switch Branch (⇧⌘B, Review's page menu): opens Review on another branch of the same repo,
 * in place of this one (Back still leads where it did). */
export function SwitchBranchDialog({ scan, rev, onClose }: { scan: RepoScan; rev: string; onClose: () => void }) {
  const items = useMemo(() => switchItems(scan), [scan]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => searchItems(items, query), [items, query]);
  const enabled = shown.filter((i) => i.rev !== rev);
  const activeItem = enabled[Math.min(active, enabled.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-rev="${CSS.escape(activeItem?.rev ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeItem]);

  const pick = (item: Item | undefined) => {
    if (!item || item.rev === rev) return;
    onClose();
    const nav = useNav.getState();
    const route = selectRoute(nav);
    if (route.name === 'review' && route.target.kind === 'branch')
      nav.replace({ ...route, target: revTarget(route.target.repoId, item.rev) });
  };

  // ↑ ↓ and ↵. Listed in lib/shortcuts.ts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = enabled.length;
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(activeItem);
    }
  };

  let lastGroup: Group | null = null;
  return (
    <Modal aria-label={t('history.switchBranch')} width={620} paddingTop={96} closeOnScrim onClose={onClose}>
      <div className={styles.dialog}>
        <label className={styles.search}>
          <SearchIcon size={17} className={styles.searchIcon} />
          <input
            autoFocus
            aria-label={t('branches.searchBranches')}
            className={styles.input}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className={styles.hint}>{scan.name}</span>
        </label>

        <div ref={listRef} className={styles.list}>
          {shown.map((item) => {
            const title = item.group !== lastGroup ? t(GROUP_TITLES[item.group]) : null;
            lastGroup = item.group;
            const current = item.rev === rev;
            const cls = [styles.row, item === activeItem && styles.active, current && styles.disabled]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={`${item.group}:${item.rev}`}>
                {title && <div className={styles.groupTitle}>{title}</div>}
                <div
                  role="option"
                  aria-selected={item === activeItem}
                  aria-disabled={current}
                  className={cls}
                  data-rev={item.rev}
                  onMouseMove={() => {
                    const i = enabled.indexOf(item);
                    if (i >= 0) setActive(i);
                  }}
                  // Keep focus (and the keyboard) in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                >
                  <span className={styles.text}>
                    <span className={styles.branch}>{item.name}</span>
                    {item.meta && <span className={styles.meta}>{item.meta}</span>}
                  </span>
                  {current ? (
                    <Pill tone="neutral">{t('history.currentBranch')}</Pill>
                  ) : (
                    item.merged && <Pill tone="success">{t('branches.merged')}</Pill>
                  )}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className={styles.empty}>{t('palette.noMatches')}</div>}
        </div>
      </div>
    </Modal>
  );
}
