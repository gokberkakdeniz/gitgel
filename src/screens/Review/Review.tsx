import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../components/Banner';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import {
  BranchIcon,
  ChevronDownIcon,
  CloseIcon,
  HistoryIcon,
  MoreVerticalIcon,
  RefreshIcon,
} from '../../components/icons';
import { ProjectNameInput } from '../../components/ProjectNameInput';
import { ResizeHandle, useStoredWidth } from '../../components/ResizeHandle';
import { Input } from '../../components/Input';
import { Kbd } from '../../components/Kbd';
import { Menu, MenuDivider, MenuItem } from '../../components/Menu';
import { CopyBranchItem, EntryMenuNote, OpenItems, entryFolder, useEntryFolder } from '../../components/OpenItems';
import { Popover } from '../../components/Popover';
import { Pill } from '../../components/Pill';
import { Segmented } from '../../components/Segmented';
import { formatAge, plural } from '../../lib/format';
import { getCommitChanges, getReview, getStashChanges } from '../../lib/ipc';
import { basename, tildifyHome } from '../../lib/paths';
import type {
  CommitChanges,
  CommitInfo,
  FileChange,
  DiffMode,
  EntrySummary,
  ReviewGroup,
  ReviewTarget,
  StashChanges,
} from '../../lib/types';
import { useInvoke } from '../../lib/useInvoke';
import { ScriptsMenu } from '../../scripts/ScriptsMenu';
import { useStashAction } from '../../stash/StashAction';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { PageMenu } from '../../components/PageMenu';
import { Stepper } from '../../components/Stepper';
import { rescanAll } from '../../lib/events';
import { StashBar } from '../../stash/StashBar';
import { conflictsTooltip } from '../../sync/operation';
import { OperationBanner, OperationPill } from '../../sync/OperationUi';
import { SyncItems } from '../../sync/SyncButtons';
import { upstreamLabel, upstreamTitle } from '../../sync/sync';
import { next, prev } from '../../monaco/changeNav';
import { DiffView, type DiffNav, type NavInfo } from '../../monaco/DiffView';
import { useData } from '../../state/data';
import { openHistory, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { fileMatches, filterTerms } from './fileFilter';
import { DiffStat, FileBar, FileRow, StashSection, useDiffView, useSidebarHiddenWhileMounted, useSwitchTo, type FileActions } from './parts';
import { askDiscard, targetOf } from '../../discard/discard';
import { usePicks } from '../../discard/picks';
import parts from './parts.module.css';
import { reviewStashes, stashHeading, type ReviewStash } from './stashes';
import editable from '../../components/EditableTitle.module.css';
import styles from './Review.module.css';
import {
  compareLabel,
  defaultMode,
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
  const config = useData((s) => s.config);
  const projects = useData((s) => s.config?.projects);
  const repoIds = useMemo(() => {
    if (target.kind !== 'project') return [target.repoId];
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

  // Stashes (flows P2–P3): listed under the files; picking one shows what it holds instead of
  // an entry's file. Its changes are fetched once (a stash never changes).
  const scans = useData((s) => s.scan);
  const stashes = useMemo(() => reviewStashes(target, projects, scans), [target, projects, scans]);
  const [stashSel, setStashSel] = useState<string | null>(target.kind === 'stashes' ? (focusKey ?? null) : null);
  const [stashPath, setStashPath] = useState<string | null>(null);
  const [stashData, setStashData] = useState<Record<string, StashChanges>>({});
  // Stash scope always shows one: the one asked for, else the newest (also after it was dropped).
  const stash =
    stashes.find((s) => s.sha === stashSel) ?? (target.kind === 'stashes' ? stashes[0] : undefined);
  const stashChanges = stash ? stashData[commitId(stash.repoId, stash.sha)] : undefined;
  const stashFile = stashChanges?.files.find((f) => f.path === stashPath) ?? stashChanges?.files[0];
  const stashId = stash ? `stash\u0001${stash.sha}` : null;
  const stashRequested = useRef(new Set<string>());
  useEffect(() => {
    if (!stash) return;
    const id = commitId(stash.repoId, stash.sha);
    if (stashRequested.current.has(id)) return;
    stashRequested.current.add(id);
    getStashChanges(stash.repoId, stash.sha).then(
      (c) => setStashData((d) => ({ ...d, [id]: c })),
      (e) => {
        console.error('stash changes failed', e);
        stashRequested.current.delete(id);
      },
    );
  }, [stash]);

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

  // A conflicted file named in an operation banner: Uncommitted, that entry open, the file shown.
  const openConflict = (key: string, path: string) => {
    setChosenMode('uncommitted');
    setCommitSel({});
    setStashSel(null);
    setCollapsed((c) => new Set([...c].filter((k) => k !== key)));
    setSelected({ key, path });
  };
  // The file on screen stays when the new mode lists it (resolveSelection falls back otherwise).
  const setMode = (m: DiffMode) => {
    setChosenMode(m);
    setSelected(current);
    setStashSel(null);
    if (m === 'uncommitted') setCommitSel({});
  };
  // Entries with nothing in this mode are hidden, except the one group of a branch review: its
  // header holds the menu with "Change Base…", the way out of a base that leaves nothing to show.
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
  // With a stash picked they are its files.
  const files = stashId
    ? (stashChanges?.files ?? []).map((f) => fileId(stashId, f.path))
    : listed.flatMap((g) => shownOf(g).map((f) => fileId(g.entry.key, f.path)));
  const currentId = stashId
    ? stashFile
      ? fileId(stashId, stashFile.path)
      : null
    : current
      ? fileId(current.key, current.path)
      : null;
  // Keep the file on screen in the list when it changes from outside the list (next / previous
  // change, a commit's first file); a row clicked in view does not scroll.
  const fileList = useRef<HTMLElement>(null);
  useEffect(() => {
    fileList.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
  const fileIndex = currentId ? files.indexOf(currentId) : -1;
  // Uncommitted files picked with ⌘ / ⇧-click, across entries (D12): their right-click menu
  // discards and copies all of them.
  const pickable = mode === 'uncommitted' && !stashId;
  const picks = usePicks(pickable ? files : [], currentId, `${targetKey}\u0000${mode}`);
  const actionsOf = (g: ReviewGroup, f: FileChange): FileActions | undefined => {
    if (!pickable || !g.entry.worktreePath) return undefined;
    const ids = picks.targets(fileId(g.entry.key, f.path));
    const targets = listed.flatMap((x) => {
      const picked = shownOf(x).filter((y) => ids.includes(fileId(x.entry.key, y.path)));
      return picked.length > 0 ? [targetOf(x.entry, picked)] : [];
    });
    return {
      // Each file with its own worktree: picks can span repos holding the same paths.
      files: listed.flatMap((x) =>
        shownOf(x)
          .filter((y) => ids.includes(fileId(x.entry.key, y.path)))
          .map((y) => ({ file: y, folder: entryFolder(x.entry, config) })),
      ),
      onDiscard: () => askDiscard({ targets, all: false }),
    };
  };
  const [land, setLand] = useState<{ id: string | null; where: 'first' | 'last' }>({ id: null, where: 'first' });
  const [nav, setNav] = useState<NavInfo>({ index: null, count: 0 });
  const diffNav = useRef<DiffNav | null>(null);
  const select = (f: FileRef, where: 'first' | 'last' = 'first') => {
    if (stashId && f.key === stashId) {
      setStashPath(f.path);
    } else {
      setStashSel(null);
      setSelected(f);
    }
    setLand({ id: fileId(f.key, f.path), where });
  };
  const pickStash = (sha: string) => {
    setStashSel(sha);
    setStashPath(null);
    setLand({ id: null, where: 'first' });
  };
  const step = (dir: 1 | -1) => {
    const state = { index: nav.index, count: nav.count, files, fileIndex };
    const r = dir > 0 ? next(state) : prev(state);
    if (r?.kind === 'hunk') diffNav.current?.goTo(r.index);
    if (r?.kind === 'file') {
      const [key, path] = r.key.split('\u0000');
      if (key !== stashId)
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
  const view = useDiffView();
  const { layout, ignoreWs, context, contextLines, viewRef } = view;

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
  const [baseMenu, setBaseMenu] = useState<{ entry: EntrySummary; rect: DOMRect; alignRight: boolean } | null>(null);
  const [baseSaved, setBaseSaved] = useState<string | null>(null);
  // An entry's ⋯ menu; `atPointer` when opened by right-clicking its header.
  const [entryMenu, setEntryMenu] = useState<{ entry: EntrySummary; rect: DOMRect; atPointer?: boolean } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  useEffect(() => setPendingKey(null), [data]);
  const conflictBanner = conflictsBanner(groups);

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
  // The file list's width once dragged; until then 310px, or 280px beside the sidebar.
  const [filesWidth, setFilesWidth] = useStoredWidth('gitgel.reviewFilesWidth');
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // The file bar and the diff, for an entry's file or a stash's.
  const fileBar = (file: FileChange, label: string) => (
    <FileBar
      file={file}
      label={label}
      view={view}
      nav={nav}
      prevFile={fileIndex >= 0 ? files[fileIndex - 1] : files[files.length - 1]}
      nextFile={files[fileIndex + 1]}
      onStep={step}
    />
  );
  const diffView = (
    repoId: string,
    worktreePath: string | null,
    folder: string | null,
    commit: string | null,
    parent: string | null,
    file: FileChange,
    diffMode: DiffMode,
    fileKey: string,
  ) => (
    <DiffView
      repoId={repoId}
      worktreePath={worktreePath}
      folder={folder}
      commit={commit}
      parent={parent}
      change={file}
      mode={diffMode}
      fileKey={fileKey}
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
  );

  const stashAction = useStashAction(data?.groups ?? []);
  // A branch (or a detached worktree's SHA) has a History; a project or the stash stack does not.
  const historyRev = target.kind === 'branch' && !target.tipOverride ? (target.branch ?? entry?.headSha ?? null) : null;
  const toHistory = useSwitchTo(
    target.kind === 'branch' && historyRev
      ? { name: 'history', repoId: target.repoId, rev: historyRev, backLabel: 'Back to Review' }
      : null,
  );

  return (
    <div className={parts.screen}>
      <ReviewHeader entry={entry} target={target} backLabel={backLabel} stashes={stashes}>
        {target.kind !== 'stashes' && (
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
        )}
        <PageMenu>
          {(close, anchor) => (
            <>
              {target.kind !== 'stashes' && stashAction.item(close, anchor)}
              {toHistory && (
                <MenuItem
                  icon="history"
                  kbd="⌥H"
                  onSelect={() => {
                    close();
                    toHistory();
                  }}
                >
                  Open History
                </MenuItem>
              )}
              <MenuItem
                icon="refresh"
                onSelect={() => {
                  close();
                  void rescanAll(true);
                }}
              >
                Refresh
              </MenuItem>
              {target.kind === 'project' && (
                <MenuItem
                  icon="pencil"
                  onSelect={() => {
                    close();
                    editProject(target.projectId);
                  }}
                >
                  Edit project
                </MenuItem>
              )}
            </>
          )}
        </PageMenu>
        {stashAction.dialog}
      </ReviewHeader>
      {!stash &&
        groups.map(
          (g) =>
            g.entry.operation && (
              <OperationBanner
                key={g.entry.key}
                entry={g.entry}
                op={g.entry.operation}
                onOpenFile={(path) => openConflict(g.entry.key, path)}
              />
            ),
        )}
      {conflictBanner && !stash && <Banner tone="danger">{conflictBanner}</Banner>}
      {baseSaved && <Banner tone="neutral">{baseSaved}</Banner>}

      <div className={parts.body}>
        <aside
          ref={fileList}
          className={sidebarShown ? `${styles.files} ${styles.filesNarrow}` : styles.files}
          style={filesWidth ? { width: filesWidth } : undefined}
        >
          {target.kind !== 'stashes' && (
            <FileFilter
              inputRef={filterInput}
              query={fileQuery}
              onQuery={(q) => {
                setFileQuery(q);
                // The stashes are hidden while filtering, so the entries' file comes back.
                if (q.trim()) setStashSel(null);
              }}
              count={files.length}
              onOpenFirst={() => {
                const [key, path] = files[0]?.split('\u0000') ?? [];
                if (key) select({ key, path });
              }}
            />
          )}
          {filtering && files.length === 0 && (
            <div className={styles.noMatch}>
              <span className={styles.noMatchTitle}>No Files Match “{fileQuery}”</span>
              <span className={styles.noMatchHint}>Searched paths in {mode} files of every entry.</span>
              <button type="button" className={parts.linkButton} onClick={() => setFileQuery('')}>
                Clear Filter
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
              selected={stash ? null : current}
              onSelect={(f) => select(f)}
              pending={pendingKey === g.entry.key}
              menuOpen={entryMenu?.entry.key === g.entry.key}
              onMenu={(rect, atPointer) => setEntryMenu({ entry: g.entry, rect, atPointer })}
              commit={g.commits.find((c) => c.sha === shaOf(g))}
              loading={!!shaOf(g) && !commitOf(g)}
              onClearCommit={() => pickCommit(g, null)}
              picks={pickable ? picks : undefined}
              actions={(f) => actionsOf(g, f)}
            />
          ))}
          {target.kind === 'project' && data && data.notInReview.length > 0 && !filtering && (
            <div className={styles.notInReview}>
              {plural(data.notInReview.length, 'entry', 'entries')} not reviewable ·{' '}
              <button
                type="button"
                className={parts.linkButton}
                onClick={() => push({ name: 'project', projectId: target.projectId })}
              >
                Open project
              </button>
            </div>
          )}
          {stashes.length > 0 && !filtering && (
            <StashSection
              heading={stashHeading(target, stashes[0].repoName)}
              stashes={stashes}
              picked={stash?.sha}
              changes={stashChanges}
              file={stashFile?.path}
              divider={target.kind !== 'stashes'}
              onPick={pickStash}
              onFile={(path) => stashId && select({ key: stashId, path })}
            />
          )}
        </aside>
        <ResizeHandle pane={fileList} min={220} max={640} onResize={setFilesWidth} onReset={() => setFilesWidth(null)} />

        <section className={parts.main}>
          {error ? (
            <div className={parts.empty}>{error.message}</div>
          ) : !data ? null : stash ? (
            <>
              <StashBar stash={stash} base={stashChanges?.base ?? stash.base} />
              {stashFile ? (
                <>
                  {fileBar(stashFile, `${(stashChanges?.base ?? stash.base).slice(0, 7)} ↔ stash@{${stash.index}}`)}
                  {diffView(
                    stash.repoId,
                    null,
                    config?.repos.find((r) => r.id === stash.repoId)?.path ?? null,
                    null,
                    null,
                    stashFile, 'committed',
                    `${currentId}\u0000stash`,
                  )}
                </>
              ) : (
                stashChanges && <div className={parts.empty}>No Changes</div>
              )}
            </>
          ) : target.kind === 'stashes' ? (
            <div className={parts.empty}>No stashes</div>
          ) : groups.length === 0 ? (
            <div className={parts.empty}>
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
              {fileBar(
                change,
                shaOf(group)
                  ? `${commitParent(group, shaOf(group), commitOf(group))} ↔ ${shaOf(group)!.slice(0, 7)}`
                  : compareLabel(mode, group.entry),
              )}
              {diffView(
                group.entry.repoId,
                commitOf(group) ? null : group.entry.worktreePath,
                entryFolder(group.entry, config),
                commitOf(group)?.sha ?? null,
                commitOf(group)?.parent ?? null,
                change,
                commitOf(group) ? 'committed' : mode,
                // Uncommitted and All both show the working tree on the new side: one key, so
                // switching between them keeps the place in the file.
                `${currentId}\u0000${mode === 'committed' ? mode : 'tree'}\u0000${commitOf(group)?.sha ?? ''}`,
              )}
            </>
          ) : (
            <div className={parts.empty}>{EMPTY_MESSAGES[mode]}</div>
          )}
        </section>
      </div>
      {entryMenu && (
        <Popover anchorRect={entryMenu.rect} width={260} alignRight={!entryMenu.atPointer} onClose={() => setEntryMenu(null)}>
          <EntryMenu
            entry={entryMenu.entry}
            target={target}
            onClose={() => setEntryMenu(null)}
            onChangeBase={() => {
              setEntryMenu(null);
              setBaseMenu({ entry: entryMenu.entry, rect: entryMenu.rect, alignRight: !entryMenu.atPointer });
            }}
          />
        </Popover>
      )}
      {baseMenu && (
        <BaseMenu
          repoId={baseMenu.entry.repoId}
          entryKey={baseMenu.entry.key}
          branchName={baseMenu.entry.branch ?? baseMenu.entry.shortSha ?? ''}
          anchorRect={baseMenu.rect}
          alignRight={baseMenu.alignRight}
          onClose={() => setBaseMenu(null)}
          onChosen={(base) => {
            const e = baseMenu.entry;
            if (base !== e.base) setPendingKey(e.key);
            setBaseSaved(`Base set to ${base}`);
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

/** Opens the project page: back to it when Review was opened from there, else a new step. */
/** Back to the project page when Review was opened from it, else to it. */
function editProject(projectId: string) {
  const nav = useNav.getState();
  const prev = nav.stack[nav.index - 1];
  if (prev?.name === 'project' && prev.projectId === projectId) nav.back();
  else nav.push({ name: 'project', projectId });
}

function ReviewHeader({
  entry,
  target,
  backLabel,
  stashes,
  children,
}: {
  entry: EntrySummary | undefined;
  target: ReviewTarget;
  backLabel: string;
  stashes: ReviewStash[];
  children: React.ReactNode;
}) {
  const config = useData((s) => s.config);
  const [renaming, setRenaming] = useState(false);
  // The title box's width when rename started, so the input keeps it.
  const titleWidth = useRef<number | undefined>(undefined);
  const project = target.kind === 'project' ? config?.projects.find((p) => p.id === target.projectId) : undefined;

  let title = '';
  let subtitle = '';
  if (target.kind === 'branch') {
    title = 'Review';
    const rev = target.branch ?? entry?.shortSha;
    const where = target.tipOverride ? 'last known state' : entry?.worktreePath ? tildifyHome(entry.worktreePath) : null;
    subtitle = [entry?.repoName, rev, where].filter(Boolean).join(' · ');
  } else if (target.kind === 'stashes') {
    title = 'Stashes';
    const repo = config?.repos.find((r) => r.id === target.repoId);
    subtitle = `${repo ? basename(repo.path) : ''} · ${plural(stashes.length, 'stash', 'stashes')}`;
  } else {
    title = project?.name ?? '';
    if (project) {
      const repos = new Set(project.entries.map((e) => e.repoId)).size;
      subtitle = `${plural(repos, 'repo', 'repos')} · ${plural(project.entries.length, 'branch', 'branches')}`;
    }
  }

  return (
    <PageHeader
      backLabel={backLabel}
      // Project scope: click renames the project in place, as on its page.
      dragTitle={!project}
      title={
        renaming && project ? (
          <ProjectNameInput
            project={project}
            className={editable.input}
            width={titleWidth.current}
            onDone={() => setRenaming(false)}
          />
        ) : project ? (
          <span
            className={editable.title}
            data-editable-title
            title="Rename Project"
            onClick={(e) => {
              titleWidth.current = e.currentTarget.offsetWidth;
              setRenaming(true);
            }}
          >
            {title}
          </span>
        ) : (
          title
        )
      }
      subtitle={subtitle}
    >
      {children}
    </PageHeader>
  );
}

/** An entry's ⋯ menu: "Change Base…", then Branches' row menu without "Open Review", since this is it. */
function EntryMenu({
  entry,
  target,
  onClose,
  onChangeBase,
}: {
  entry: EntrySummary;
  target: ReviewTarget;
  onClose: () => void;
  onChangeBase: () => void;
}) {
  const project = useData((s) =>
    target.kind === 'project' ? s.config?.projects.find((p) => p.id === target.projectId)?.name : undefined,
  );
  const rev = entry.branch ?? entry.headSha;
  return (
    <Menu aria-label="Branch Options" autoFocus>
      <MenuItem
        icon={<BranchIcon size={14} />}
        sub={`base ${entry.base ?? 'none'}`}
        onSelect={onChangeBase}
      >
        Change Base…
      </MenuItem>
      <CopyBranchItem entry={entry} onDone={onClose} />
      {rev && (
        <MenuItem
          icon={<HistoryIcon />}
          onSelect={() => {
            onClose();
            openHistory(entry.repoId, rev, 'Back to Review');
          }}
        >
          Open History
        </MenuItem>
      )}
      <MenuDivider />
      <OpenItems entry={entry} onDone={onClose} />
      <SyncItems entry={entry} onDone={onClose} />
      {project !== undefined ? (
        <ScriptsMenu entry={entry} menu="project" project={project} onDone={onClose} />
      ) : (
        <ScriptsMenu entry={entry} menu="branches" onDone={onClose} />
      )}
      <EntryMenuNote entry={entry} />
    </Menu>
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
  menuOpen,
  onMenu,
  commit,
  loading,
  onClearCommit,
  picks,
  actions,
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
  menuOpen: boolean;
  onMenu: (rect: DOMRect, atPointer?: boolean) => void;
  /** The commit this entry is scoped to (flow D7). */
  commit: CommitInfo | undefined;
  /** Its files are on the way; the previous list stays, dimmed. */
  loading: boolean;
  onClearCommit: () => void;
  /** Uncommitted files picked with ⌘ / ⇧-click (D12), by `fileId`. */
  picks?: { isPicked: (id: string) => boolean; click: (id: string, e: React.MouseEvent, open: () => void) => void };
  /** Uncommitted's file menu (D12). */
  actions: (f: FileChange) => FileActions | undefined;
}) {
  const files = g.files[mode];
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  const e = g.entry;
  const folder = useEntryFolder(e);
  return (
    <section className={styles.group}>
      <div
        className={styles.groupHead}
        onContextMenu={(ev) => {
          ev.preventDefault();
          onMenu(new DOMRect(ev.clientX, ev.clientY, 0, 0), true);
        }}
      >
        <div className={styles.groupLine}>
          <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={onToggle}>
            <ChevronDownIcon className={open ? styles.chevron : `${styles.chevron} ${styles.closed}`} />
            <span className={styles.repoName}>{e.repoName}</span>
          </button>
          {pending && <RefreshIcon size={11} className={styles.pending} />}
          {/* The totals give way to the ⋯ button while the header is hovered or the menu is open. */}
          <span className={menuOpen ? `${styles.groupEnd} ${styles.groupEndOpen}` : styles.groupEnd}>
            <span className={styles.totals}>
              {/* An empty group (a branch review with nothing in this mode) shows no "+0". */}
              <DiffStat add={files.length > 0 ? add : undefined} del={del > 0 ? del : undefined} />
            </span>
            <button
              type="button"
              aria-label="Branch Options"
              aria-haspopup="menu"
              className={styles.groupMenu}
              onClick={(ev) => onMenu(ev.currentTarget.getBoundingClientRect())}
            >
              <MoreVerticalIcon size={14} />
            </button>
          </span>
        </div>
        <div className={styles.groupLine2}>
          <span className={styles.branch}>{e.branch ?? e.shortSha}</span>
          {e.operation && <OperationPill op={e.operation} short />}
          {e.conflicts > 0 && (
            <Pill tone="danger" size="sm" title={conflictsTooltip(e)}>
              {plural(e.conflicts, 'conflict', 'conflicts')}
            </Pill>
          )}
          {terms.length > 0 ? (
            <span className={styles.matchLabel}>
              {shown.length} of {files.length}
            </span>
          ) : (
            // Mid-rebase the pills take its place; it comes back when the operation ends.
            e.upstream &&
            !e.operation && (
              <span className={styles.upstream} title={upstreamTitle(e.upstream)}>
                {upstreamLabel(e.upstream)}
              </span>
            )
          )}
        </div>
        {commit && (
          <div className={styles.commitChip}>
            <span className={styles.chipSha}>{commit.shortSha}</span>
            <span className={styles.chipSubject} title={commit.subject}>
              {commit.subject}
            </span>
            <button
              type="button"
              aria-label="Show All Commits"
              title="Show All Commits"
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
        <div className={loading ? `${parts.fileRows} ${styles.stale}` : parts.fileRows}>
          {shown.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              folder={folder}
              terms={terms}
              on={selected?.key === e.key && selected.path === f.path}
              picked={picks?.isPicked(fileId(e.key, f.path))}
              onClick={(ev) => {
                const open = () => onSelect({ key: e.key, path: f.path });
                if (picks) picks.click(fileId(e.key, f.path), ev, open);
                else open();
              }}
              actions={actions(f)}
            />
          ))}
        </div>
      )}
    </section>
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
  return (
    <Input
      ref={inputRef}
      leftIcon="search"
      rightText={query ? plural(count, 'file', 'files') : <Kbd>⌘K</Kbd>}
      mono
      clearable
      className={styles.filter}
      value={query}
      onChange={onQuery}
      placeholder="Search"
      aria-label="Search Files"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (count > 0) onOpenFirst();
        } else if (e.key === 'Escape') {
          // Input clears a filled field first; this second Esc leaves it.
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
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
  // The upstream line (W4a) sits over the newest commit the remote has, when some listed ones
  // are not pushed.
  const up = e.upstream;
  const pushedAt = up?.name ? g.commits.findIndex((c) => c.sha === up.mergeBase) : -1;

  // Stepping keeps the picked row in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sha]);

  return (
    <div className={parts.entryBar}>
      <div className={parts.entryLine}>
        <div className={styles.entryNames}>
          <button
            type="button"
            className={`${styles.repoName} ${styles.repoLink}`}
            title={`Show ${e.repoName} on Branches`}
            onClick={() => useNav.getState().push({ name: 'branches', focusRepoId: e.repoId })}
          >
            {e.repoName}
          </button>
          {/* The branch, and the base on the right, open their History (SPEC §16). */}
          <button
            type="button"
            className={`${styles.entryBranch} ${styles.repoLink}`}
            title={`Show history of ${name}`}
            onClick={() => openHistory(e.repoId, e.branch ?? e.headSha, 'Back to Review')}
          >
            {name}
          </button>
          {/* The range only when it says something the line does not (flow D7, Uncommitted). */}
          {workingTree && e.worktreePath ? (
            <span className={styles.entryRange}>working tree {tildifyHome(e.worktreePath)}</span>
          ) : (
            on && (
              <span className={styles.entryRange}>
                {parent}..{sha!.slice(0, 7)}
              </span>
            )
          )}
        </div>
        <span className={parts.grow} />
        <span className={parts.muted}>
          {workingTree
            ? 'HEAD ↔ working tree'
            : on
              ? `Commit ${total - index} of ${total}`
              : (
                <>
                  {ahead} {ahead === 1 ? 'commit' : 'commits'} ahead of{' '}
                  <button
                    type="button"
                    className={`${styles.baseLink} ${styles.repoLink}`}
                    title={`Show history of ${e.base}`}
                    onClick={() => openHistory(e.repoId, e.base, 'Back to Review')}
                  >
                    {e.base}
                  </button>
                  {e.upstream && <span title={upstreamTitle(e.upstream)}> · {upstreamLabel(e.upstream)}</span>}
                </>
              )}
        </span>
        {on && !workingTree && (
          <>
            <Stepper
              aria-label="Step through commits"
              up={{ 'aria-label': 'Newer commit', title: 'Newer commit (⌥⇧↑)', disabled: index <= 0 }}
              down={{ 'aria-label': 'Older commit', title: 'Older commit (⌥⇧↓)', disabled: index >= total - 1 }}
              onStep={onStep}
            />
            <button type="button" className={styles.showAll} onClick={() => onPick(null)}>
              Show All Commits
            </button>
          </>
        )}
      </div>
      {!workingTree && total > 0 && (
        <div ref={list} role="listbox" aria-label="Commits" className={styles.commits}>
          {g.commits.map((c, i) => {
            const picked = c.sha === sha;
            const cls = [styles.commit, picked && styles.commitOn, c.fromBranch && styles.foreign]
              .filter(Boolean)
              .join(' ');
            const line = i === pushedAt && i > 0 && (
              <div
                key="upstream"
                role="separator"
                aria-label={`${up!.name} is at ${c.shortSha}; above it is not pushed`}
                className={styles.upstreamLine}
              >
                <span>{up!.name} · above: not pushed</span>
              </div>
            );
            return [
              line,
              <button
                key={c.sha}
                type="button"
                role="option"
                aria-selected={picked}
                title={picked ? 'Show All Commits' : 'Show Only This Commit'}
                className={cls}
                onClick={() => onPick(picked ? null : c.sha)}
              >
                <span className={styles.sha}>{c.shortSha}</span>
                <span className={styles.subject}>{c.subject}</span>
                {c.fromBranch && (
                  <Pill tone="warning" size="sm" mono>
                    {c.fromBranch}
                  </Pill>
                )}
                <span className={styles.age}>{formatAge(c.committedAt)}</span>
              </button>,
            ];
          })}
        </div>
      )}
    </div>
  );
}

/** Unmerged files outside an operation in progress (a stash apply that conflicted), in every mode;
 * a stopped rebase or merge has its own banner. */
export function conflictsBanner(groups: ReviewGroup[]): string | null {
  const hit = groups.filter((g) => g.entry.conflicts > 0 && !g.entry.operation);
  const n = hit.reduce((s, g) => s + g.entry.conflicts, 0);
  if (n === 0) return null;
  const files = n === 1 ? '1 file has merge conflicts' : `${n} files have merge conflicts`;
  const where = hit.length > 1 ? ` in ${hit.length} entries` : '';
  return `${files}${where}. Resolve ${n === 1 ? 'it' : 'them'} in your editor or terminal; Gitgel shows the conflict markers in the Uncommitted layer.`;
}

function notReviewable(entry: EntrySummary | undefined): string {
  if (!entry) return '';
  switch (entry.state) {
    case 'branch_deleted':
      return 'This Branch No Longer Exists';
    case 'repo_missing':
      return 'Repository Not Found';
    case 'base_missing':
      return entry.error ? `Base Missing: ${entry.error}` : 'Base Missing';
    default:
      return entry.error ?? 'Nothing to Review';
  }
}

