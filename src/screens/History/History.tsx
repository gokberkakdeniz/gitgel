import { useEffect, useMemo, useRef, useState } from 'react';
import { BackIcon, BranchIcon, CheckIcon, ChevronDownIcon, CopyIcon, ForwardIcon, SidebarIcon } from '../../components/icons';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu, MenuItem, MenuLabel } from '../../components/Menu';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { SyncButtons } from '../../sync/SyncButtons';
import { divergedBanner, pullBranch, syncState, type SyncTarget } from '../../sync/sync';
import { StashBar } from '../../stash/StashBar';
import { useStashAction } from '../../stash/StashAction';
import { PageMenu } from '../../components/PageMenu';
import { rescanAll } from '../../lib/events';
import { formatAge, plural } from '../../lib/format';
import { getCommitChanges, getHistory, getHistoryRefs, getReview, getStashChanges } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import type { CommitChanges, EntrySummary, FileChange, HistoryCommit, StashChanges } from '../../lib/types';
import { useCopy } from '../../lib/useCopy';
import { useInvoke } from '../../lib/useInvoke';
import { next, prev } from '../../monaco/changeNav';
import { DiffView, type DiffNav, type NavInfo } from '../../monaco/DiffView';
import { useEntryFolder, useRepoFolder } from '../../components/OpenItems';
import { useData } from '../../state/data';
import { selectCanForward, selectRoute, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { ChangeNav, FileRow, useDiffView, useSidebarHiddenWhileMounted, useSwitchTo, ViewMenu } from '../Review/parts';
import { StashSection } from '../Review/Review';
import type { ReviewStash } from '../Review/stashes';
import review from '../Review/Review.module.css';
import styles from './History.module.css';
import { historyRows, initials, isBot, whenLabel, type HistoryRow } from './rows';

/** Commits asked for at a time; scrolling near the end asks for this many more. */
const PAGE = 200;
const WIP = 'wip';
/** A stash row's id in the list: `stash:<sha>`. */
const stashRow = (sha: string) => `stash:${sha}`;

interface Props {
  repoId: string;
  rev: string;
  backLabel: string;
}

/** A branch's commits, each shown on its own against its first parent (SPEC §16). */
export function History({ repoId, rev, backLabel }: Props) {
  useSidebarHiddenWhileMounted(true);
  const repoScan = useData((s) => s.scan[repoId]);
  const repoName = repoScan?.name ?? '';
  // The entry for this rev, when it is an active branch (or a detached worktree's SHA): its base
  // draws the base line, its worktree the Uncommitted row.
  const entry: EntrySummary | undefined = repoScan?.active.find(
    (e) => e.branch === rev || (e.branch === null && e.headSha === rev),
  );
  const base = entry?.base ?? null;
  // The files' right-click menu opens them from the worktree, else from the repository folder.
  const repoFolder = useRepoFolder(repoId);
  const entryFolder = useEntryFolder(entry);
  const folder = entry ? entryFolder : repoFolder;

  // Search, debounced; a new query starts again from the first page.
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [search]);
  const { data, error, loading } = useInvoke(
    () => getHistory(repoId, rev, base, search, limit),
    [repoId, rev, base, search, limit],
    { repoIds: [repoId] },
  );
  const commits = useMemo(() => data?.commits ?? [], [data]);

  // Uncommitted: a checked-out branch with changes in its working tree, never while searching.
  const wip = !search && !!entry?.worktreePath && (entry.uncommitted ?? 0) > 0;
  const { data: wipReview } = useInvoke(
    () =>
      getReview({
        kind: 'branch',
        repoId,
        branch: entry?.branch ?? null,
        worktreePath: entry?.worktreePath ?? null,
        tipOverride: null,
      }),
    [repoId, entry?.key],
    // Also while searching: the Stash button needs the files.
    { repoIds: [repoId], enabled: !!entry?.worktreePath && (entry.uncommitted ?? 0) > 0 },
  );
  const wipFiles = wipReview?.groups[0]?.files.uncommitted ?? [];

  // The stashes taken on this branch (§15), under the list; not while searching.
  const allStashes = repoScan?.stashes;
  const stashes: ReviewStash[] = useMemo(
    () =>
      search || !allStashes
        ? []
        : allStashes.filter((s) => s.branch === rev).map((s) => ({ ...s, repoId, repoName })),
    [search, allStashes, rev, repoId, repoName],
  );

  const rows = useMemo(
    () => historyRows(commits, { wip, base, ahead: data?.ahead ?? null, mergeBase: data?.mergeBase ?? null }),
    [commits, wip, base, data],
  );
  // The rows ↑ / ↓ step through, top to bottom: Uncommitted, then the commits. The stashes, in
  // their own section under the list (as in Review), are picked by click.
  const order = useMemo(() => [...(wip ? [WIP] : []), ...commits.map((c) => c.sha)], [wip, commits]);

  // The picked row: the one asked for while it is listed, else the newest commit.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [search]);
  const listed = (row: string) => order.includes(row) || stashes.some((s) => stashRow(s.sha) === row);
  const current = picked && listed(picked) ? picked : (commits[0]?.sha ?? (wip ? WIP : null));
  const commit = commits.find((c) => c.sha === current);
  const stash = stashes.find((s) => stashRow(s.sha) === current);

  // A commit's files are fetched once (a commit never changes).
  const [changes, setChanges] = useState<Record<string, CommitChanges>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!commit || requested.current.has(commit.sha)) return;
    requested.current.add(commit.sha);
    getCommitChanges(repoId, commit.sha).then(
      (c) => setChanges((d) => ({ ...d, [c.sha]: c })),
      (e) => {
        console.error('commit changes failed', e);
        requested.current.delete(commit.sha);
      },
    );
  }, [commit, repoId]);
  const commitChanges = commit ? changes[commit.sha] : undefined;

  // A stash's files, fetched once too (a stash never changes).
  const [stashData, setStashData] = useState<Record<string, StashChanges>>({});
  const stashRequested = useRef(new Set<string>());
  useEffect(() => {
    if (!stash || stashRequested.current.has(stash.sha)) return;
    stashRequested.current.add(stash.sha);
    getStashChanges(repoId, stash.sha).then(
      (c) => setStashData((d) => ({ ...d, [c.sha]: c })),
      (e) => {
        console.error('stash changes failed', e);
        stashRequested.current.delete(stash.sha);
      },
    );
  }, [stash, repoId]);
  const stashChanges = stash ? stashData[stash.sha] : undefined;
  const stashBase = stashChanges?.base ?? stash?.base ?? '';

  const files: FileChange[] =
    current === WIP ? wipFiles : stash ? (stashChanges?.files ?? []) : (commitChanges?.files ?? []);

  // The file shown: the one picked while the row lists it, else its first.
  const [path, setPath] = useState<string | null>(null);
  const file = files.find((f) => f.path === path) ?? files[0];
  const [land, setLand] = useState<'first' | 'last'>('first');
  // The picked row lists its files under it; clicking it again folds them (and back).
  const [filesOpen, setFilesOpen] = useState(true);
  const pick = (row: string) => {
    setPicked(row);
    setPath(null);
    setLand('first');
    setFilesOpen(true);
  };
  const click = (row: string) => (row === current ? setFilesOpen((o) => !o) : pick(row));

  // Stepping rows: ↑ / ↓ in the list, ⌥⇧↑ / ⌥⇧↓ anywhere. Past the loaded end it loads more.
  const stepRow = (dir: 1 | -1) => {
    if (!current) return;
    const i = order.indexOf(current);
    const j = i + dir;
    if (j >= 0 && j < order.length) pick(order[j]);
    else if (j >= order.length && data?.more) setLimit(commits.length + PAGE);
  };
  const stepRowRef = useRef(stepRow);
  stepRowRef.current = stepRow;

  // Changes inside the row's files (Review's change navigation).
  const fileIds = files.map((f) => f.path);
  const fileIndex = file ? fileIds.indexOf(file.path) : -1;
  const [nav, setNav] = useState<NavInfo>({ index: null, count: 0 });
  const diffNav = useRef<DiffNav | null>(null);
  const step = (dir: 1 | -1) => {
    const r = (dir > 0 ? next : prev)({ index: nav.index, count: nav.count, files: fileIds, fileIndex });
    if (r?.kind === 'hunk') diffNav.current?.goTo(r.index);
    if (r?.kind === 'file') {
      setPath(r.key);
      setLand(r.land);
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  // ⌥↓ / ⌥↑ (changes) and ⌥⇧↓ / ⌥⇧↑ (rows) outside the diff; inside it Monaco handles them.
  // Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.code !== 'ArrowDown' && e.code !== 'ArrowUp')) return;
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor, input, textarea')) return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      const dir = e.code === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) stepRowRef.current(dir);
      else stepRef.current(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌘K focuses the search (inside the diff Monaco handles it). Listed in lib/shortcuts.ts.
  const searchInput = useRef<HTMLInputElement>(null);
  const focusSearch = () => {
    searchInput.current?.focus();
    searchInput.current?.select();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key.toLowerCase() !== 'k' || useUi.getState().modalCount > 0) return;
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep the picked row in view when it changes from outside the list.
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 400;
    if (nearEnd && data?.more && !loading && limit <= commits.length) setLimit(commits.length + PAGE);
  };

  const { layout, ignoreWs, context, contextLines, saveView, toggleWs, viewRef } = useDiffView();
  const worktree = entry?.worktreePath ? tildifyHome(entry.worktreePath) : null;
  // A local branch syncs with its remote (W4a); `upstream` is set only for one.
  const syncTarget: SyncTarget = {
    repoId,
    repoName,
    branch: data?.upstream ? rev : null,
    worktreePath: entry?.worktreePath ?? null,
    upstream: data?.upstream ?? null,
  };
  const diverged = divergedBanner(syncTarget);
  const stashAction = useStashAction(wipReview?.groups ?? []);
  // Only an active branch (or a detached worktree's SHA) has a Review.
  const toReview = useSwitchTo(
    entry
      ? {
          name: 'review',
          target: { kind: 'branch', repoId, branch: entry.branch, worktreePath: entry.worktreePath, tipOverride: null },
          backLabel: 'Back to History',
        }
      : null,
  );
  const subtitle = [repoName, rev, worktree].filter(Boolean).join(' · ');

  let label = '';
  if (data?.tip) {
    label = search
      ? `${commits.length}${data.more ? '+' : ''} matching ${commits.length === 1 && !data.more ? 'commit' : 'commits'}`
      : `${rev} · ${plural(data.total ?? commits.length, 'commit', 'commits')}`;
  }

  return (
    <div className={review.screen}>
      <Header title="History" subtitle={subtitle} backLabel={backLabel}>
        <RefButton repoId={repoId} repoName={repoName} rev={rev} />
        <Input
          ref={searchInput}
          size={32}
          leftIcon="search"
          mono
          clearable
          className={styles.search}
          value={query}
          onChange={setQuery}
          placeholder="Search commits"
          aria-label="Search commit messages, SHAs and paths"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Input clears a filled field first; this second Esc leaves it.
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <SyncButtons target={syncTarget} fetchedAt={data?.fetchedAt ?? null} />
        <PageMenu>
          {(close, anchor) => (
            <>
              {entry?.worktreePath && stashAction.item(close, anchor)}
              {toReview && (
                <MenuItem
                  icon="split"
                  kbd="⌥H"
                  onSelect={() => {
                    close();
                    toReview();
                  }}
                >
                  Open review
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
            </>
          )}
        </PageMenu>
        {stashAction.dialog}
      </Header>
      {diverged && (
        <Banner tone="warning">
          <span className={review.grow}>{diverged}</span>
          {!syncState(syncTarget).pull && (
            <Button size={24} onClick={() => void pullBranch(syncTarget, true)}>
              Pull (rebase)
            </Button>
          )}
        </Banner>
      )}

      <div className={review.body}>
        <div className={styles.listPane}>
          <aside
            ref={list}
            role="listbox"
            aria-label="Commits"
            className={styles.list}
            onScroll={onScroll}
            onKeyDown={(e) => {
              if (e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
              e.preventDefault();
              stepRow(e.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            {label && <div className={styles.listLabel}>{label}</div>}
            {rows.map((r) => (
              <ListRow
                key={rowKey(r)}
                row={r}
                current={current}
                base={base}
                wipCount={entry?.uncommitted ?? 0}
              wipConflicts={entry?.conflicts ?? 0}
                wipAge={entry?.changedAt ?? null}
                files={filesOpen ? files : []}
                file={file?.path}
                folder={folder}
                onPick={click}
                onFile={(p) => {
                  setPath(p);
                  setLand('first');
                }}
              />
            ))}
            {data && !data.tip && <div className={styles.listEmpty}>{rev} not found</div>}
            {data?.tip && commits.length === 0 && !wip && (
              <div className={styles.listEmpty}>
                {search ? (
                  <>
                    <span>No commits match “{search}”</span>
                    <button type="button" className={review.linkButton} onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  </>
                ) : (
                  'No commits'
                )}
              </div>
            )}
          </aside>
          {stashes.length > 0 && (
            <div className={styles.stashPane}>
              <StashSection
                heading="Stashes of this branch"
                stashes={stashes}
                picked={stash?.sha}
                changes={filesOpen ? stashChanges : undefined}
                file={file?.path}
                divider={false}
                withRepo={false}
                onPick={(sha) => click(stashRow(sha))}
                onFile={(p) => {
                  setPath(p);
                  setLand('first');
                }}
              />
            </div>
          )}
        </div>

        <section className={review.main}>
          {error ? (
            <div className={review.empty}>{error.message}</div>
          ) : current === WIP ? (
            <WipHeader worktree={worktree} files={wipFiles} />
          ) : stash ? (
            <StashBar stash={stash} base={stashBase} />
          ) : commit ? (
            <CommitHeader commit={commit} changes={commitChanges} />
          ) : null}
          {!error && file && (current === WIP || commitChanges || stashChanges) && (
            <>
              <div className={review.fileBar}>
                <span className={review.filePath}>{file.path}</span>
                <span className={review.muted}>
                  {current === WIP
                    ? 'HEAD ↔ working tree'
                    : stash
                      ? `${stashBase.slice(0, 7)} ↔ stash@{${stash.index}}`
                      : `${commitChanges?.parent?.slice(0, 7) ?? 'empty tree'} ↔ ${commit?.shortSha}`}
                </span>
                {ignoreWs && (
                  <Pill tone="accent" title="Show whitespace changes (⌥W)" onClick={toggleWs}>
                    Whitespace ignored
                  </Pill>
                )}
                <span className={review.grow} />
                <ViewMenu
                  layout={layout}
                  ignoreWs={ignoreWs}
                  onLayout={(l) => saveView({ diffView: l })}
                  context={context}
                  contextLines={contextLines}
                  onContext={(c, lines) => saveView({ diffContext: c, diffContextLines: lines })}
                  onToggleWs={toggleWs}
                />
                <span className={review.barDivider} />
                <ChangeNav
                  onlyWhitespace={ignoreWs && !file.binary && (file.add ?? 0) + (file.del ?? 0) > 0}
                  nav={nav}
                  prevFile={fileIndex > 0 ? `\u0000${fileIds[fileIndex - 1]}` : undefined}
                  nextFile={fileIndex >= 0 && fileIndex < fileIds.length - 1 ? `\u0000${fileIds[fileIndex + 1]}` : undefined}
                  onStep={step}
                />
              </div>
              <DiffView
                repoId={repoId}
                worktreePath={current === WIP ? (entry?.worktreePath ?? null) : null}
                change={file}
                mode={current === WIP ? 'uncommitted' : 'committed'}
                fileKey={`${current}\u0000${file.path}`}
                land={land}
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
                onCommitStep={(dir) => stepRowRef.current(dir)}
                onFocusFilter={focusSearch}
              />
            </>
          )}
          {!error && (commitChanges || stashChanges) && files.length === 0 && current !== WIP && (
            <div className={review.empty}>No changes</div>
          )}
        </section>
      </div>
    </div>
  );
}

function rowKey(r: HistoryRow): string {
  switch (r.kind) {
    case 'commit':
      return r.commit.sha;
    case 'day':
      return `day:${r.label}`;
    default:
      return r.kind;
  }
}

/** Review's header layout: chrome while the sidebar is hidden, title and subtitle, actions. */
function Header({
  title,
  subtitle,
  backLabel,
  children,
}: {
  title: string;
  subtitle: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const setSidebarVisible = useUi((s) => s.setSidebarVisible);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  const canForward = useNav(selectCanForward);
  return (
    <header className={sidebarVisible ? review.header : `${review.header} ${review.bare}`} data-tauri-drag-region>
      {!sidebarVisible && (
        <div className={review.chrome} data-tauri-drag-region>
          <div className={review.lights} data-tauri-drag-region />
          <IconButton aria-label="Show sidebar" onClick={() => setSidebarVisible(true)}>
            <SidebarIcon />
          </IconButton>
          <IconButton aria-label={backLabel} onClick={back} className={review.back}>
            <BackIcon />
          </IconButton>
          <IconButton aria-label="Forward" onClick={forward} disabled={!canForward}>
            <ForwardIcon />
          </IconButton>
        </div>
      )}
      <div className={review.titles} data-tauri-drag-region>
        <span className={review.title} data-tauri-drag-region>
          {title}
        </span>
        <span className={review.subtitle} data-tauri-drag-region>
          {subtitle}
        </span>
      </div>
      <div className={review.grow} data-tauri-drag-region />
      <div className={review.actions}>{children}</div>
    </header>
  );
}

/** The branch button: the repo's local and remote-tracking branches; picking one shows its history. */
function RefButton({ repoId, repoName, rev }: { repoId: string; repoName: string; rev: string }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const { data } = useInvoke(() => getHistoryRefs(repoId), [repoId, !!at], { enabled: !!at });
  const choose = (name: string) => {
    setAt(null);
    const nav = useNav.getState();
    const route = selectRoute(nav);
    if (route.name === 'history' && name !== rev) nav.replace({ ...route, rev: name });
  };
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        title={`Pick a branch of ${repoName}`}
        className={at ? `${styles.refButton} ${styles.refButtonOpen}` : styles.refButton}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        <BranchIcon size={13} className={styles.refIcon} />
        <span className={styles.refName}>{rev}</span>
        <ChevronDownIcon size={10} className={styles.refChevron} />
      </button>
      {at && data && (
        <Popover anchorRect={at} width={280} alignRight onClose={() => setAt(null)}>
          <Menu aria-label="Branches" autoFocus>
            <MenuLabel>Local</MenuLabel>
            {data.branches.map((b) => (
              <MenuItem key={b} checked={b === rev} onSelect={() => choose(b)}>
                {b}
              </MenuItem>
            ))}
            {data.remotes.length > 0 && <MenuLabel>Remote</MenuLabel>}
            {data.remotes.map((b) => (
              <MenuItem key={b} checked={b === rev} onSelect={() => choose(b)}>
                {b}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
    </>
  );
}

function ListRow({
  row,
  current,
  base,
  wipCount,
  wipConflicts,
  wipAge,
  files,
  file,
  folder,
  onPick,
  onFile,
}: {
  row: HistoryRow;
  current: string | null;
  base: string | null;
  wipCount: number;
  wipConflicts: number;
  wipAge: number | null;
  /** The picked row's files, listed under it. */
  files: FileChange[];
  file: string | undefined;
  /** Where the files' right-click menu opens them from. */
  folder: string | null;
  onPick: (row: string) => void;
  onFile: (path: string) => void;
}) {
  const fileRows = (
    <div className={review.fileRows}>
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          folder={folder}
          terms={[]}
          on={f.path === file}
          onClick={() => onFile(f.path)}
        />
      ))}
    </div>
  );
  switch (row.kind) {
    case 'day':
      return <div className={styles.day}>{row.label}</div>;
    case 'base':
      return (
        <div className={styles.baseLine}>
          <div className={styles.baseRow}>
            <span className={styles.baseRule} />
            <span className={styles.baseLabel}>
              base {row.base}
              {row.mergeBase ? ` · ${row.mergeBase.slice(0, 7)}` : ''}
            </span>
            <span className={styles.baseRule} />
          </div>
          <span className={styles.baseSub}>Below: already in {base}</span>
        </div>
      );
    case 'wip': {
      const on = current === WIP;
      return (
        <>
          <button
            type="button"
            role="option"
            aria-selected={on}
            title="Show uncommitted changes (HEAD ↔ working tree)"
            className={on ? `${styles.wip} ${styles.rowOn}` : styles.wip}
            onClick={() => onPick(WIP)}
          >
            <span className={styles.wipSlot}>
              <span className={styles.wipDot} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.wipTitle}>Uncommitted changes</span>
              <span className={styles.meta}>
                {plural(wipCount, 'file', 'files')}
                {wipConflicts > 0 ? ` · ${wipConflicts === 1 ? '1 conflict' : `${wipConflicts} conflicts`}` : ''}
                {wipAge ? ` · ${formatAge(wipAge)}` : ''}
              </span>
            </span>
          </button>
          {on && fileRows}
        </>
      );
    }
    case 'commit': {
      const c = row.commit;
      const on = current === c.sha;
      const cls = [styles.commit, on && styles.rowOn, c.inBase && styles.shared].filter(Boolean).join(' ');
      return (
        <>
          <button type="button" role="option" aria-selected={on} title="Show this commit" className={cls} onClick={() => onPick(c.sha)}>
            <Avatar author={c.author} size={24} />
            <span className={styles.rowText}>
              <span className={styles.subjectLine}>
                <span className={styles.subject}>{c.subject}</span>
                {c.parents > 1 && (
                  <Pill tone="outline" size="sm">
                    merge
                  </Pill>
                )}
              </span>
              <span className={styles.metaLine}>
                <span className={styles.metaWho}>
                  {c.author} · {formatAge(c.committedAt)}
                </span>
                <span className={styles.sha}>{c.shortSha}</span>
              </span>
            </span>
          </button>
          {on && fileRows}
        </>
      );
    }
  }
}

function Avatar({ author, size }: { author: string; size: 18 | 24 }) {
  const cls = [styles.avatar, size === 18 && styles.avatarSmall, isBot(author) && styles.avatarBot].filter(Boolean).join(' ');
  return (
    <span className={cls} title={author} aria-hidden>
      {initials(author)}
    </span>
  );
}

function totals(files: FileChange[]) {
  return {
    add: files.reduce((n, f) => n + (f.add ?? 0), 0),
    del: files.reduce((n, f) => n + (f.del ?? 0), 0),
  };
}

/** Above a commit's diff: its subject, message and who / when / which. */
function CommitHeader({ commit: c, changes }: { commit: HistoryCommit; changes: CommitChanges | undefined }) {
  const t = changes ? totals(changes.files) : null;
  const { copied, copy } = useCopy();
  return (
    <div className={styles.head}>
      <div className={styles.headTop}>
        <span className={styles.headSubject} title={c.subject}>
          {c.subject}
        </span>
        <span className={review.grow} />
        <IconButton
          aria-label={copied ? 'Copied' : 'Copy SHA'}
          title={copied ? 'Copied' : 'Copy full SHA'}
          className={copied ? `${styles.copy} ${styles.copied}` : styles.copy}
          onClick={() => void copy(c.sha)}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </IconButton>
      </div>
      {c.body && <div className={styles.body}>{c.body}</div>}
      <div className={styles.headMeta}>
        <Avatar author={c.author} size={18} />
        <span className={styles.metaAuthor} title={c.authorEmail}>
          {c.author}
        </span>
        <span className={styles.dot}>·</span>
        <span>{whenLabel(c.committedAt)}</span>
        <span className={styles.dot}>·</span>
        <span className={styles.sha}>{c.shortSha}</span>
        {changes && (
          <>
            <span className={styles.dot}>·</span>
            <span>{changes.parent ? `parent ${changes.parent.slice(0, 7)}` : 'root commit'}</span>
            <span className={styles.dot}>·</span>
            <span>{plural(changes.files.length, 'file', 'files')}</span>
            <span className={review.add}>+{t!.add}</span>
            <span className={review.del}>−{t!.del}</span>
          </>
        )}
      </div>
    </div>
  );
}

function WipHeader({ worktree, files }: { worktree: string | null; files: FileChange[] }) {
  const t = totals(files);
  return (
    <div className={styles.head}>
      <div className={styles.headTop}>
        <span className={styles.headSubject}>Uncommitted changes</span>
      </div>
      <div className={styles.headMeta}>
        {worktree && (
          <>
            <span>{worktree}</span>
            <span className={styles.dot}>·</span>
          </>
        )}
        <span>{plural(files.length, 'file', 'files')}</span>
        <span className={review.add}>+{t.add}</span>
        <span className={review.del}>−{t.del}</span>
      </div>
    </div>
  );
}
