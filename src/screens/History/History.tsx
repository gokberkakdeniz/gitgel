import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu, MenuDivider, MenuItem } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { ResizeHandle, useStoredWidth } from '../../components/ResizeHandle';
import { askDiscard, targetOf } from '../../discard/discard';
import { usePicks } from '../../discard/picks';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { nameRun, startGitAction, showRunToast, useRuns } from '../../scripts/runs';
import { onGenerateFinished, providerLabel, providerOrder } from '../../lib/ai';
import { ScriptsMenu } from '../../scripts/ScriptsMenu';
import { conflictOf, useGitActionRunning } from '../../sync/operation';
import { OperationBanner } from '../../sync/OperationUi';
import { SyncButtons, SyncItems } from '../../sync/SyncButtons';
import { DeleteBranchItem } from '../../sync/DeleteBranch';
import { divergedBanner, forcePushBranch, pullBranch, syncState, type SyncTarget } from '../../sync/sync';
import { StashBar } from '../../stash/StashBar';
import { useStashAction } from '../../stash/StashAction';
import { PageMenu } from '../../components/PageMenu';
import { rescanAll } from '../../lib/events';
import { ageText, ageTitle, cnt, formatCount } from '../../lib/format';
import { t } from '../../i18n';
import { getAiStatus, getCommitChanges, getHistory, getRemoteUrl, getReview, getStagedPaths, getStashChanges, generateMessageStart, gitCommit, gitUndoCommit, openRemoteLink } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import type { AiStatus, AppError, CommitChanges, CommitFiles, CommitProvider, EntryRef, EntrySummary, FileChange, HistoryCommit, StashChanges } from '../../lib/types';
import { useCopy } from '../../lib/useCopy';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useInvoke } from '../../lib/useInvoke';
import { next, prev } from '../../monaco/changeNav';
import { commitUrl } from '../../monaco/reference';
import { DiffView, type DiffNav, type NavInfo } from '../../monaco/DiffView';
import { CopyBranchItem, EntryMenuNote, OpenItems, useEntryFolder, useRepoFolder } from '../../components/OpenItems';
import { useData } from '../../state/data';
import { type CommitDraft, commitDraftKey, EMPTY_COMMIT_DRAFT, useUi } from '../../state/ui';
import { DiffStat, FileBar, FileRow, StashSection, useDiffView, useSwitchTo, type FileActions } from '../Review/parts';
import parts from '../Review/parts.module.css';
import type { ReviewStash } from '../Review/stashes';
import styles from './History.module.css';
import { AmendModal } from './AmendModal';
import { CherryPickMenu, cherryTargets } from './CherryPickMenu';
import { CommitForm } from './CommitForm';
import { SwitchBranchDialog } from './SwitchBranch';
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
  const tip = data?.tip ?? null;

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

  // Commit (W1a): Uncommitted's files have boxes; the checked ones go into the commit. They start
  // as git's index has them (staged files checked), else every tracked file.
  const entryRef: EntryRef | null = entry
    ? { repoId, branch: entry.branch, worktreePath: entry.branch === null ? entry.worktreePath : null }
    : null;
  const { data: staged } = useInvoke(() => getStagedPaths(entryRef!), [repoId, entry?.key], {
    repoIds: [repoId],
    enabled: wip && !!entryRef,
  });
  const [boxes, setBoxes] = useState<Record<string, boolean>>({});
  useEffect(() => setBoxes({}), [repoId, rev]);
  const checked = (f: FileChange): boolean => {
    if (f.path in boxes) return boxes[f.path];
    if (staged && staged.length > 0) return staged.includes(f.path) || (!!f.oldPath && staged.includes(f.oldPath));
    return f.kind !== 'U';
  };
  // The form is kept per branch in the store, so leaving History and coming back keeps it.
  const draftKey = commitDraftKey(repoId, rev);
  const { summary, description, amending } = useUi((s) => s.commitDrafts[draftKey]) ?? EMPTY_COMMIT_DRAFT;
  const setDraft = (patch: Partial<CommitDraft>, key = draftKey) => useUi.getState().setCommitDraft(key, patch);
  const [askAmend, setAskAmend] = useState<HistoryCommit | null>(null);
  // Generate message (SPEC §15): the provider's CLI writes the form for the checked files.
  // The default is the topmost switched-on provider in menu order (Settings › AI).
  const ai = useData((s) => s.config?.settings.ai ?? null);
  // Whether each CLI is installed; null while unknown (nothing is disabled).
  const [aiStatus, setAiStatus] = useState<AiStatus[] | null>(null);
  useEffect(() => {
    if (ai && !ai.enabled) {
      setAiStatus(null);
      return;
    }
    void getAiStatus().then(setAiStatus, () => {});
  }, [ai?.enabled]);
  // The menu lists the switched-on and installed providers in menu order (all while
  // the install state is unknown).
  const enabledProviders = useMemo(
    () =>
      providerOrder(ai?.order ?? []).filter(
        (id) => ai === null || ai[id]?.enabled !== false,
      ),
    [ai],
  );
  const menuProviders = useMemo(
    () =>
      enabledProviders.filter(
        (id) => aiStatus === null || aiStatus.some((s) => s.id === id && s.installed),
      ),
    [enabledProviders, aiStatus],
  );
  // The bolt's provider: the menu's topmost; none when nothing switched on is installed.
  const provider = menuProviders[0] ?? null;
  const [generating, setGenerating] = useState(false);
  // The generation this form waits for; a late answer never unlocks a newer one.
  const genRun = useRef<string | null>(null);
  useEffect(() => {
    genRun.current = null;
    setGenerating(false);
  }, [repoId, rev]);
  // The commit running for this entry, and how the last one ended.
  const committing = useRuns((s) =>
    Object.values(s.runs).some((r) => r.scriptId === 'git:commit' && r.status === 'running' && r.entryKey === entry?.key),
  );
  const lastCommit = useRuns((s) =>
    Object.values(s.runs)
      .filter((r) => r.scriptId === 'git:commit' && r.entryKey === entry?.key)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0],
  );
  const commitFailed =
    !!lastCommit && lastCommit.status === 'exited' && lastCommit.exitCode !== 0 && !lastCommit.stopped;
  const included = wip ? wipFiles.filter(checked) : [];
  const commitNow = (files: CommitFiles) => {
    if (!entryRef) return;
    // Retry and Commit Without Hooks send the same files and message again.
    const again = (noVerify: boolean) => commitNow({ ...files, noVerify });
    const amend = !!files.amend;
    const name = amend ? t('amend.button') : t('history.commitBtn');
    const running = amend ? t('history.amending') : t('history.committing');
    void startGitAction(name, running, () => gitCommit(entryRef, files), {
      done: amend ? t('history.amended', { rev }) : t('history.committedTo', { rev }),
      onStart: (runId) => {
        const key = draftKey;
        // The form empties when the commit lands; a failed one keeps the message.
        const ended = () => {
          const r = useRuns.getState().runs[runId];
          if (!r || r.status === 'running') return false;
          if (r.status === 'exited' && r.exitCode === 0) {
            setDraft(EMPTY_COMMIT_DRAFT, key);
            setBoxes({});
          }
          return true;
        };
        if (ended()) return;
        const off = useRuns.subscribe(() => ended() && off());
      },
      again: {
        retry: () => again(false),
        skipHooks: files.noVerify ? undefined : () => again(true),
      },
    });
  };
  const commitChecked = () =>
    commitNow({
      include: included.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])),
      summary,
      description,
      noVerify: false,
      amend: amending?.sha ?? null,
    });
  const beginAmend = (c: HistoryCommit) => {
    setDraft({
      amending: amending ?? { sha: c.sha, short: c.shortSha, summary, description },
      summary: c.subject,
      description: c.body,
    });
    if (wip) pick(WIP);
  };
  // A commit already on the remote asks first (Settings › Prompts can turn that off).
  const startAmend = (c: HistoryCommit) => {
    const up = data?.upstream;
    const pushed = !!up?.name && up.ahead === 0;
    const ask = useData.getState().config?.settings.prompts.amendPushed !== false;
    if (pushed && ask) setAskAmend(c);
    else beginAmend(c);
  };
  // Undo Commit (Hi10): only the newest commit, one parent, not on the remote yet.
  const undoable = (c: HistoryCommit) =>
    c.sha === tip &&
    c.parents === 1 &&
    !!entry?.worktreePath &&
    !entry.operation &&
    !committing &&
    amending?.sha !== c.sha &&
    !(data?.upstream?.name && data.upstream.ahead === 0);
  const undoCommit = (c: HistoryCommit) => {
    if (!entryRef) return;
    const key = draftKey;
    void startGitAction(t('undo.act'), t('undo.running'), () => gitUndoCommit(entryRef, c.sha), {
      done: t('undo.done', { sha: c.shortSha }),
      onStart: (runId) => {
        // Its message comes back to an empty form, as in GitHub Desktop.
        const ended = () => {
          const r = useRuns.getState().runs[runId];
          if (!r || r.status === 'running') return false;
          const now = useUi.getState().commitDrafts[key] ?? EMPTY_COMMIT_DRAFT;
          if (r.status === 'exited' && r.exitCode === 0 && !now.summary && !now.description && !now.amending)
            setDraft({ summary: c.subject, description: c.body }, key);
          return true;
        };
        if (ended()) return;
        const off = useRuns.subscribe(() => ended() && off());
      },
    });
  };
  const stopAmend = () => {
    if (!amending) return;
    setDraft({ summary: amending.summary, description: amending.description, amending: null });
  };
  const generateChecked = (forced?: CommitProvider) => {
    if (!entryRef || generating) return;
    // From the menu: generate with the picked provider at once.
    const active = forced ?? provider;
    if (!active) return;
    // The answer fills the form of the branch it was asked on, never the one shown when it lands.
    const mine = draftKey;
    const stop = () => {
      genRun.current = null;
      setGenerating(false);
    };
    setGenerating(true);
    void generateMessageStart(
      entryRef,
      included.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])),
      active,
      amending?.sha ?? null,
    )
      .then((run) => {
        genRun.current = run.runId;
        const runs = useRuns.getState();
        nameRun(
          run.runId,
          t('history.genWith', { provider: providerLabel(active) }),
          t('history.generating', { provider: providerLabel(active) }),
        );
        runs.put(run);
        showRunToast(useRuns.getState().runs[run.runId]);
        const off = onGenerateFinished(run.runId, (r) => {
          off();
          if (genRun.current === run.runId) stop();
          // Its running toast is done, whatever took its place stays.
          const ui = useUi.getState();
          if (ui.toast?.owner === run.runId) ui.dismissToast();
          if (r.cancelled) return;
          if (r.error || !r.summary) {
            ui.showToast({ status: 'failed', message: r.error ?? t('history.noMessage') });
            return;
          }
          setDraft({ summary: r.summary, description: r.description ?? '' }, mine);
        });
      })
      .catch((e: unknown) => {
        stop();
        useUi.getState().showToast({ status: 'failed', message: (e as AppError).message });
      });
  };

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
    () => historyRows(commits, { wip, base, ahead: data?.ahead ?? null }),
    [commits, wip, base, data],
  );
  // The rows ↑ / ↓ step through, top to bottom: Uncommitted, then the commits. The stashes, in
  // their own section under the list (as in Review), are picked by click.
  const order = useMemo(() => [...(wip ? [WIP] : []), ...commits.map((c) => c.sha)], [wip, commits]);

  // The picked row: the one asked for while it is listed, else Uncommitted, else the newest commit.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [search]);
  const listed = (row: string) => order.includes(row) || stashes.some((s) => stashRow(s.sha) === row);
  const current = picked && listed(picked) ? picked : wip ? WIP : (commits[0]?.sha ?? null);
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
  // Several of Uncommitted's files picked with ⌘ / ⇧-click (Hi8): their right-click menu acts on
  // all of them.
  const picks = usePicks(
    current === WIP ? wipFiles.map((f) => f.path) : [],
    file?.path ?? null,
    `${repoId}\u0000${rev}\u0000${current}`,
  );
  const discard = (list: FileChange[], all = false) => {
    if (entry) askDiscard({ targets: [targetOf(entry, list)], all });
  };
  const wipActions = (f: FileChange): FileActions => {
    const list = wipFiles.filter((x) => picks.targets(f.path).includes(x.path));
    return {
      files: list.map((x) => ({ file: x, folder })),
      onDiscard: () => discard(list),
      onInclude: staged
        ? (on) => setBoxes((b) => ({ ...b, ...Object.fromEntries(list.map((x) => [x.path, on])) }))
        : undefined,
    };
  };
  // The Uncommitted row's right-click menu: Discard All Changes, Stash All Changes.
  const [wipMenu, setWipMenu] = useState<DOMRect | null>(null);
  // A commit row's right-click menu (Hi10): Amend Commit… on the newest one, Copy SHA.
  const [commitMenu, setCommitMenu] = useState<{ commit: HistoryCommit; at: DOMRect } | null>(null);
  // Cherry-Pick to's picker, beside its item (Hi11).
  const [cherrySub, setCherrySub] = useState<{ el: HTMLElement; focus?: boolean } | null>(null);
  useEffect(() => setCherrySub(null), [commitMenu]);
  const cherryTo = cherryTargets(repoScan?.active ?? [], entry);
  // HEAD moved under the form (a commit made elsewhere): amending would rewrite another commit.
  useEffect(() => {
    if (amending && tip && tip !== amending.sha && !committing) stopAmend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip]);
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

  // ⇧⌘B opens Switch Branch. Listed in lib/shortcuts.ts.
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.altKey || e.code !== 'KeyB') return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      setSwitching(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep the picked row in view when it changes from outside the list.
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  // And the picked file under it (next / previous change steps through them).
  useEffect(() => {
    listPane.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, file?.path]);
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 400;
    if (nearEnd && data?.more && !loading && limit <= commits.length) setLimit(commits.length + PAGE);
  };

  const view = useDiffView();
  const { layout, ignoreWs, context, contextLines, tabSize, viewRef } = view;
  // The list column's width once dragged; until then 380px.
  const listPane = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useStoredWidth('gitgel.historyListWidth');
  const worktree = entry?.worktreePath ? tildifyHome(entry.worktreePath) : null;
  // A local branch syncs with its remote (W4a); `upstream` is set only for one.
  const syncTarget: SyncTarget = {
    repoId,
    repoName,
    branch: data?.upstream ? rev : null,
    worktreePath: entry?.worktreePath ?? null,
    upstream: data?.upstream ?? null,
    operation: entry?.operation ?? null,
  };
  const diverged = divergedBanner(syncTarget);
  // Its buttons wait while a git action runs in the repository (one at a time).
  const gitBusy = useGitActionRunning(repoId);
  const stashAction = useStashAction(wipReview?.groups ?? []);
  // Only an active branch (or a detached worktree's SHA) has a Review.
  const toReview = useSwitchTo(
    entry
      ? {
          name: 'review',
          target: { kind: 'branch', repoId, branch: entry.branch, worktreePath: entry.worktreePath, tipOverride: null },
          backLabel: t('history.backToHistory'),
        }
      : null,
  );
  const subtitle = [repoName, rev, worktree].filter(Boolean).join(' · ');

  // Only a search has a label: the subtitle names the rev.
  const label =
    data?.tip && search
      ? t('history.searchLabel', {
          n: formatCount(commits.length) + (data.more ? '+' : ''),
          one: commits.length === 1 && !data.more ? '1' : '0',
        })
      : '';

  return (
    <div className={parts.screen}>
      <PageHeader title={t('history.title')} subtitle={subtitle} backLabel={backLabel}>
        <Input
          ref={searchInput}
          size={32}
          leftIcon="search"
          mono
          clearable
          className={styles.search}
          value={query}
          onChange={setQuery}
          placeholder={t('history.searchCommits')}
          aria-label={t('history.searchHint')}
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
              <MenuItem
                icon="branch"
                kbd="⇧⌘B"
                disabled={!repoScan}
                onSelect={() => {
                  close();
                  setSwitching(true);
                }}
              >
                {t('history.switchBranch')}
              </MenuItem>
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
                  {t('branches.openReview')}
                </MenuItem>
              )}
              <MenuItem
                icon="refresh"
                onSelect={() => {
                  close();
                  void rescanAll(true);
                }}
              >
                {t('review.refresh')}
              </MenuItem>
              {entry && (
                <>
                  <MenuDivider />
                  <CopyBranchItem entry={entry} onDone={close} />
                  <MenuDivider />
                  <OpenItems entry={entry} onDone={close} />
                  <SyncItems entry={entry} onDone={close} rebaseOnly />
                  <ScriptsMenu entry={entry} menu="branches" onDone={close} />
                  <DeleteBranchItem entry={entry} onDone={close} />
                  <EntryMenuNote entry={entry} />
                </>
              )}
            </>
          )}
        </PageMenu>
        {stashAction.dialog}
        {switching && repoScan && (
          <SwitchBranchDialog scan={repoScan} rev={rev} onClose={() => setSwitching(false)} />
        )}
      </PageHeader>
      {wipMenu && (
        <Popover anchorRect={wipMenu} width={230} onClose={() => setWipMenu(null)}>
          <Menu aria-label={t('history.wipActions')}>
            <MenuItem
              danger
              disabled={wipFiles.length === 0}
              onSelect={() => {
                setWipMenu(null);
                discard(wipFiles, true);
              }}
            >
              {t('history.discardAll')}
            </MenuItem>
            <MenuItem
              icon="package"
              disabled={!stashAction.open}
              onSelect={() => {
                setWipMenu(null);
                stashAction.open?.(wipMenu);
              }}
            >
              {t('history.stashAll')}
            </MenuItem>
          </Menu>
        </Popover>
      )}
      {commitMenu && (
        <Popover anchorRect={commitMenu.at} width={200} onClose={() => setCommitMenu(null)}>
          <Menu aria-label={t('history.commitMenu', { sha: commitMenu.commit.shortSha })}>
            {commitMenu.commit.sha === tip && entry?.worktreePath && (
              <>
                <MenuItem
                  icon="pencil"
                  disabled={committing || !!entry.operation || amending?.sha === commitMenu.commit.sha}
                  onHover={() => setCherrySub(null)}
                  onSelect={() => {
                    setCommitMenu(null);
                    startAmend(commitMenu.commit);
                  }}
                >
                  {t('amend.menuAmend')}
                </MenuItem>
              </>
            )}
            {undoable(commitMenu.commit) && (
              <MenuItem
                icon="undo"
                onHover={() => setCherrySub(null)}
                onSelect={() => {
                  setCommitMenu(null);
                  undoCommit(commitMenu.commit);
                }}
              >
                {t('undo.menu')}
              </MenuItem>
            )}
            {cherryTo.length > 0 && (
              <MenuItem
                icon="rebase"
                submenu
                onHover={(el) => setCherrySub({ el })}
                onSelect={(el) => setCherrySub({ el, focus: true })}
              >
                {t('cherry.menu')}
              </MenuItem>
            )}
            <MenuDivider />
            <MenuItem
              icon="copy"
              onHover={() => setCherrySub(null)}
              onSelect={() => {
                setCommitMenu(null);
                void writeText(commitMenu.commit.sha);
              }}
            >
              {t('history.menuCopySha')}
            </MenuItem>
          </Menu>
          {cherrySub && (
            <Popover
              anchor={cherrySub.el}
              anchorRect={cherrySub.el.getBoundingClientRect()}
              side="right"
              width={280}
              onClose={() => setCherrySub(null)}
            >
              <div
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  cherrySub.el.focus();
                  setCherrySub(null);
                }}
              >
                <CherryPickMenu
                  repoId={repoId}
                  commit={commitMenu.commit}
                  targets={cherryTo}
                  autoFocus={!!cherrySub.focus}
                  onDone={() => setCommitMenu(null)}
                />
              </div>
            </Popover>
          )}
        </Popover>
      )}
      {askAmend && (
        <AmendModal onClose={() => setAskAmend(null)} onBegin={() => beginAmend(askAmend)} />
      )}
      {entry?.operation && <OperationBanner entry={entry} op={entry.operation} names={false} />}
      {/* Mid-rebase the branch only looks diverged. */}
      {diverged && !entry?.operation && (
        <Banner tone="warning">
          <span className={parts.grow}>{diverged}</span>
          {!syncState(syncTarget).pull && (
            <Button
              size={24}
              disabled={gitBusy}
              title={gitBusy ? t('sync.gitBusy') : undefined}
              onClick={() => void pullBranch(syncTarget, true)}
            >
              {t('history.pullRebase')}
            </Button>
          )}
          <Button
            size={24}
            disabled={gitBusy}
            title={gitBusy ? t('sync.gitBusy') : undefined}
            onClick={() => void forcePushBranch(syncTarget)}
          >
            {t('history.forcePush')}
          </Button>
        </Banner>
      )}

      <div className={parts.body}>
        <div ref={listPane} className={styles.listPane} style={listWidth ? { width: listWidth } : undefined}>
          <aside
            ref={list}
            role="listbox"
            aria-label={t('history.commitsList')}
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
                wipCount={entry?.uncommitted ?? 0}
              wipConflicts={entry?.conflicts ?? 0}
                wipAge={entry?.changedAt ?? null}
                files={filesOpen ? files : []}
                file={file?.path}
                folder={folder}
                wipFailed={commitFailed}
                check={
                  current === WIP && staged
                    ? { on: checked, disabled: committing, onChange: (f, on) => setBoxes((b) => ({ ...b, [f.path]: on })),
                        onAll: (on) => setBoxes(Object.fromEntries(wipFiles.map((f) => [f.path, on]))),
                      }
                    : undefined
                }
                onPick={click}
                onFile={(p) => {
                  setPath(p);
                  setLand('first');
                }}
                picks={current === WIP ? picks : undefined}
                actions={current === WIP ? wipActions : undefined}
                conflict={current === WIP && entry ? (f) => conflictOf(entry, f) : undefined}
                onWipMenu={setWipMenu}
                onCommitMenu={(commit, at) => setCommitMenu({ commit, at })}
                amending={amending?.sha ?? null}
              />
            ))}
            {data && !data.tip && <div className={styles.listEmpty}>{t('history.revNotFound', { rev })}</div>}
            {data?.tip && commits.length === 0 && !wip && (
              <div className={styles.listEmpty}>
                {search ? (
                  <>
                    <span>{t('history.noMatch', { q: search })}</span>
                    <button type="button" className={parts.linkButton} onClick={() => setQuery('')}>
                      {t('history.clearSearch')}
                    </button>
                  </>
                ) : (
                  t('history.noCommits')
                )}
              </div>
            )}
          </aside>
          {stashes.length > 0 && (
            <div className={styles.stashPane}>
              <StashSection
                heading={t('review.stashOfBranch')}
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
          {((current === WIP && wip) || amending) && (
            <CommitForm
              rev={rev}
              summary={summary}
              description={description}
              files={included.length}
              amend={amending?.short ?? null}
              committing={committing}
              blocked={
                wip && !staged
                  ? t('history.readingIndex')
                  : (entry?.conflicts ?? 0) > 0
                    ? t('history.resolveFirst')
                    : null
              }
              provider={provider}
              providers={menuProviders}
              generating={generating}
              aiEnabled={ai?.enabled ?? true}
              onSummary={(value) => setDraft({ summary: value })}
              onDescription={(value) => setDraft({ description: value })}
              onCommit={commitChecked}
              onStopAmend={stopAmend}
              onGenerate={generateChecked}
            />
          )}
        </div>
        <ResizeHandle pane={listPane} min={280} max={640} onResize={setListWidth} onReset={() => setListWidth(null)} label={t('history.resizeList')} />

        <section className={parts.main}>
          {error ? (
            <div className={parts.empty}>{error.message}</div>
          ) : current === WIP ? (
            <WipHeader files={wipFiles} />
          ) : stash ? (
            <StashBar stash={stash} base={stashBase} />
          ) : commit ? (
            <CommitHeader repoId={repoId} commit={commit} changes={commitChanges} />
          ) : null}
          {!error && file && (current === WIP || commitChanges || stashChanges) && (
            <>
              <FileBar
                file={file}
                label={
                  current === WIP
                    ? t('review.headToTree')
                    : stash
                      ? `${stashBase.slice(0, 7)} ↔ stash@{${stash.index}}`
                      : `${commitChanges?.parent?.slice(0, 7) ?? t('review.emptyTree')} ↔ ${commit?.shortSha}`
                }
                view={view}
                nav={nav}
                prevFile={fileIndex > 0 ? `\u0000${fileIds[fileIndex - 1]}` : undefined}
                nextFile={fileIndex >= 0 && fileIndex < fileIds.length - 1 ? `\u0000${fileIds[fileIndex + 1]}` : undefined}
                onStep={step}
              />
              <DiffView
                repoId={repoId}
                worktreePath={current === WIP ? (entry?.worktreePath ?? null) : null}
                folder={folder}
                commit={commit?.sha ?? null}
                parent={commitChanges?.parent ?? null}
                change={file}
                mode={current === WIP ? 'uncommitted' : 'committed'}
                fileKey={`${current}\u0000${file.path}`}
                land={land}
                onNav={setNav}
                onStep={(dir) => stepRef.current(dir)}
                navRef={diffNav}
                layout={layout}
                ignoreWhitespace={ignoreWs}
                tabSize={tabSize}
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
            <div className={parts.empty}>{t('history.noChanges')}</div>
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

function ListRow({
  row,
  current,
  wipCount,
  wipConflicts,
  wipAge,
  files,
  file,
  folder,
  wipFailed,
  check,
  onPick,
  onFile,
  picks,
  actions,
  onWipMenu,
  onCommitMenu,
  amending,
  conflict,
}: {
  row: HistoryRow;
  current: string | null;
  wipCount: number;
  wipConflicts: number;
  wipAge: number | null;
  /** The picked row's files, listed under it. */
  files: FileChange[];
  file: string | undefined;
  /** Where the files' right-click menu opens them from. */
  folder: string | null;
  /** Uncommitted: the last commit failed. */
  wipFailed: boolean;
  /** Uncommitted's boxes (W1a), when it is picked. */
  check?: {
    on: (f: FileChange) => boolean;
    disabled: boolean;
    onChange: (f: FileChange, on: boolean) => void;
    /** Check or uncheck every file. */
    onAll: (on: boolean) => void;
  };
  onPick: (row: string) => void;
  onFile: (path: string) => void;
  /** Uncommitted's files picked with ⌘ / ⇧-click (Hi8). */
  picks?: { isPicked: (path: string) => boolean; click: (path: string, e: React.MouseEvent, open: () => void) => void };
  /** Uncommitted's file menu. */
  actions?: (f: FileChange) => FileActions;
  /** A right-click on the Uncommitted row, at the pointer. */
  onWipMenu: (at: DOMRect) => void;
  /** A right-click on a commit row, at the pointer. */
  onCommitMenu: (commit: HistoryCommit, at: DOMRect) => void;
  /** The commit being amended (Hi10): its row says so. */
  amending: string | null;
  /** Uncommitted's conflicted files of an operation in progress: ⚠ / ✓ (T4). */
  conflict?: (f: FileChange) => 'unresolved' | 'resolved' | undefined;
}) {
  const fileRows = (
    <div className={parts.fileRows}>
      {check && files.length > 0 && (
        <div className={parts.selectAll}>
          <Checkbox
            checked={files.every(check.on)}
            mixed={!files.every(check.on) && files.some(check.on)}
            disabled={check.disabled}
            label={files.every(check.on) ? t('history.unselectAll') : t('history.selectAll')}
            onChange={(e) => check.onAll(e.target.checked)}
          />
        </div>
      )}
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          folder={folder}
          terms={[]}
          on={f.path === file}
          picked={picks?.isPicked(f.path)}
          onClick={(e) => (picks ? picks.click(f.path, e, () => onFile(f.path)) : onFile(f.path))}
          actions={actions?.(f)}
          conflict={conflict?.(f)}
          check={
            check && { checked: check.on(f), disabled: check.disabled, onChange: (on) => check.onChange(f, on) }
          }
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
            <span className={styles.baseLabel}>{t('branches.baseName', { base: row.base })}</span>
            <span className={styles.baseRule} />
          </div>
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
            title={t('history.showWip')}
            className={on ? `${styles.wip} ${styles.rowOn}` : styles.wip}
            onClick={() => onPick(WIP)}
            onContextMenu={(e) => {
              e.preventDefault();
              onWipMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
            }}
          >
            <span className={styles.wipSlot}>
              <span className={styles.wipDot} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.subjectLine}>
                <span className={styles.wipTitle}>{t('history.wipTitle')}</span>
                {wipFailed && (
                  <Pill tone="danger" size="sm">
                    {t('history.commitFailed')}
                  </Pill>
                )}
              </span>
              <span className={styles.meta}>
                {t('branches.fileCount', { ...cnt(wipCount) })}
                {wipConflicts > 0 ? ` · ${t('branches.conflictCount', { ...cnt(wipConflicts) })}` : ''}
                {wipAge ? ` · ${ageText(wipAge)}` : ''}
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
          <button
            type="button"
            role="option"
            aria-selected={on}
            title={t('history.showCommit')}
            className={cls}
            onClick={() => onPick(c.sha)}
            onContextMenu={(e) => {
              e.preventDefault();
              onCommitMenu(c, new DOMRect(e.clientX, e.clientY, 0, 0));
            }}
          >
            <Avatar author={c.author} size={24} />
            <span className={styles.rowText}>
              <span className={styles.subjectLine}>
                <span className={styles.subject}>{c.subject}</span>
                {c.parents > 1 && (
                  <Pill tone="outline" size="sm">
                    {t('history.merge')}
                  </Pill>
                )}
                {amending === c.sha && (
                  <Pill tone="accent" size="sm">
                    {t('history.amendingPill')}
                  </Pill>
                )}
              </span>
              <span className={styles.metaLine}>
                <span className={styles.metaWho} title={c.committedAt ? ageTitle(c.committedAt) : undefined}>
                  {c.author} · {ageText(c.committedAt)}
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

/** A short SHA that opens the commit on the remote; the text stays selectable, so it copies. */
function ShaLink({ repoId, sha, short }: { repoId: string; sha: string; short: string }) {
  const { data: remote } = useInvoke(() => getRemoteUrl(repoId), [repoId]);
  if (!remote) {
    return (
      <span className={`${styles.sha} selectable`} title={sha}>
        {short}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.sha} ${styles.shaLink} selectable`}
      title={t('history.openRemote')}
      onClick={(e) => {
        // A drag that selects the hash should not open the link.
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
        void openRemoteLink(commitUrl(remote, sha)).catch((e) => console.error('cannot open link', e));
      }}
    >
      {short}
    </button>
  );
}

/** Above a commit's diff: its subject, message and who / when / which. */
function CommitHeader({
  repoId,
  commit: c,
  changes,
}: {
  repoId: string;
  commit: HistoryCommit;
  changes: CommitChanges | undefined;
}) {
  const stat = changes ? totals(changes.files) : null;
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();
  return (
    <div
      ref={headRef}
      className={styles.head}
      onCopy={(e) => {
        // A hand selection across the header copies as one line: flex items would
        // otherwise paste with a line break each.
        const sel = window.getSelection();
        const el = headRef.current;
        if (!sel || !el || !e.clipboardData) return;
        if (!el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return;
        // Within the body alone, its own line breaks stay.
        if (bodyRef.current?.contains(sel.anchorNode) && bodyRef.current.contains(sel.focusNode)) return;
        const text = sel.toString();
        if (!text.includes('\n')) return;
        e.preventDefault();
        const d = new Date(c.committedAt * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        e.clipboardData.setData(
          'text/plain',
          text
            .replace(whenLabel(c.committedAt), stamp)
            .replace(/·/g, '-')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/ {2,}/g, ' ')
            .trim(),
        );
      }}
    >
      <div className={parts.entryLine}>
        <span className={`${parts.barTitle} selectable`} title={c.subject}>
          {c.subject}
        </span>
      </div>
      {c.body && (
        <div ref={bodyRef} className={`${styles.body} selectable`}>
          {c.body}
        </div>
      )}
      <div className={`${parts.barMeta} selectable`}>
        <Avatar author={c.author} size={18} />
        <span className={styles.metaAuthor} title={c.authorEmail}>
          {c.author}
        </span>
        <span className={parts.dot}>·</span>
        <span>{whenLabel(c.committedAt)}</span>
        <span className={parts.dot}>·</span>
        <span className={styles.shaGroup}>
          <ShaLink repoId={repoId} sha={c.sha} short={c.shortSha} />
          <IconButton
            size={24}
            aria-label={copied ? t('history.copied') : t('history.copySha')}
            title={copied ? t('history.copied') : t('history.copySha')}
            className={copied ? styles.copied : undefined}
            onClick={() => void copy(c.sha)}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </IconButton>
        </span>
        {changes && (
          <>
            <span className={parts.dot}>·</span>
            <span>{t('branches.fileCount', { ...cnt(changes.files.length) })}</span>
            <DiffStat add={stat!.add} del={stat!.del} />
          </>
        )}
      </div>
    </div>
  );
}

// The worktree path is already in the page subtitle.
function WipHeader({ files }: { files: FileChange[] }) {
  const stat = totals(files);
  return (
    <div className={styles.head}>
      <div className={parts.entryLine}>
        <span className={parts.barTitle}>{t('history.wipTitle')}</span>
      </div>
      <div className={parts.barMeta}>
        <span>{t('branches.fileCount', { ...cnt(files.length) })}</span>
        <DiffStat add={stat.add} del={stat.del} />
      </div>
    </div>
  );
}
