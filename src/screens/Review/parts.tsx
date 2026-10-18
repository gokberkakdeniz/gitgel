// Parts of Review's diff pane (SPEC §5, §16): the file bar with its view menu
// and change navigation, file rows, the stash section, and the remembered diff view settings with
// their ⌥ keys.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, Icon, SplitIcon, UnifiedIcon } from '../../components/icons';
import { KindBadge } from '../../components/KindBadge';
import { Menu, MenuDivider, MenuItem, MenuLabel, MenuSegmented } from '../../components/Menu';
import { FileOpenItems } from '../../components/OpenItems';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { Stepper } from '../../components/Stepper';
import { formatCount, validTabSize } from '../../lib/format';
import { t } from '../../i18n';
import { updateSettings } from '../../lib/ipc';
import { basename } from '../../lib/paths';
import type { DiffContext, DiffLayout, FileChange, Settings, StashChanges } from '../../lib/types';
import type { NavInfo } from '../../monaco/DiffView';
import { diffPosition } from '../../monaco/position';
import { useData } from '../../state/data';
import { useUi } from '../../state/ui';
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
  const tabSize = validTabSize(settings?.diffTabSize ?? 4);
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
  return { layout, ignoreWs, context, contextLines, tabSize, saveView, toggleWs, viewRef };
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
        <Pill tone="accent" title={t('review.showWs')} onClick={toggleWs}>
          {t('review.wsIgnored')}
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
      {add !== undefined && <span className={styles.add}>+{formatCount(add)}</span>}
      {del !== undefined && <span className={styles.del}>−{formatCount(del)}</span>}
    </>
  );
}

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
        title={t('review.diffView')}
        className={at ? `${styles.viewButton} ${styles.viewButtonOpen}` : styles.viewButton}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        {layout === 'split' ? <SplitIcon /> : <UnifiedIcon />}
        <span>{layout === 'split' ? t('review.split') : t('review.unified')}</span>
        <ChevronDownIcon size={9} />
      </button>
      {at && (
        <Popover anchorRect={at} width={300} alignRight onClose={() => setAt(null)}>
          <Menu aria-label={t('review.diffView')}>
            <MenuLabel>{t('review.layout')}</MenuLabel>
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
                {l === 'split' ? t('review.split') : t('review.unified')}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuLabel>{t('review.context')}</MenuLabel>
            <MenuItem checked={context === 'changes'} kbd="⌥C" onSelect={() => onContext('changes', contextLines)}>
              {t('review.changesOnly')}
            </MenuItem>
            <MenuSegmented
              label={t('review.linesAround')}
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
              {t('review.wholeFile')}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              box={ignoreWs}
              desc={t('review.wsDesc')}
              kbd="⌥W"
              onSelect={onToggleWs}
            >
              {t('review.ignoreWs')}
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
      ? t('review.prevFirst')
      : t('review.firstChange')
    : t('review.prevChange');
  const nextTitle = atLast
    ? nextFile
      ? t('review.nextFirst')
      : t('review.lastChange')
    : t('review.nextChange');
  return (
    <>
      <span aria-live="polite" className={styles.navLabel}>
        {nav.count === 0
          ? onlyWhitespace
            ? t('review.onlyWs')
            : t('review.noLineChanges')
          : t('review.changeOf', { i: formatCount(i + 1), n: formatCount(nav.count) })}
      </span>
      <Stepper
        aria-label={t('review.jumpChanges')}
        up={{ 'aria-label': t('review.prevChangeBtn'), title: prevTitle, disabled: atFirst && !prevFile, cross: atFirst && !!prevFile }}
        down={{ 'aria-label': t('review.nextChangeBtn'), title: nextTitle, disabled: atLast && !nextFile, cross: atLast && !!nextFile }}
        onStep={onStep}
      />
    </>
  );
}

/** What Uncommitted's right-click menu does (Hi8, D12). */
export interface FileActions {
  /** The files it acts on: the picked ones when this row is one of them, else this one. Each
   * with its worktree: a project review's picks can span repositories with the same paths. */
  files: { file: FileChange; folder: string | null }[];
  onDiscard: () => void;
  /** Uncommitted's sections, with several files: Stage / Unstage Selected Files, whichever the
   * picked rows allow. */
  onStage?: { stage?: () => void; unstage?: () => void };
}

export function FileRow({
  file: f,
  on,
  picked,
  onClick,
  folder,
  stage,
  actions,
  conflict,
}: {
  file: FileChange;
  on: boolean;
  /** Picked with ⌘ / ⇧-click: tinted. */
  picked?: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** The folder the file is opened from by the right-click menu; none, no open items. */
  folder: string | null;
  /** Uncommitted's sections (SPEC §5 "Uncommitted sections"): on hover, Discard and + (stage) or
   * − (unstage) open left of the counts, which stay last. */
  stage?: { glyph: '+' | '−'; label: string; disabled: boolean; onClick: () => void; discard?: { label: string; onClick: () => void } };
  /** Uncommitted's files: the menu discards and copies too, deleted files included. */
  actions?: FileActions;
  /** A conflicted file of an operation in progress (T2): ⚠ while it has git's markers, ✓ once
   * they are gone, in place of the counts. */
  conflict?: 'unresolved' | 'resolved';
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const counts =
    conflict === 'unresolved' ? (
      <span className={styles.conflictMark} title={t('review.hasConflicts')} role="img" aria-label={t('review.hasConflicts')}>
        <Icon name="warning" size={14} />
      </span>
    ) : conflict === 'resolved' ? (
      <span className={styles.resolvedMark} title={t('review.conflictsResolved')} role="img" aria-label={t('review.conflictsResolved')}>
        <Icon name="check" size={14} />
      </span>
    ) : (
      <DiffStat add={f.add || undefined} del={f.del || undefined} />
    );
  // A deleted file is not on disk.
  const menuFolder = f.kind === 'D' ? null : folder;
  const hasMenu = !!actions || !!menuFolder;
  const state = picked ? styles.picked : on ? styles.selected : menu ? styles.menuOpen : '';
  const button = (
      <button
        type="button"
        className={stage ? styles.fileRowBare : `${styles.fileRow} ${state}`}
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
        <span className={styles.fileName}>{basename(f.path)}</span>
        <span className={styles.fileDir}>{dirLabel(f)}</span>
        {!stage && counts}
      </button>
  );
  return (
    <>
      {stage ? (
        <div className={`${styles.stagedRow} ${state}`}>
          {button}
          <span className={styles.rowActs}>
            {stage.discard && (
              <button
                type="button"
                className={styles.rowAct}
                aria-label={stage.discard.label}
                title={stage.discard.label}
                onClick={stage.discard.onClick}
              >
                <Icon name="undo" size={14} />
              </button>
            )}
            <button
              type="button"
              className={styles.rowAct}
              aria-label={stage.label}
              title={stage.label}
              disabled={stage.disabled}
              onClick={stage.onClick}
            >
              <Icon name={stage.glyph === '+' ? 'plus' : 'minus'} size={14} />
            </button>
          </span>
          {/* The counts stay last, like VS Code's status letter; a click picks the row too. */}
          <span className={styles.rowCounts} onClick={onClick}>
            {counts}
          </span>
        </div>
      ) : (
        button
      )}
      {menu && hasMenu && (
        <Popover anchorRect={menu} width={actions ? 230 : 220} onClose={() => setMenu(null)}>
          <Menu aria-label={actions && actions.files.length > 1 ? t('review.filesActions', { n: formatCount(actions.files.length) }) : t('review.fileActions', { file: basename(f.path) })}>
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

/** Uncommitted's file menu (Hi8, D12; GitHub Desktop's texts): Discard, Include / Exclude (Review,
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
  const { files, onDiscard, onStage } = actions;
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
        {one ? t('review.discardOne') : t('review.discardN', { n: String(files.length) })}
      </MenuItem>
      {!one && (onStage?.stage || onStage?.unstage) && (
        <>
          <MenuDivider />
          {onStage.stage && (
            <MenuItem
              icon="plus"
              onSelect={() => {
                onDone();
                onStage.stage?.();
              }}
            >
              {t('review.stageSel')}
            </MenuItem>
          )}
          {onStage.unstage && (
            <MenuItem
              icon="remove"
              onSelect={() => {
                onDone();
                onStage.unstage?.();
              }}
            >
              {t('review.unstageSel')}
            </MenuItem>
          )}
        </>
      )}
      <MenuDivider />
      {absolute && (
        <MenuItem icon="copy" onSelect={() => copy(absolute)}>
          {one ? t('review.copyFile') : t('review.copyPaths')}
        </MenuItem>
      )}
      <MenuItem icon="copy" onSelect={() => copy(relative)}>
        {one ? t('review.copyRelFile') : t('review.copyRelPaths')}
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
  fold,
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
  /** The heading folds the section (Review's list column, SPEC §5). */
  fold?: { open: boolean; onToggle: () => void };
}) {
  const repos = useData((s) => s.config?.repos);
  return (
    <section aria-label={t('branches.stashes')} className={divider ? `${styles.stashes} ${styles.stashesRuled}` : styles.stashes}>
      {fold ? (
        <button type="button" className={`${styles.stashHeading} ${styles.stashFold}`} aria-expanded={fold.open} onClick={fold.onToggle}>
          <ChevronDownIcon size={12} className={fold.open ? styles.sectionChevron : `${styles.sectionChevron} ${styles.sectionShut}`} />
          {heading} · {formatCount(stashes.length)}
        </button>
      ) : (
        <div className={styles.stashHeading}>
          {heading} · {formatCount(stashes.length)}
        </div>
      )}
      {(!fold || fold.open) && stashes.map((st) => {
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
