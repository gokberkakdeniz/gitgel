// Parts of the diff pane shared by Review and History (SPEC §16): the view menu, change
// navigation, file rows, and the remembered diff view settings with their ⌥ keys.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, SplitIcon, UnifiedIcon } from '../../components/icons';
import { KindBadge } from '../../components/KindBadge';
import { Menu, MenuDivider, MenuItem, MenuLabel, MenuSegmented } from '../../components/Menu';
import { FileOpenItems } from '../../components/OpenItems';
import { Popover } from '../../components/Popover';
import { updateSettings } from '../../lib/ipc';
import { basename } from '../../lib/paths';
import type { DiffContext, DiffLayout, FileChange, Settings } from '../../lib/types';
import type { NavInfo } from '../../monaco/DiffView';
import { useData } from '../../state/data';
import { useNav, type Route } from '../../state/nav';
import { useUi } from '../../state/ui';
import { firstHit } from './fileFilter';
import styles from './Review.module.css';
import { dirLabel } from './selection';

/** Layout, context and whitespace, remembered in the config; ⌥V / ⌥C / ⌥W outside the diff
 * (inside it Monaco handles them). Listed in lib/shortcuts.ts. */
export function useDiffView() {
  const settings = useData((st) => st.config?.settings);
  const layout = settings?.diffView ?? 'split';
  const ignoreWs = settings?.ignoreWhitespace ?? false;
  const context = settings?.diffContext ?? 'changes';
  const contextLines = settings?.diffContextLines ?? 3;
  const saveView = (patch: Partial<Settings>) => {
    if (settings) void updateSettings({ ...settings, ...patch });
  };
  const toggleLayout = () => saveView({ diffView: layout === 'split' ? 'unified' : 'split' });
  const toggleWs = () => saveView({ ignoreWhitespace: !ignoreWs });
  // Keeps the number of lines when switching back to changes only.
  const toggleContext = () => saveView({ diffContext: context === 'changes' ? 'whole' : 'changes' });
  const viewRef = useRef({ toggleLayout, toggleWs, toggleContext });
  viewRef.current = { toggleLayout, toggleWs, toggleContext };
  // ⌥ turns letters into other characters, so the physical key is checked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || !['KeyV', 'KeyC', 'KeyW'].includes(e.code)) return;
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor, input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      if (e.code === 'KeyV') viewRef.current.toggleLayout();
      else if (e.code === 'KeyC') viewRef.current.toggleContext();
      else viewRef.current.toggleWs();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { layout, ignoreWs, context, contextLines, saveView, toggleWs, viewRef };
}

const fileName = (id: string | undefined) => (id ? basename(id.split('\u0000')[1]) : '');

/** Layout, context and Ignore whitespace; applies to every diff and is remembered. */
export function ViewMenu({
  layout,
  ignoreWs,
  onLayout,
  context,
  contextLines,
  onContext,
  onToggleWs,
}: {
  layout: DiffLayout;
  ignoreWs: boolean;
  onLayout: (l: DiffLayout) => void;
  context: DiffContext;
  contextLines: number;
  onContext: (context: DiffContext, lines: number) => void;
  onToggleWs: () => void;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        title="Diff view"
        className={at ? `${styles.viewButton} ${styles.viewButtonOpen}` : styles.viewButton}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        {layout === 'split' ? <SplitIcon /> : <UnifiedIcon />}
        <span>{layout === 'split' ? 'Split' : 'Unified'}</span>
        <ChevronDownIcon size={9} />
      </button>
      {at && (
        <Popover anchorRect={at} width={300} alignRight onClose={() => setAt(null)}>
          <Menu aria-label="Diff view">
            <MenuLabel>Layout</MenuLabel>
            {(['split', 'unified'] as const).map((l) => (
              <MenuItem
                key={l}
                checked={layout === l}
                kbd="⌥V"
                onSelect={() => {
                  onLayout(l);
                  setAt(null);
                }}
              >
                {l === 'split' ? 'Split' : 'Unified'}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuLabel>Context</MenuLabel>
            <MenuItem checked={context === 'changes'} kbd="⌥C" onSelect={() => onContext('changes', contextLines)}>
              Changes only
            </MenuItem>
            <MenuSegmented
              label="Lines around changes"
              disabled={context === 'whole'}
              value={String(contextLines)}
              onChange={(n) => onContext('changes', Number(n))}
              options={[3, 5, 10].map((n) => ({ value: String(n), label: String(n) }))}
            />
            <MenuItem
              checked={context === 'whole'}
              kbd="⌥C"
              onSelect={() => {
                onContext('whole', contextLines);
                // Whole file closes the menu; changes only leaves it open to pick the lines.
                setAt(null);
              }}
            >
              Whole file
            </MenuItem>
            <MenuDivider />
            <MenuItem
              box={ignoreWs}
              desc="Hide lines where only indentation or trailing spaces changed"
              kbd="⌥W"
              onSelect={onToggleWs}
            >
              Ignore whitespace
            </MenuItem>
          </Menu>
        </Popover>
      )}
    </>
  );
}

/** "Change 2 of 3" and ↑ ↓; past a file's first/last change they continue into the neighbour. */
export function ChangeNav({
  onlyWhitespace,
  nav,
  prevFile,
  nextFile,
  onStep,
}: {
  /** Ignoring whitespace left this file with no changes. */
  onlyWhitespace: boolean;
  nav: NavInfo;
  prevFile: string | undefined;
  nextFile: string | undefined;
  onStep: (dir: 1 | -1) => void;
}) {
  const i = nav.index ?? 0;
  const atFirst = nav.count === 0 || i === 0;
  const atLast = nav.count === 0 || i >= nav.count - 1;
  const prevTitle = atFirst
    ? prevFile
      ? 'Previous (⌥↑)'
      : 'First change'
    : 'Previous change (⌥↑)';
  const nextTitle = atLast
    ? nextFile
      ? 'Next (⌥↓)'
      : 'Last change'
    : 'Next change (⌥↓)';
  const cls = (cross: boolean) => (cross ? `${styles.navButton} ${styles.navCross}` : styles.navButton);
  return (
    <>
      <span aria-live="polite" className={styles.navLabel}>
        {nav.count === 0
          ? onlyWhitespace
            ? 'Only whitespace changed'
            : 'No line changes'
          : `Change ${i + 1} of ${nav.count}`}
        {nav.count > 0 && atLast && nextFile && <span className={styles.muted}> · next file {fileName(nextFile)}</span>}
      </span>
      <div role="group" aria-label="Jump between changes" className={styles.navGroup}>
        <button
          type="button"
          aria-label="Previous change"
          title={prevTitle}
          className={cls(atFirst && !!prevFile)}
          disabled={atFirst && !prevFile}
          onClick={() => onStep(-1)}
        >
          <ChevronUpIcon size={14} />
        </button>
        <button
          type="button"
          aria-label="Next change"
          title={nextTitle}
          className={cls(atLast && !!nextFile)}
          disabled={atLast && !nextFile}
          onClick={() => onStep(1)}
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>
    </>
  );
}

/** Review ⇄ History of one branch: the page menu item and ⌥H (in the diff too). Goes back when
 * the other page is the one just before, so switching to and fro does not grow the history.
 * Listed in lib/shortcuts.ts. */
export function useSwitchTo(route: Route | null): (() => void) | null {
  const key = route ? JSON.stringify(route) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const go = useMemo(() => (route ? () => switchTo(route) : null), [key]);
  useEffect(() => {
    if (!go) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyH') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  return go;
}

function switchTo(route: Route) {
  const nav = useNav.getState();
  const before = nav.stack[nav.index - 1];
  if (before && samePage(before, route)) nav.back();
  else nav.push(route);
}

function samePage(a: Route, b: Route): boolean {
  if (a.name === 'history' && b.name === 'history') return a.repoId === b.repoId && a.rev === b.rev;
  if (a.name === 'review' && b.name === 'review' && a.target.kind === 'branch' && b.target.kind === 'branch') {
    return (
      a.target.repoId === b.target.repoId &&
      a.target.branch === b.target.branch &&
      a.target.worktreePath === b.target.worktreePath &&
      a.target.tipOverride === null
    );
  }
  return false;
}

/** Review and History hide the sidebar (unless opened from it); leaving restores what it was. */
export function useSidebarHiddenWhileMounted(hide: boolean) {
  useEffect(() => {
    if (!hide) return;
    const ui = useUi.getState();
    const before = ui.sidebarVisible;
    ui.setSidebarVisible(false);
    return () => useUi.getState().setSidebarVisible(before);
  }, [hide]);
}

export function FileRow({
  file: f,
  terms,
  on,
  onClick,
  folder,
}: {
  file: FileChange;
  terms: string[];
  on: boolean;
  onClick: () => void;
  /** The folder the file is opened from by the right-click menu; none, no menu. */
  folder: string | null;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  // A deleted file is not on disk.
  const menuFolder = f.kind === 'D' ? null : folder;
  return (
    <>
      <button
        type="button"
        className={on ? `${styles.fileRow} ${styles.selected}` : styles.fileRow}
        aria-current={on || undefined}
        onClick={onClick}
        onContextMenu={
          menuFolder
            ? (ev) => {
                ev.preventDefault();
                setMenu(new DOMRect(ev.clientX, ev.clientY, 0, 0));
              }
            : undefined
        }
        title={f.path}
      >
        <KindBadge kind={f.kind} />
        <span className={styles.fileName}>
          <Highlighted text={basename(f.path)} terms={terms} />
        </span>
        <span className={styles.fileDir}>
          <Highlighted text={dirLabel(f)} terms={terms} />
        </span>
        {!!f.add && <span className={styles.add}>+{f.add}</span>}
        {!!f.del && <span className={styles.del}>−{f.del}</span>}
      </button>
      {menu && menuFolder && (
        <Popover anchorRect={menu} width={220} onClose={() => setMenu(null)}>
          <Menu aria-label={`${basename(f.path)} actions`}>
            <FileOpenItems folder={menuFolder} path={f.path} onDone={() => setMenu(null)} />
          </Menu>
        </Popover>
      )}
    </>
  );
}

/** The first matching term in `text`, tinted. */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const hit = terms.length > 0 ? firstHit(text, terms) : null;
  if (!hit) return <>{text}</>;
  return (
    <>
      {hit[0]}
      <mark className={styles.hit}>{hit[1]}</mark>
      {hit[2]}
    </>
  );
}
