import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../components/Banner';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  RefreshIcon,
  SidebarIcon,
  SplitIcon,
  UnifiedIcon,
} from '../../components/icons';
import { Popover } from '../../components/Popover';
import { IconButton } from '../../components/IconButton';
import { KindBadge } from '../../components/KindBadge';
import { Pill } from '../../components/Pill';
import { RefreshButton } from '../../components/RefreshButton';
import { Segmented } from '../../components/Segmented';
import { entryKey } from '../../lib/entryKey';
import { formatAge } from '../../lib/format';
import { getReview, updateSettings } from '../../lib/ipc';
import { basename, tildifyHome } from '../../lib/paths';
import type {
  DiffLayout,
  DiffMode,
  EntrySummary,
  ReviewData,
  ReviewGroup,
  ReviewTarget,
  Settings,
} from '../../lib/types';
import { useInvoke } from '../../lib/useInvoke';
import { next, prev } from '../../monaco/changeNav';
import { DiffView, type DiffNav, type NavInfo } from '../../monaco/DiffView';
import { useData } from '../../state/data';
import { useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import styles from './Review.module.css';
import {
  compareLabel,
  defaultMode,
  dirLabel,
  EMPTY_MESSAGES,
  resolveSelection,
  type FileRef,
} from './selection';

interface Props {
  target: ReviewTarget;
  backLabel: string;
  /** Project scope: open on this entry, with the other groups collapsed. */
  focusKey?: string;
}

const MODE_LABELS: Record<DiffMode, string> = {
  committed: 'Committed',
  uncommitted: 'Uncommitted',
  all: 'All',
};

export function Review({ target, backLabel, focusKey }: Props) {
  useSidebarHiddenWhileMounted();
  const targetKey = JSON.stringify(target);
  const projects = useData((s) => s.config?.projects);
  const repoIds = useMemo(() => {
    if (target.kind === 'branch') return [target.repoId];
    const project = projects?.find((p) => p.id === target.projectId);
    return [...new Set(project?.entries.map((e) => e.repoId) ?? [])];
  }, [target, projects]);
  const { data, error } = useInvoke(() => getReview(target), [targetKey], { repoIds, onConfig: true });
  const push = useNav((s) => s.push);
  const [chosenMode, setChosenMode] = useState<DiffMode | null>(null);
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = data?.groups ?? [];
  const mode = chosenMode ?? defaultMode(groups);
  const setMode = (m: DiffMode) => {
    setChosenMode(m);
    setSelected(null);
  };
  // Entries with nothing in this mode are hidden.
  const visible = groups.filter((g) => g.files[mode].length > 0);
  const current = resolveSelection(visible, mode, selected);
  const group = visible.find((g) => g.entry.key === current?.key);
  const change = group?.files[mode].find((f) => f.path === current?.path);

  // Jumping between changes (flow D4): files in list order, collapsed groups included.
  const files = visible.flatMap((g) => g.files[mode].map((f) => fileId(g.entry.key, f.path)));
  const currentId = current ? fileId(current.key, current.path) : null;
  const fileIndex = currentId ? files.indexOf(currentId) : -1;
  const [land, setLand] = useState<{ id: string | null; where: 'first' | 'last' }>({ id: null, where: 'first' });
  const [nav, setNav] = useState<NavInfo>({ index: null, count: 0 });
  const diffNav = useRef<DiffNav | null>(null);
  const select = (f: FileRef, where: 'first' | 'last' = 'first') => {
    setSelected(f);
    setLand({ id: fileId(f.key, f.path), where });
  };
  const step = (dir: 1 | -1) => {
    const state = { index: nav.index, count: nav.count, files, fileIndex };
    const r = dir > 0 ? next(state) : prev(state);
    if (r?.kind === 'hunk') diffNav.current?.goTo(r.index);
    if (r?.kind === 'file') {
      const [key, path] = r.key.split('\u0000');
      setCollapsed((c) => {
        const open = new Set(c);
        open.delete(key);
        return open;
      });
      select({ key, path }, r.land);
    }
  };
  // Diff view settings (layout, whitespace), remembered in the config.
  const settings = useData((st) => st.config?.settings);
  const layout = settings?.diffView ?? 'split';
  const ignoreWs = settings?.ignoreWhitespace ?? false;
  const saveView = (patch: Partial<Settings>) => {
    if (settings) void updateSettings({ ...settings, ...patch });
  };
  const toggleLayout = () => saveView({ diffView: layout === 'split' ? 'unified' : 'split' });
  const toggleWs = () => saveView({ ignoreWhitespace: !ignoreWs });
  const viewRef = useRef({ toggleLayout, toggleWs });
  viewRef.current = { toggleLayout, toggleWs };
  // ⌥V / ⌥W outside the diff (inside it Monaco handles them). ⌥ turns letters into other
  // characters, so the physical key is checked. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.code !== 'KeyV' && e.code !== 'KeyW')) return;
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor, input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      if (e.code === 'KeyV') viewRef.current.toggleLayout();
      else viewRef.current.toggleWs();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stepRef = useRef(step);
  stepRef.current = step;
  // ⌥↓ / ⌥↑ outside the diff; inside it Monaco handles them. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor, input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const entry = group?.entry ?? groups[0]?.entry ?? data?.notInReview[0];
  // Base menu, the "saved" banner after a change and the group waiting for its recompute.
  const [baseMenu, setBaseMenu] = useState<{ group: ReviewGroup; rect: DOMRect } | null>(null);
  const [baseSaved, setBaseSaved] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  useEffect(() => setPendingKey(null), [data]);
  const banner = mode === 'uncommitted' ? uncommittedBanner(target, groups) : null;

  // Coming from a project row: open that entry, collapse the others (once).
  const focused = useRef(false);
  useEffect(() => {
    if (!data || focused.current || !focusKey) return;
    focused.current = true;
    const g = data.groups.find((x) => x.entry.key === focusKey);
    if (!g) return;
    setCollapsed(new Set(data.groups.filter((x) => x !== g).map((x) => x.entry.key)));
    const m = chosenMode ?? defaultMode(data.groups);
    const first = g.files[m][0] ?? g.files.all[0];
    if (first) setSelected({ key: g.entry.key, path: first.path });
  }, [data, focusKey, chosenMode]);

  const counts = (m: DiffMode) => groups.reduce((n, g) => n + g.files[m].length, 0);
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className={styles.screen}>
      <ReviewHeader entry={entry} target={target} backLabel={backLabel} data={data}>
        <Segmented
          aria-label="Diff layer"
          value={mode}
          onChange={setMode}
          options={(['committed', 'uncommitted', 'all'] as const).map((m) => ({
            value: m,
            label: MODE_LABELS[m],
            count: data ? counts(m) : undefined,
          }))}
        />
        <RefreshButton />
      </ReviewHeader>
      {banner ? (
        <Banner tone="warning">{banner}</Banner>
      ) : (
        baseSaved && <Banner tone="neutral">{baseSaved}</Banner>
      )}

      <div className={styles.body}>
        <aside className={styles.files}>
          {visible.map((g) => (
            <FileGroup
              key={g.entry.key}
              group={g}
              mode={mode}
              open={!collapsed.has(g.entry.key)}
              onToggle={() => toggle(g.entry.key)}
              selected={current}
              onSelect={(f) => select(f)}
              pending={pendingKey === g.entry.key}
              onBase={(rect) => setBaseMenu({ group: g, rect })}
            />
          ))}
          {target.kind === 'project' && data && data.notInReview.length > 0 && (
            <div className={styles.notInReview}>
              {data.notInReview.length} {data.notInReview.length === 1 ? 'entry' : 'entries'} not reviewable ·{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => push({ name: 'project', projectId: target.projectId })}
              >
                Open project
              </button>
            </div>
          )}
        </aside>

        <section className={styles.main}>
          {error ? (
            <div className={styles.empty}>{error.message}</div>
          ) : !data ? null : groups.length === 0 ? (
            <div className={styles.empty}>
              {target.kind === 'branch' ? notReviewable(entry) : EMPTY_MESSAGES[mode]}
            </div>
          ) : group && change ? (
            <>
              <EntryBar group={group} mode={mode} />
              <div className={styles.fileBar}>
                <span className={styles.filePath}>{change.path}</span>
                <span className={styles.muted}>{compareLabel(mode, group.entry)}</span>
                {ignoreWs && (
                  <button
                    type="button"
                    className={styles.wsChip}
                    title="Show whitespace changes (⌥W)"
                    onClick={toggleWs}
                  >
                    Whitespace ignored
                  </button>
                )}
                <span className={styles.grow} />
                <ViewMenu
                  layout={layout}
                  ignoreWs={ignoreWs}
                  onLayout={(l) => saveView({ diffView: l })}
                  onToggleWs={toggleWs}
                />
                <span className={styles.barDivider} />
                <ChangeNav
                  onlyWhitespace={
                    ignoreWs && !change.binary && (change.add ?? 0) + (change.del ?? 0) > 0
                  }
                  nav={nav}
                  prevFile={files[fileIndex - 1]}
                  nextFile={files[fileIndex + 1]}
                  onStep={step}
                />
              </div>
              <DiffView
                repoId={group.entry.repoId}
                worktreePath={group.entry.worktreePath}
                change={change}
                mode={mode}
                fileKey={`${currentId}\u0000${mode}`}
                land={land.id === currentId ? land.where : 'first'}
                onNav={setNav}
                onStep={(dir) => stepRef.current(dir)}
                navRef={diffNav}
                layout={layout}
                ignoreWhitespace={ignoreWs}
                onToggleLayout={() => viewRef.current.toggleLayout()}
                onToggleWhitespace={() => viewRef.current.toggleWs()}
              />
            </>
          ) : (
            <div className={styles.empty}>{EMPTY_MESSAGES[mode]}</div>
          )}
        </section>
      </div>
      {baseMenu && (
        <BaseMenu
          repoId={baseMenu.group.entry.repoId}
          entryKey={baseMenu.group.entry.key}
          branchName={baseMenu.group.entry.branch ?? baseMenu.group.entry.shortSha ?? ''}
          anchorRect={baseMenu.rect}
          onClose={() => setBaseMenu(null)}
          onChosen={(base) => {
            const e = baseMenu.group.entry;
            if (base !== e.base) setPendingKey(e.key);
            setBaseSaved(
              `Base for ${e.branch ?? e.shortSha} set to ${base}. Saved for this branch; Branches and projects use it too.`,
            );
          }}
        />
      )}
    </div>
  );
}

function fileId(entryKey: string, path: string): string {
  return `${entryKey}\u0000${path}`;
}

const fileName = (id: string | undefined) => (id ? basename(id.split('\u0000')[1]) : '');

/** "Change 2 of 3" and ↑ ↓; past a file's first/last change they continue into the neighbour. */
/** Layout (Split / Unified) and Ignore whitespace; applies to every diff and is remembered. */
function ViewMenu({
  layout,
  ignoreWs,
  onLayout,
  onToggleWs,
}: {
  layout: DiffLayout;
  ignoreWs: boolean;
  onLayout: (l: DiffLayout) => void;
  onToggleWs: () => void;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const radio = (value: DiffLayout, label: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={layout === value}
      className={layout === value ? `${styles.viewRow} ${styles.viewRowOn}` : styles.viewRow}
      onClick={() => {
        onLayout(value);
        setAt(null);
      }}
    >
      <span className={layout === value ? styles.viewCheck : `${styles.viewCheck} ${styles.hidden}`}>
        <CheckIcon />
      </span>
      <span className={styles.grow}>{label}</span>
      <span className={styles.viewKey}>⌥V</span>
    </button>
  );
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
        <Popover anchorRect={at} width={290} alignRight onClose={() => setAt(null)}>
          <div role="menu" aria-label="Diff view" className={styles.viewMenu}>
            <div className={styles.viewTitle}>Layout</div>
            {radio('split', 'Split')}
            {radio('unified', 'Unified')}
            <div className={styles.viewDivider} />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={ignoreWs}
              className={`${styles.viewRow} ${styles.viewRowTop}`}
              onClick={onToggleWs}
            >
              <span className={ignoreWs ? `${styles.viewBox} ${styles.viewBoxOn}` : styles.viewBox}>
                <CheckIcon />
              </span>
              <span className={styles.viewText}>
                <span>Ignore whitespace</span>
                <span className={styles.viewHint}>Hide lines where only indentation or trailing spaces changed</span>
              </span>
              <span className={`${styles.viewKey} ${styles.viewKeyTop}`}>⌥W</span>
            </button>
            <div className={styles.viewFoot}>Applies to every diff and is remembered.</div>
          </div>
        </Popover>
      )}
    </>
  );
}

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
      ? `Previous file: ${fileName(prevFile)} (⌥↑)`
      : 'First change'
    : 'Previous change (⌥↑)';
  const nextTitle = atLast
    ? nextFile
      ? `Next file: ${fileName(nextFile)} (⌥↓)`
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

/** Review hides the sidebar; leaving restores what it was. */
function useSidebarHiddenWhileMounted() {
  useEffect(() => {
    const ui = useUi.getState();
    const before = ui.sidebarVisible;
    ui.setSidebarVisible(false);
    return () => useUi.getState().setSidebarVisible(before);
  }, []);
}

function ReviewHeader({
  entry,
  target,
  backLabel,
  data,
  children,
}: {
  entry: EntrySummary | undefined;
  target: ReviewTarget;
  backLabel: string;
  data: ReviewData | undefined;
  children: React.ReactNode;
}) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const setSidebarVisible = useUi((s) => s.setSidebarVisible);
  const back = useNav((s) => s.back);
  const config = useData((s) => s.config);

  let title = '';
  let subtitle = '';
  if (target.kind === 'branch') {
    title = target.branch ?? entry?.shortSha ?? '';
    const key = entryKey(target);
    const project = config?.projects.find((p) => p.entries.some((e) => entryKey(e) === key));
    const repo = entry?.repoName ?? '';
    subtitle = target.tipOverride
      ? `${repo} · last known state`
      : project
        ? `${repo} · in ${project.name}`
        : `${repo} · not in a project`;
  } else {
    title = config?.projects.find((p) => p.id === target.projectId)?.name ?? '';
    if (data) {
      const changed = data.groups.filter((g) => g.files.committed.length + g.files.uncommitted.length + g.files.all.length > 0).length;
      subtitle = `Project review · ${changed} of ${data.totalEntries} entries have changes`;
    }
  }

  return (
    <header className={styles.header} data-tauri-drag-region>
      <div className={styles.chrome} data-tauri-drag-region>
        {!sidebarVisible && (
          <>
            <div className={styles.lights} data-tauri-drag-region />
            <IconButton aria-label="Show sidebar" onClick={() => setSidebarVisible(true)}>
              <SidebarIcon />
            </IconButton>
          </>
        )}
        <IconButton aria-label={backLabel} onClick={back} className={styles.back}>
          <BackIcon />
        </IconButton>
      </div>
      <div className={styles.titles} data-tauri-drag-region>
        <span className={styles.title} data-tauri-drag-region>
          {title}
        </span>
        <span className={styles.subtitle} data-tauri-drag-region>
          {subtitle}
        </span>
      </div>
      <div className={styles.grow} data-tauri-drag-region />
      {children}
    </header>
  );
}

function FileGroup({
  group: g,
  mode,
  open,
  onToggle,
  selected,
  onSelect,
  pending,
  onBase,
}: {
  group: ReviewGroup;
  mode: DiffMode;
  open: boolean;
  onToggle: () => void;
  selected: FileRef | null;
  onSelect: (f: FileRef) => void;
  pending: boolean;
  onBase: (rect: DOMRect) => void;
}) {
  const files = g.files[mode];
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  const e = g.entry;
  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <div className={styles.groupLine}>
          <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
            <ChevronDownIcon className={open ? styles.chevron : `${styles.chevron} ${styles.closed}`} />
            <span className={styles.repoName}>{e.repoName}</span>
          </button>
          {pending && <RefreshIcon size={11} className={styles.pending} />}
          <button
            type="button"
            aria-haspopup="listbox"
            className={e.baseIsCustom ? `${styles.baseButton} ${styles.baseCustom}` : styles.baseButton}
            onClick={(ev) => onBase(ev.currentTarget.getBoundingClientRect())}
          >
            <span className={styles.muted}>base</span> {e.base ?? 'none'}
            <ChevronDownIcon size={9} />
          </button>
        </div>
        <div className={styles.groupLine2}>
          <span className={styles.branch}>{e.branch ?? e.shortSha}</span>
          <span className={styles.add}>+{add}</span>
          {del > 0 && <span className={styles.del}>−{del}</span>}
        </div>
      </div>
      {g.stackHint && (
        <div className={styles.stackHint}>
          {g.stackHint.contains} of {g.stackHint.total} commits come from {g.stackHint.branch}. A
          different base may fit better.
        </div>
      )}
      {open && (
        <div className={styles.fileRows}>
          {files.map((f) => {
            const on = selected?.key === e.key && selected.path === f.path;
            return (
              <button
                key={f.path}
                type="button"
                className={on ? `${styles.fileRow} ${styles.selected}` : styles.fileRow}
                onClick={() => onSelect({ key: e.key, path: f.path })}
                title={f.path}
              >
                <KindBadge kind={f.kind} />
                <span className={styles.fileName}>{basename(f.path)}</span>
                <span className={styles.fileDir}>{dirLabel(f)}</span>
                {!!f.add && <span className={styles.add}>+{f.add}</span>}
                {!!f.del && <span className={styles.del}>−{f.del}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EntryBar({ group: g, mode }: { group: ReviewGroup; mode: DiffMode }) {
  const e = g.entry;
  const name = e.branch ?? e.shortSha ?? '';
  const ahead = e.ahead ?? g.commits.length;
  // Without a base (a base branch with no upstream) there is only the working tree.
  const workingTree = mode === 'uncommitted' || !e.base;
  return (
    <div className={styles.entryBar}>
      <div className={styles.entryLine}>
        <button
          type="button"
          className={`${styles.repoName} ${styles.repoLink}`}
          title={`Show ${e.repoName} on Branches`}
          onClick={() => useNav.getState().push({ name: 'branches', focusRepoId: e.repoId })}
        >
          {e.repoName}
        </button>
        <span className={styles.entryBranch}>{name}</span>
        <span className={styles.entryRange}>
          {workingTree && e.worktreePath ? `working tree ${tildifyHome(e.worktreePath)}` : `${e.base}..${name}`}
        </span>
        <span className={styles.grow} />
        <span className={styles.muted}>
          {workingTree ? 'HEAD ↔ working tree' : `${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead of ${e.base}`}
        </span>
      </div>
      {!workingTree && g.commits.length > 0 && (
        <div className={styles.commits}>
          {g.commits.map((c) => (
            <div key={c.sha} className={c.fromBranch ? `${styles.commit} ${styles.foreign}` : styles.commit}>
              <span className={styles.sha}>{c.shortSha}</span>
              <span className={styles.subject}>{c.subject}</span>
              {c.fromBranch && (
                <Pill tone="warning" className={styles.fromPill}>
                  {c.fromBranch}
                </Pill>
              )}
              <span className={styles.age}>{formatAge(c.committedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which working trees the Uncommitted layer shows. */
function uncommittedBanner(target: ReviewTarget, groups: ReviewGroup[]): string | null {
  if (target.kind === 'branch') {
    const wt = groups[0]?.entry.worktreePath;
    return wt ? `Working tree at ${tildifyHome(wt)}` : null;
  }
  const n = groups.filter((g) => g.entry.worktreePath).length;
  return `Uncommitted changes across ${n} checked-out ${n === 1 ? 'entry' : 'entries'}`;
}

function notReviewable(entry: EntrySummary | undefined): string {
  if (!entry) return '';
  switch (entry.state) {
    case 'branch_deleted':
      return 'This branch no longer exists';
    case 'repo_missing':
      return 'Repository not found';
    case 'base_missing':
      return entry.error ? `Base missing: ${entry.error}` : 'Base missing';
    default:
      return entry.error ?? 'Nothing to review';
  }
}

