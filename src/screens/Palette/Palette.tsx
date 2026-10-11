import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { SearchIcon } from '../../components/icons';
import { Modal, ModalFooter } from '../../components/Modal';
import { Pill } from '../../components/Pill';
import { entryKey } from '../../lib/entryKey';
import { addEntries } from '../../lib/ipc';
import { t } from '../../i18n';
import type { EntryRef } from '../../lib/types';
import { selectRepoScans, useData } from '../../state/data';
import { selectRoute, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { GROUP_TITLES, paletteItems, searchPalette, type PaletteItem } from './items';
import styles from './Palette.module.css';

/** The Add palette (⌘K). It adds to the project on screen (saved or draft); there is no picker. */
export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const route = useNav(selectRoute);
  if (!open || route.name !== 'project') return null;
  return <PaletteDialog projectId={route.projectId} />;
}

function PaletteDialog({ projectId }: { projectId: string }) {
  const config = useData((s) => s.config);
  const scan = useData((s) => s.scan);
  const draft = useUi((s) => s.draftProject);
  const close = () => useUi.getState().setPaletteOpen(false);

  const project = projectId === 'draft' ? null : config?.projects.find((p) => p.id === projectId);
  const target = projectId === 'draft' ? draft : project;
  const inProject = useMemo(() => new Set((target?.entries ?? []).map(entryKey)), [target]);
  const items = useMemo(
    () => paletteItems(selectRepoScans({ config, scan }), inProject, target?.name ?? ''),
    [config, scan, inProject, target?.name],
  );

  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  // Space marks the active row while the search is empty or after moving with the arrows;
  // otherwise it types a space (queries like "feat queue").
  const [navigating, setNavigating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => searchPalette(items, query), [items, query]);
  const enabled = shown.filter((i) => !i.disabled);
  const activeItem = enabled[Math.min(active, enabled.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeItem?.key ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeItem]);

  if (!target) return null;

  const toggle = (key: string) =>
    setChecked((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** The ticked rows; with none ticked, ↵ takes the row reached with the arrow keys (never a
   * row that is only hovered). */
  const add = async (fromKeyboard: boolean) => {
    const fallback = fromKeyboard && navigating && activeItem ? [activeItem] : [];
    const picked = checked.size > 0 ? items.filter((i) => checked.has(i.key)) : fallback;
    const refs: EntryRef[] = picked.filter((i) => !i.disabled).map((i) => i.ref);
    if (refs.length === 0) return;
    if (projectId === 'draft' && draft) {
      const keys = new Set(draft.entries.map(entryKey));
      const fresh = refs.filter((r) => !keys.has(entryKey(r)));
      useUi.getState().setDraftProject({ ...draft, entries: [...draft.entries, ...fresh] });
    } else {
      await addEntries(projectId, refs);
    }
    close();
  };

  // ↑ ↓, space and ↵. Listed in lib/shortcuts.ts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setNavigating(true);
      const n = enabled.length;
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === ' ' && (navigating || query === '') && activeItem) {
      e.preventDefault();
      toggle(activeItem.key);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void add(true);
    }
  };

  let lastGroup: string | null = null;
  return (
    <Modal aria-label={t('palette.addTitle')} width={620} paddingTop={96} closeOnScrim onClose={close}>
      <div
        className={styles.dialog}
        onKeyDown={(e) => {
          // ↵ adds from anywhere in the palette, not only from the search box.
          if (e.key === 'Enter' && e.target !== inputRef.current) {
            e.preventDefault();
            void add(true);
          }
        }}
      >
      <label className={styles.search}>
        <SearchIcon size={17} className={styles.searchIcon} />
        <input
          ref={inputRef}
          autoFocus
          aria-label={t('branches.searchBranches')}
          className={styles.input}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setNavigating(false);
          }}
          onKeyDown={onKeyDown}
        />
        <span className={styles.hint}>{t('palette.hint')}</span>
      </label>

      <div ref={listRef} className={styles.list}>
        {shown.map((item) => {
          const title = item.group !== lastGroup ? t(GROUP_TITLES[item.group]) : null;
          lastGroup = item.group;
          return (
            <div key={item.key}>
              {title && <div className={styles.groupTitle}>{title}</div>}
              <Row
                item={item}
                checked={checked.has(item.key)}
                active={item === activeItem}
                onToggle={() => toggle(item.key)}
                onHover={() => {
                  const i = enabled.indexOf(item);
                  if (i >= 0) setActive(i);
                }}
              />
            </div>
          );
        })}
        {shown.length === 0 && <div className={styles.empty}>{t('palette.noMatches')}</div>}
      </div>

      <ModalFooter note={t('palette.selectedCount', { n: String(checked.size) })}>
        <Button onClick={close}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={checked.size === 0} onClick={() => void add(false)}>
          {t('palette.add')}
        </Button>
      </ModalFooter>
      </div>
    </Modal>
  );
}

function Row({
  item,
  checked,
  active,
  onToggle,
  onHover,
}: {
  item: PaletteItem;
  checked: boolean;
  active: boolean;
  onToggle: () => void;
  onHover: () => void;
}) {
  const cls = [styles.row, active && styles.active, item.disabled && styles.disabled].filter(Boolean).join(' ');
  return (
    <label
      className={cls}
      data-key={item.key}
      onMouseMove={onHover}
      // Keep focus (and the keyboard) in the search box.
      onMouseDown={(e) => e.preventDefault()}
    >
      <Checkbox checked={checked || item.disabled} disabled={item.disabled} onChange={onToggle} />
      <span className={styles.text}>
        <span className={styles.branch}>{item.branch}</span>
        <span className={styles.meta}>{item.meta}</span>
      </span>
      {item.tag === 'In Project' && <Pill tone="neutral">{t('palette.inProject')}</Pill>}
      {item.tag === 'merged' && <Pill tone="success">{t('branches.merged')}</Pill>}
    </label>
  );
}
