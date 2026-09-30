import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../components/Banner';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ChevronUpIcon,
  PencilIcon,
  RefreshIcon,
  SearchIcon,
  SidebarIcon,
  SplitIcon,
  UnifiedIcon,
} from '../../components/icons';
import { Popover } from '../../components/Popover';
import { ProjectNameInput } from '../../components/ProjectNameInput';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { KindBadge } from '../../components/KindBadge';
import { Pill } from '../../components/Pill';
import { RefreshButton } from '../../components/RefreshButton';
import { Segmented } from '../../components/Segmented';
import { entryKey } from '../../lib/entryKey';
import { formatAge } from '../../lib/format';
import { getCommitChanges, getReview, updateSettings } from '../../lib/ipc';
import { basename, tildifyHome } from '../../lib/paths';
import type {
  CommitChanges,
  CommitInfo,
  FileChange,
  DiffContext,
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
import { fileMatches, filterTerms, firstHit } from './fileFilter';
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
  /** Opened from the sidebar: leave it shown. */
  keepSidebar?: boolean;
}

const MODE_LABELS: Record<DiffMode, string> = {
  committed: 'Committed',
  uncommitted: 'Uncommitted',
  all: 'All',
};

export function Review({ target, backLabel, focusKey, keepSidebar }: Props) {
  useSidebarHiddenWhileMounted(!keepSidebar);
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

  // One commit at a time (flow D7): the commit picked per entry, for this visit only. Not in
  // Uncommitted; in All the commit alone is shown.
  const [commitSel, setCommitSel] = useState<Record<string, string>>({});
  const [commitData, setCommitData] = useState<Record<string, CommitChanges>>({});
  const commitScoped = mode !== 'uncommitted';
  const shaOf = (g: ReviewGroup) => (commitScoped ? commitSel[g.entry.key] : undefined);
  const commitOf = (g: ReviewGroup) => {
    const sha = shaOf(g);
    return sha ? commitData[commitId(g.entry.repoId, sha)] : undefined;
  };
  // The groups as listed: an entry scoped to a commit lists that commit's files.
  const viewGroups = groups.map((g) => {
    const c = commitOf(g);
    return c ? { ...g, files: { ...g.files, [mode]: c.files } } : g;
  });

  const setMode = (m: DiffMode) => {
    setChosenMode(m);
    setSelected(null);
    if (m === 'uncommitted') setCommitSel({});
  };
  // Entries with nothing in this mode are hidden, except the one group of a branch review: its
  // header holds the base button, the way out of a base that leaves nothing to show.
  const visible = viewGroups.filter((g) => g.files[mode].length > 0 || !!shaOf(g) || target.kind === 'branch');
  const current = resolveSelection(visible, mode, selected);
  const group = visible.find((g) => g.entry.key === current?.key);
  const change = group?.files[mode].find((f) => f.path === current?.path);

  // File filter (flow D8): narrows the list and change navigation, never the selection or counts.
  const [fileQuery, setFileQuery] = useState('');
  const terms = filterTerms(fileQuery);
  const filtering = terms.length > 0;
  const shownOf = (g: ReviewGroup) => (filtering ? g.files[mode].filter((f) => fileMatches(f, terms)) : g.files[mode]);
  const listed = filtering ? visible.filter((g) => shownOf(g).length > 0) : visible;
  const filterInput = useRef<HTMLInputElement>(null);
  // ⌘K focuses the filter (inside the diff Monaco handles it). Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key.toLowerCase() !== 'k' || useUi.getState().modalCount > 0) return;
      e.preventDefault();
      filterInput.current?.focus();
      filterInput.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Jumping between changes (flow D4): listed files in order, collapsed groups included.
  const files = listed.flatMap((g) => shownOf(g).map((f) => fileId(g.entry.key, f.path)));
  const currentId = current ? fileId(current.key, current.path) : null;
  // Keep the file on screen in the list when it changes from outside the list (next / previous
  // change, a commit's first file); a row clicked in view does not scroll.
  const fileList = useRef<HTMLElement>(null);
  useEffect(() => {
    fileList.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
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
  // Commit changes are fetched once per commit (they never change).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const [key, sha] of Object.entries(commitSel)) {
      const g = groups.find((x) => x.entry.key === key);
      const id = g && commitId(g.entry.repoId, sha);
      if (!g || !id || requested.current.has(id)) continue;
      requested.current.add(id);
      getCommitChanges(g.entry.repoId, sha).then(
        (c) => setCommitData((d) => ({ ...d, [id]: c })),
        (e) => {
          console.error('commit changes failed', e);
          requested.current.delete(id);
          setCommitSel(({ [key]: _, ...rest }) => rest);
        },
      );
    }
  }, [commitSel, groups]);
  // A new tip (rebase, amend) or base that no longer lists the commit drops the selection.
  useEffect(() => {
    if (!data) return;
    setCommitSel((sel) => {
      const kept = Object.entries(sel).filter(([key, sha]) =>
        data.groups.find((g) => g.entry.key === key)?.commits.some((c) => c.sha === sha),
      );
      return kept.length === Object.keys(sel).length ? sel : Object.fromEntries(kept);
    });
  }, [data]);
  // Picking a commit opens its first file once its changes are in.
  const [openFirst, setOpenFirst] = useState<string | null>(null);
  const firstFile = (() => {
    const g = openFirst ? visible.find((x) => x.entry.key === openFirst) : undefined;
    return g && commitOf(g) ? { key: g.entry.key, path: g.files[mode][0]?.path ?? null } : null;
  })();
  useEffect(() => {
    if (!firstFile) return;
    setOpenFirst(null);
    if (firstFile.path) select({ key: firstFile.key, path: firstFile.path });
    // Only when the commit's files arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstFile?.key, firstFile?.path]);
  const pickCommit = (g: ReviewGroup, sha: string | null) => {
    const key = g.entry.key;
    setCommitSel(({ [key]: _, ...rest }) => (sha ? { ...rest, [key]: sha } : rest));
    if (sha) {
      setOpenFirst(key);
      setCollapsed((c) => {
        const open = new Set(c);
        open.delete(key);
        return open;
      });
    } else if (current) {
      // Back to the whole branch: the file on screen stays if the branch lists it.
      select(current);
    }
  };
  /** -1: newer, 1: older. With no commit picked, "older" picks the newest. */
  const stepCommit = (dir: 1 | -1) => {
    if (!commitScoped || !group || group.commits.length === 0) return;
    const list = group.commits;
    const i = list.findIndex((c) => c.sha === shaOf(group));
    if (i < 0) {
      if (dir === 1) pickCommit(group, list[0].sha);
      return;
    }
    const j = i + dir;
    if (j >= 0 && j < list.length) pickCommit(group, list[j].sha);
  };
  const stepCommitRef = useRef(stepCommit);
  stepCommitRef.current = stepCommit;

  // Diff view settings (layout, context, whitespace), remembered in the config.
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
  // ⌥V / ⌥C / ⌥W outside the diff (inside it Monaco handles them). ⌥ turns letters into other
  // characters, so the physical key is checked. Listed in lib/shortcuts.ts.
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

  const stepRef = useRef(step);
  stepRef.current = step;
  // ⌥↓ / ⌥↑ (changes) and ⌥⇧↓ / ⌥⇧↑ (commits) outside the diff; inside it Monaco handles
  // them. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.code !== 'ArrowDown' && e.code !== 'ArrowUp')) return;
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor, input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      const dir = e.code === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) stepCommitRef.current(dir);
      else stepRef.current(dir);
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
  // With the sidebar shown next to Review the header drops its traffic-light space and the
  // file list narrows (ReviewSidebar.dc.html).
  const sidebarShown = useUi((s) => s.sidebarVisible);
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
        {target.kind === 'project' && <EditProjectButton projectId={target.projectId} />}
      </ReviewHeader>
      {banner ? (
        <Banner tone="warning">{banner}</Banner>
      ) : (
        baseSaved && <Banner tone="neutral">{baseSaved}</Banner>
      )}

      <div className={styles.body}>
        <aside ref={fileList} className={sidebarShown ? `${styles.files} ${styles.filesNarrow}` : styles.files}>
          <FileFilter
            inputRef={filterInput}
            query={fileQuery}
            onQuery={setFileQuery}
            count={files.length}
            onOpenFirst={() => {
              const [key, path] = files[0]?.split('\u0000') ?? [];
              if (key) select({ key, path });
            }}
          />
          {filtering && files.length === 0 && (
            <div className={styles.noMatch}>
              <span className={styles.noMatchTitle}>No files match “{fileQuery}”</span>
              <span className={styles.noMatchHint}>Searched paths in {mode} files of every entry.</span>
              <button type="button" className={styles.linkButton} onClick={() => setFileQuery('')}>
                Clear filter
              </button>
            </div>
          )}
          {listed.map((g) => (
            <FileGroup
              key={g.entry.key}
              group={g}
              mode={mode}
              shown={shownOf(g)}
              terms={terms}
              open={filtering || !collapsed.has(g.entry.key)}
              onToggle={() => toggle(g.entry.key)}
              selected={current}
              onSelect={(f) => select(f)}
              pending={pendingKey === g.entry.key}
              onBase={(rect) => setBaseMenu({ group: g, rect })}
              commit={g.commits.find((c) => c.sha === shaOf(g))}
              loading={!!shaOf(g) && !commitOf(g)}
              onClearCommit={() => pickCommit(g, null)}
            />
          ))}
          {target.kind === 'project' && data && data.notInReview.length > 0 && !filtering && (
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
              <EntryBar
                group={group}
                mode={mode}
                sha={shaOf(group)}
                parent={commitParent(group, shaOf(group), commitOf(group))}
                onPick={(sha) => pickCommit(group, sha)}
                onStep={stepCommit}
              />
              <div className={styles.fileBar}>
                <span className={styles.filePath}>{change.path}</span>
                <span className={styles.muted}>
                  {shaOf(group)
                    ? `${commitParent(group, shaOf(group), commitOf(group))} ↔ ${shaOf(group)!.slice(0, 7)}`
                    : compareLabel(mode, group.entry)}
                </span>
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
                  context={context}
                  contextLines={contextLines}
                  onContext={(c, lines) => saveView({ diffContext: c, diffContextLines: lines })}
                  onToggleWs={toggleWs}
                />
                <span className={styles.barDivider} />
                <ChangeNav
                  onlyWhitespace={
                    ignoreWs && !change.binary && (change.add ?? 0) + (change.del ?? 0) > 0
                  }
                  nav={nav}
                  prevFile={fileIndex >= 0 ? files[fileIndex - 1] : files[files.length - 1]}
                  nextFile={files[fileIndex + 1]}
                  onStep={step}
                />
              </div>
              <DiffView
                repoId={group.entry.repoId}
                worktreePath={commitOf(group) ? null : group.entry.worktreePath}
                change={change}
                mode={commitOf(group) ? 'committed' : mode}
                fileKey={`${currentId}\u0000${mode}\u0000${commitOf(group)?.sha ?? ''}`}
                land={land.id === currentId ? land.where : 'first'}
                onNav={setNav}
                onStep={(dir) => stepRef.current(dir)}
                navRef={diffNav}
                layout={layout}
                ignoreWhitespace={ignoreWs}
                onToggleLayout={() => viewRef.current.toggleLayout()}
                onToggleWhitespace={() => viewRef.current.toggleWs()}
                context={context}
                contextLines={contextLines}
                onToggleContext={() => viewRef.current.toggleContext()}
                onCommitStep={(dir) => stepCommitRef.current(dir)}
                onFocusFilter={() => {
                  filterInput.current?.focus();
                  filterInput.current?.select();
                }}
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

function commitId(repoId: string, sha: string): string {
  return `${repoId}\u0000${sha}`;
}

/** Short parent of the picked commit: its first parent once loaded, else the next older listed one. */
function commitParent(g: ReviewGroup, sha: string | undefined, c: CommitChanges | undefined): string {
  if (!sha) return '';
  if (c) return c.parent ? c.parent.slice(0, 7) : 'empty tree';
  const i = g.commits.findIndex((x) => x.sha === sha);
  return (g.commits[i + 1]?.sha ?? g.mergeBase ?? '').slice(0, 7);
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
  const contextRadio = (value: DiffContext, label: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={context === value}
      className={context === value ? `${styles.viewRow} ${styles.viewRowOn}` : styles.viewRow}
      onClick={() => {
        onContext(value, contextLines);
        // Whole file closes the menu; changes only leaves it open to pick the lines.
        if (value === 'whole') setAt(null);
      }}
    >
      <span className={context === value ? styles.viewCheck : `${styles.viewCheck} ${styles.hidden}`}>
        <CheckIcon />
      </span>
      <span className={styles.grow}>{label}</span>
      <span className={styles.viewKey}>⌥C</span>
    </button>
  );
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
        <Popover anchorRect={at} width={300} alignRight onClose={() => setAt(null)}>
          <div role="menu" aria-label="Diff view" className={styles.viewMenu}>
            <div className={styles.viewTitle}>Layout</div>
            {radio('split', 'Split')}
            {radio('unified', 'Unified')}
            <div className={styles.viewDivider} />
            <div className={styles.viewTitle}>Context</div>
            {contextRadio('changes', 'Changes only')}
            <div
              role="group"
              aria-label="Lines around each change"
              aria-disabled={context === 'whole'}
              className={context === 'whole' ? `${styles.viewLines} ${styles.viewLinesOff}` : styles.viewLines}
            >
              <span className={styles.viewLinesLabel}>Lines around changes</span>
              <div className={styles.viewLinesTrack}>
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={contextLines === n}
                    tabIndex={context === 'whole' ? -1 : undefined}
                    className={contextLines === n ? `${styles.viewLinesBtn} ${styles.viewLinesBtnOn}` : styles.viewLinesBtn}
                    onClick={() => onContext('changes', n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {contextRadio('whole', 'Whole file')}
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

/** Review hides the sidebar (unless opened from it); leaving restores what it was. */
function useSidebarHiddenWhileMounted(hide: boolean) {
  useEffect(() => {
    if (!hide) return;
    const ui = useUi.getState();
    const before = ui.sidebarVisible;
    ui.setSidebarVisible(false);
    return () => useUi.getState().setSidebarVisible(before);
  }, [hide]);
}

/** Opens the project page: back to it when Review was opened from there, else a new step. */
function EditProjectButton({ projectId }: { projectId: string }) {
  const edit = () => {
    const nav = useNav.getState();
    const prev = nav.stack[nav.index - 1];
    if (prev?.name === 'project' && prev.projectId === projectId) nav.back();
    else nav.push({ name: 'project', projectId });
  };
  return (
    <IconButton size={32} aria-label="Edit project" title="Edit project" onClick={edit}>
      <PencilIcon />
    </IconButton>
  );
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
  const [renaming, setRenaming] = useState(false);
  const project = target.kind === 'project' ? config?.projects.find((p) => p.id === target.projectId) : undefined;

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
    title = project?.name ?? '';
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
        {renaming && project ? (
          <ProjectNameInput project={project} className={styles.titleInput} onDone={() => setRenaming(false)} />
        ) : (
          // Project scope: double-click renames the project, as on its page.
          <span
            className={styles.title}
            data-tauri-drag-region={project ? undefined : true}
            onDoubleClick={project ? () => setRenaming(true) : undefined}
          >
            {title}
          </span>
        )}
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
  shown,
  terms,
  open,
  onToggle,
  selected,
  onSelect,
  pending,
  onBase,
  commit,
  loading,
  onClearCommit,
}: {
  group: ReviewGroup;
  mode: DiffMode;
  /** The files the filter lets through (all of them without a filter). */
  shown: FileChange[];
  terms: string[];
  open: boolean;
  onToggle: () => void;
  selected: FileRef | null;
  onSelect: (f: FileRef) => void;
  pending: boolean;
  onBase: (rect: DOMRect) => void;
  /** The commit this entry is scoped to (flow D7). */
  commit: CommitInfo | undefined;
  /** Its files are on the way; the previous list stays, dimmed. */
  loading: boolean;
  onClearCommit: () => void;
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
            title={`base ${e.base ?? 'none'}`}
            className={e.baseIsCustom ? `${styles.baseButton} ${styles.baseCustom}` : styles.baseButton}
            onClick={(ev) => onBase(ev.currentTarget.getBoundingClientRect())}
          >
            <span className={styles.muted}>base</span>
            <span className={styles.baseName}>{e.base ?? 'none'}</span>
            <ChevronDownIcon size={9} />
          </button>
        </div>
        <div className={styles.groupLine2}>
          <span className={styles.branch}>{e.branch ?? e.shortSha}</span>
          {terms.length > 0 && (
            <span className={styles.matchLabel}>
              {shown.length} of {files.length}
            </span>
          )}
          {/* An empty group (a branch review with nothing in this mode) shows no "+0". */}
          {files.length > 0 && <span className={styles.add}>+{add}</span>}
          {del > 0 && <span className={styles.del}>−{del}</span>}
        </div>
        {commit && (
          <div className={styles.commitChip}>
            <span className={styles.chipSha}>{commit.shortSha}</span>
            <span className={styles.chipSubject} title={commit.subject}>
              {commit.subject}
            </span>
            <button
              type="button"
              aria-label="Show all commits"
              title="Show all commits"
              className={styles.chipClose}
              onClick={onClearCommit}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        )}
      </div>
      {g.stackHint && (
        <div className={styles.stackHint}>
          {g.stackHint.contains} of {g.stackHint.total} commits come from {g.stackHint.branch}. A
          different base may fit better.
        </div>
      )}
      {open && (
        <div className={loading ? `${styles.fileRows} ${styles.stale}` : styles.fileRows}>
          {shown.map((f) => {
            const on = selected?.key === e.key && selected.path === f.path;
            return (
              <button
                key={f.path}
                type="button"
                className={on ? `${styles.fileRow} ${styles.selected}` : styles.fileRow}
                aria-current={on || undefined}
                onClick={() => onSelect({ key: e.key, path: f.path })}
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
            );
          })}
        </div>
      )}
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

/** The field above the file list (flow D8). */
function FileFilter({
  inputRef,
  query,
  onQuery,
  count,
  onOpenFirst,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (q: string) => void;
  /** Files the filter lets through. */
  count: number;
  /** ↵: open the first match. */
  onOpenFirst: () => void;
}) {
  const active = query.length > 0;
  return (
    <label className={active ? `${styles.filter} ${styles.filterOn}` : styles.filter}>
      <SearchIcon size={13} className={styles.filterIcon} />
      <input
        ref={inputRef}
        className={styles.filterInput}
        value={query}
        placeholder="Filter files"
        aria-label="Filter files"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (count > 0) onOpenFirst();
          } else if (e.key === 'Escape') {
            // Clears first; a second Esc leaves the field.
            e.preventDefault();
            if (active) onQuery('');
            else e.currentTarget.blur();
          }
        }}
      />
      {active ? (
        <>
          <span aria-live="polite" className={styles.filterCount}>
            {count} {count === 1 ? 'file' : 'files'}
          </span>
          <button
            type="button"
            aria-label="Clear filter"
            title="Clear (esc)"
            className={styles.filterClear}
            onClick={() => {
              onQuery('');
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size={10} />
          </button>
        </>
      ) : (
        <Kbd>⌘K</Kbd>
      )}
    </label>
  );
}

function EntryBar({
  group: g,
  mode,
  sha,
  parent,
  onPick,
  onStep,
}: {
  group: ReviewGroup;
  mode: DiffMode;
  /** The commit the entry is scoped to (flow D7). */
  sha: string | undefined;
  /** Its short parent. */
  parent: string;
  onPick: (sha: string | null) => void;
  /** -1: newer, 1: older. */
  onStep: (dir: 1 | -1) => void;
}) {
  const e = g.entry;
  const name = e.branch ?? e.shortSha ?? '';
  const ahead = e.ahead ?? g.commits.length;
  // Without a base (a base branch with no upstream) there is only the working tree.
  const workingTree = mode === 'uncommitted' || !e.base;
  const index = sha ? g.commits.findIndex((c) => c.sha === sha) : -1;
  const total = g.commits.length;
  const on = index >= 0;

  // Stepping keeps the picked row in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sha]);

  return (
    <div className={styles.entryBar}>
      <div className={styles.entryLine}>
        <div className={styles.entryNames}>
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
            {workingTree && e.worktreePath
              ? `working tree ${tildifyHome(e.worktreePath)}`
              : on
                ? `${parent}..${sha!.slice(0, 7)}`
                : `${e.base}..${name}`}
          </span>
        </div>
        <span className={styles.grow} />
        <span className={styles.muted}>
          {workingTree
            ? 'HEAD ↔ working tree'
            : on
              ? `Commit ${total - index} of ${total}`
              : `${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead of ${e.base}`}
        </span>
        {on && !workingTree && (
          <>
            <div role="group" aria-label="Step through commits" className={styles.navGroup}>
              <button
                type="button"
                aria-label="Newer commit"
                title="Newer commit (⌥⇧↑)"
                className={styles.navButton}
                disabled={index <= 0}
                onClick={() => onStep(-1)}
              >
                <ChevronUpIcon size={14} />
              </button>
              <button
                type="button"
                aria-label="Older commit"
                title="Older commit (⌥⇧↓)"
                className={styles.navButton}
                disabled={index >= total - 1}
                onClick={() => onStep(1)}
              >
                <ChevronDownIcon size={14} />
              </button>
            </div>
            <button type="button" className={styles.showAll} onClick={() => onPick(null)}>
              Show all commits
            </button>
          </>
        )}
      </div>
      {!workingTree && total > 0 && (
        <div ref={list} role="listbox" aria-label="Commits" className={styles.commits}>
          {g.commits.map((c) => {
            const picked = c.sha === sha;
            const cls = [styles.commit, picked && styles.commitOn, c.fromBranch && styles.foreign]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={c.sha}
                type="button"
                role="option"
                aria-selected={picked}
                title={picked ? 'Show all commits' : 'Show only this commit'}
                className={cls}
                onClick={() => onPick(picked ? null : c.sha)}
              >
                <span className={styles.sha}>{c.shortSha}</span>
                <span className={styles.subject}>{c.subject}</span>
                {c.fromBranch && (
                  <Pill tone="warning" className={styles.fromPill}>
                    {c.fromBranch}
                  </Pill>
                )}
                <span className={styles.age}>{formatAge(c.committedAt)}</span>
              </button>
            );
          })}
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

