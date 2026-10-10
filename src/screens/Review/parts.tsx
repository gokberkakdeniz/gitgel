// Parts of the diff pane shared by Review and History (SPEC §16): the file bar with its view menu
// and change navigation, file rows, the stash section, and the remembered diff view settings with
// their ⌥ keys.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { ChevronDownIcon, Icon, SplitIcon, UnifiedIcon } from '../../components/icons';
import { KindBadge } from '../../components/KindBadge';
import { Menu, MenuDivider, MenuItem, MenuLabel, MenuSegmented } from '../../components/Menu';
import { FileOpenItems } from '../../components/OpenItems';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { Stepper } from '../../components/Stepper';
import { updateSettings } from '../../lib/ipc';
import { basename } from '../../lib/paths';
import { isTextField } from '../../lib/shortcuts';
import type { DiffContext, DiffLayout, FileChange, Settings, StashChanges } from '../../lib/types';
import type { NavInfo } from '../../monaco/DiffView';
import { diffPosition } from '../../monaco/position';
import { useData } from '../../state/data';
import { useNav, type Route } from '../../state/nav';
import { useUi } from '../../state/ui';
import { firstHit } from './fileFilter';
import styles from './parts.module.css';
import { dirLabel } from './selection';
import { stashMeta, type ReviewStash } from './stashes';

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

export type DiffViewSettings = ReturnType<typeof useDiffView>;

/** Above the diff: the file, what it compares, the whitespace pill, the view menu and ↑ ↓. */
export function FileBar({
  file,
  label,
  view,
  nav,
  prevFile,
  nextFile,
  onStep,
}: {
  file: FileChange;
  /** What is compared: "a41c9e2 ↔ 7f3b2d1", "HEAD ↔ working tree". */
  label: string;
  view: DiffViewSettings;
  nav: NavInfo;
  prevFile: string | undefined;
  nextFile: string | undefined;
  onStep: (dir: 1 | -1) => void;
}) {
  const { layout, ignoreWs, context, contextLines, saveView, toggleWs } = view;
  return (
    <div className={styles.fileBar}>
      <span className={styles.filePath}>{file.path}</span>
      <span className={styles.muted}>{label}</span>
      {ignoreWs && (
        <Pill tone="accent" title="Show whitespace changes (⌥W)" onClick={toggleWs}>
          Whitespace ignored
        </Pill>
      )}
      <span className={styles.grow} />
      <ViewMenu
        layout={layout}
        ignoreWs={ignoreWs}
        onLayout={(l) => saveView({ diffView: l })}
        context={context}
        contextLines={contextLines}
        onContext={(c, lines) => saveView({ diffContext: c, diffContextLines: lines })}
        onToggleWs={toggleWs}
      />
      <span className={styles.barDivider} />
      <ChangeNav
        onlyWhitespace={ignoreWs && !file.binary && (file.add ?? 0) + (file.del ?? 0) > 0}
        nav={nav}
        prevFile={prevFile}
        nextFile={nextFile}
        onStep={onStep}
      />
    </div>
  );
}

/** "+12 −3": each part only when given. */
export function DiffStat({ add, del }: { add?: number; del?: number }) {
  return (
    <>
      {add !== undefined && <span className={styles.add}>+{add}</span>}
      {del !== undefined && <span className={styles.del}>−{del}</span>}
    </>
  );
}

const fileName = (id: string | undefined) => (id ? basename(id.split('\u0000')[1]) : '');

/** Layout, context and Ignore whitespace; applies to every diff and is remembered. */
function ViewMenu({
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
function ChangeNav({
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
      <Stepper
        aria-label="Jump between changes"
        up={{ 'aria-label': 'Previous change', title: prevTitle, disabled: atFirst && !prevFile, cross: atFirst && !!prevFile }}
        down={{ 'aria-label': 'Next change', title: nextTitle, disabled: atLast && !nextFile, cross: atLast && !!nextFile }}
        onStep={onStep}
      />
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
      if (isTextField(e.target)) return;
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

/** What Uncommitted's right-click menu does (Hi8, D12). */
export interface FileActions {
  /** The files it acts on: the picked ones when this row is one of them, else this one. Each
   * with its worktree: a project review's picks can span repositories with the same paths. */
  files: { file: FileChange; folder: string | null }[];
  onDiscard: () => void;
  /** History's boxes: Include / Exclude Selected Files, with several files. */
  onInclude?: (on: boolean) => void;
}

export function FileRow({
  file: f,
  terms,
  on,
  picked,
  onClick,
  folder,
  check,
  actions,
  conflict,
}: {
  file: FileChange;
  terms: string[];
  on: boolean;
  /** Picked with ⌘ / ⇧-click: tinted. */
  picked?: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** The folder the file is opened from by the right-click menu; none, no open items. */
  folder: string | null;
  /** A box before the row: the file goes into the commit (History's Uncommitted, W1a). */
  check?: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void };
  /** Uncommitted's files: the menu discards and copies too, deleted files included. */
  actions?: FileActions;
  /** A conflicted file of an operation in progress (T2): ⚠ while it has git's markers, ✓ once
   * they are gone, in place of the counts. */
  conflict?: 'unresolved' | 'resolved';
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  // A deleted file is not on disk.
  const menuFolder = f.kind === 'D' ? null : folder;
  const hasMenu = !!actions || !!menuFolder;
  const state = picked ? styles.picked : on ? styles.selected : menu ? styles.menuOpen : '';
  const button = (
      <button
        type="button"
        className={check ? styles.fileRowBare : `${styles.fileRow} ${state}`}
        aria-current={on || undefined}
        onClick={onClick}
        onContextMenu={
          hasMenu
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
        {conflict === 'unresolved' ? (
          <span className={styles.conflictMark} title="Has conflicts" role="img" aria-label="Has conflicts">
            <Icon name="warning" size={14} />
          </span>
        ) : conflict === 'resolved' ? (
          <span className={styles.resolvedMark} title="Conflicts resolved" role="img" aria-label="Conflicts resolved">
            <Icon name="check" size={14} />
          </span>
        ) : (
          <DiffStat add={f.add || undefined} del={f.del || undefined} />
        )}
      </button>
  );
  return (
    <>
      {check ? (
        <div className={`${styles.boxedRow} ${state}`}>
          <Checkbox
            checked={check.checked}
            disabled={check.disabled}
            aria-label={`Include ${basename(f.path)}`}
            onChange={(e) => check.onChange(e.target.checked)}
          />
          {button}
        </div>
      ) : (
        button
      )}
      {menu && hasMenu && (
        <Popover anchorRect={menu} width={actions ? 230 : 220} onClose={() => setMenu(null)}>
          <Menu aria-label={actions && actions.files.length > 1 ? `${actions.files.length} files actions` : `${basename(f.path)} actions`}>
            {actions ? (
              <UncommittedItems
                actions={actions}
                at={() => (on ? diffPosition(f.path) : null)}
                onDone={() => setMenu(null)}
              />
            ) : (
              menuFolder && (
                <FileOpenItems
                  files={[{ folder: menuFolder, path: f.path }]}
                  at={() => (on ? diffPosition(f.path) : null)}
                  onDone={() => setMenu(null)}
                />
              )
            )}
          </Menu>
        </Popover>
      )}
    </>
  );
}

/** Uncommitted's file menu (Hi8, D12; GitHub Desktop's texts): Discard, Include / Exclude (History,
 * several files), the paths, then the open items for the files still on disk. */
function UncommittedItems({
  actions,
  at,
  onDone,
}: {
  actions: FileActions;
  at: () => { line: number; column: number } | null;
  onDone: () => void;
}) {
  const { files, onDiscard, onInclude } = actions;
  const one = files.length === 1;
  const relative = files.map((x) => x.file.path);
  const absolute = files.every((x) => x.folder) ? files.map((x) => `${x.folder}/${x.file.path}`) : null;
  const onDisk = files.flatMap((x) => (x.folder && x.file.kind !== 'D' ? [{ folder: x.folder, path: x.file.path }] : []));
  const copy = (paths: string[]) => {
    onDone();
    void writeText(paths.join('\n'));
  };
  return (
    <>
      <MenuItem
        danger
        onSelect={() => {
          onDone();
          onDiscard();
        }}
      >
        {one ? 'Discard Changes…' : `Discard ${files.length} Selected Changes…`}
      </MenuItem>
      {!one && onInclude && (
        <>
          <MenuDivider />
          <MenuItem
            icon="check"
            onSelect={() => {
              onDone();
              onInclude(true);
            }}
          >
            Include Selected Files
          </MenuItem>
          <MenuItem
            icon="close"
            onSelect={() => {
              onDone();
              onInclude(false);
            }}
          >
            Exclude Selected Files
          </MenuItem>
        </>
      )}
      <MenuDivider />
      {absolute && (
        <MenuItem icon="copy" onSelect={() => copy(absolute)}>
          {one ? 'Copy File Path' : 'Copy Paths'}
        </MenuItem>
      )}
      <MenuItem icon="copy" onSelect={() => copy(relative)}>
        {one ? 'Copy Relative File Path' : 'Copy Relative Paths'}
      </MenuItem>
      {onDisk.length > 0 && (
        <>
          <MenuDivider />
          <FileOpenItems files={onDisk} at={at} onDone={onDone} />
        </>
      )}
    </>
  );
}

/** The stash section under the files (flows P2–P3); the picked stash lists its files. */
export function StashSection({
  heading,
  stashes,
  picked,
  changes,
  file,
  divider,
  withRepo = divider,
  onPick,
  onFile,
}: {
  heading: string;
  stashes: ReviewStash[];
  picked: string | undefined;
  /** The picked stash's files, once loaded. */
  changes: StashChanges | undefined;
  /** The file shown. */
  file: string | undefined;
  /** A rule above it, under the entries. */
  divider: boolean;
  /** `repo / branch` on line 2 (default: with the rule; stash scope names the repo in its header). */
  withRepo?: boolean;
  onPick: (sha: string) => void;
  onFile: (path: string) => void;
}) {
  const repos = useData((s) => s.config?.repos);
  return (
    <section aria-label="Stashes" className={divider ? `${styles.stashes} ${styles.stashesRuled}` : styles.stashes}>
      <div className={styles.stashHeading}>
        {heading} · {stashes.length}
      </div>
      {stashes.map((st) => {
        const on = st.sha === picked;
        return (
          <div key={`${st.repoId}:${st.sha}`} className={styles.stash}>
            <button
              type="button"
              className={on ? `${styles.stashRow} ${styles.stashOn}` : styles.stashRow}
              aria-expanded={on}
              title={st.message}
              onClick={() => onPick(st.sha)}
            >
              <span className={styles.stashLine}>
                <Icon name="package" size={13} strokeWidth={1.6} className={styles.stashIcon} />
                <span className={styles.stashMessage}>{st.message}</span>
                <span className={styles.stashRef}>stash@{`{${st.index}}`}</span>
              </span>
              <span className={styles.stashMeta}>{stashMeta(st, withRepo)}</span>
            </button>
            {on && changes && (
              <div className={styles.fileRows}>
                {changes.files.map((f) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    folder={repos?.find((r) => r.id === st.repoId)?.path ?? null}
                    terms={[]}
                    on={f.path === file}
                    onClick={() => onFile(f.path)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The first matching term in `text`, tinted. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
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
