import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, Icon, SearchIcon } from '../components/icons';
import { Kbd } from '../components/Kbd';
import { Modal } from '../components/Modal';
import { t } from '../i18n';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
import { appCommands, appGoItems } from './global';
import { contributions, type Command, type GoItem } from './registry';
import { loadRecent, parseQuery, rememberRecent, searchCommands, searchGo, type Prefix } from './search';
import styles from './CommandPalette.module.css';

/** The command palette (SPEC §5): ⌘P goes to a place, ⇧⌘P (a query starting with ">") runs a
 * command. Mounted once (App). */
export function CommandPalette() {
  const mode = useUi((s) => s.commandPalette);
  if (!mode) return null;
  return <PaletteDialog mode={mode} />;
}

const KIND_TITLES: Record<GoItem['kind'], string> = {
  project: 'cmd.kindProject',
  worktree: 'cmd.kindWorktree',
  branch: 'cmd.kindBranch',
};

/** `?`: each prefix and what it lists. */
const HELP: { prefix: Prefix; title: string }[] = [
  { prefix: '>', title: 'cmd.commandsTitle' },
  { prefix: '#', title: 'sidebar.projects' },
  { prefix: '~', title: 'palette.groupWorktrees' },
  { prefix: '/', title: 'sidebar.branches' },
];

type Row =
  | { kind: 'go'; item: GoItem }
  | { kind: 'command'; item: Command }
  | { kind: 'help'; item: { prefix: Prefix; title: string; group: string } };

const rowKey = (r: Row) => (r.kind === 'go' ? `go:${r.item.key}` : r.kind === 'command' ? `cmd:${r.item.id}` : `help:${r.item.prefix}`);

function PaletteDialog({ mode }: { mode: 'go' | 'commands' }) {
  const close = () => useUi.getState().setCommandPalette(null);
  // What the screens and the app offer, as they are when the palette opens.
  const [{ go, commands }] = useState(() => {
    const route = selectRoute(useNav.getState());
    const parts = contributions();
    // The screen's groups first, the app's after; the order within each as given.
    const order = ['cmd.groupReview', 'cmd.groupBranch', 'cmd.groupProject', 'cmd.groupGeneral', 'cmd.groupSettings'].map((k) => t(k));
    const rank = (c: Command) => order.indexOf(c.group);
    const all = [...parts.flatMap((p) => p.commands ?? []), ...appCommands(route)];
    return {
      go: [...parts.flatMap((p) => p.go ?? []), ...appGoItems(route)],
      commands: all.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c),
    };
  });
  const [recent] = useState(loadRecent);

  const [query, setQuery] = useState(mode === 'commands' ? '>' : '');
  // ⌘P / ⇧⌘P while it is open switch the mode.
  useEffect(() => {
    setQuery((q) => (mode === 'commands' ? (q.startsWith('>') ? q : `>${q}`) : q.replace(/^>\s*/, '')));
  }, [mode]);
  const parsed = parseQuery(query);
  const inCommands = parsed.mode === 'commands';

  const rows: Row[] = useMemo(() => {
    if (parsed.mode === 'help') return HELP.map((h) => ({ kind: 'help', item: { ...h, group: 'help' } }));
    if (parsed.mode === 'commands')
      return searchCommands(commands, parsed.text, recent, t('cmd.groupRecent')).map((item) => ({ kind: 'command', item }));
    return searchGo(go, parsed.text, parsed.kinds).map((item) => ({ kind: 'go', item }));
  }, [parsed.mode, parsed.text, parsed.kinds, commands, go, recent]);

  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRow = rows[Math.min(active, rows.length - 1)];
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeRow ? rowKey(activeRow) : '')}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeRow]);

  const run = (row: Row | undefined) => {
    if (!row) return;
    // A prefix from `?` goes into the search box; the palette stays.
    if (row.kind === 'help') {
      setQuery(row.item.prefix);
      return;
    }
    if (row.kind === 'command') rememberRecent(row.item.id);
    close();
    // After the palette is gone: a command may open a dialog or focus a field.
    window.setTimeout(row.item.run, 0);
  };

  // ↑ ↓ and ↵. Listed in lib/shortcuts.ts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = rows.length;
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(activeRow);
    }
  };

  let lastGroup: string | null = null;
  let lastHeaded = false;
  return (
    <Modal aria-label={t(inCommands ? 'cmd.commandsTitle' : 'cmd.goTitle')} width={620} paddingTop={96} closeOnScrim onClose={close}>
      <label className={styles.search}>
        <SearchIcon size={17} className={styles.searchIcon} />
        <input
          autoFocus
          aria-label={t(inCommands ? 'cmd.commandsTitle' : 'cmd.goTitle')}
          placeholder={t('cmd.goPlaceholder')}
          className={styles.input}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div ref={listRef} className={styles.list}>
        {rows.map((row) => {
          // Places say what they are with their icon; only commands have group titles, and the
          // project on show's entries its name, with a line after them.
          const group = row.item.group;
          const heading = row.kind === 'go' ? row.item.heading : undefined;
          const title = group === lastGroup || row.kind === 'help' ? null : row.kind === 'command' ? group : (heading ?? null);
          const line = row.kind === 'go' && !heading && lastHeaded;
          lastGroup = group;
          lastHeaded = !!heading;
          const key = rowKey(row);
          const cls = [styles.row, row === activeRow && styles.active].filter(Boolean).join(' ');
          return (
            <div key={key}>
              {line && <div className={styles.line} />}
              {title && <div className={styles.groupTitle}>{title}</div>}
              <div
                role="option"
                aria-selected={row === activeRow}
                className={cls}
                data-key={key}
                onMouseMove={() => setActive(rows.indexOf(row))}
                // Keep focus (and the keyboard) in the search box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(row)}
              >
                {row.kind === 'go' ? (
                  <>
                    <span className={styles.kind} title={t(KIND_TITLES[row.item.kind])}>
                      <Icon name={row.item.kind} size={14} />
                    </span>
                    <span className={row.item.repo ? `${styles.title} ${styles.mono}` : styles.title}>
                      {row.item.repo && <span className={styles.repo}>{row.item.repo}/</span>}
                      {row.item.label}
                    </span>
                    {row.item.current && <CheckIcon size={14} className={styles.current} />}
                  </>
                ) : row.kind === 'help' ? (
                  <>
                    <span className={styles.prefix}>{row.item.prefix}</span>
                    <span className={styles.title}>{t(row.item.title)}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.title}>{row.item.title}</span>
                    {row.item.keys && <Kbd>{row.item.keys}</Kbd>}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className={styles.empty}>{t('palette.noMatches')}</div>}
      </div>
    </Modal>
  );
}
