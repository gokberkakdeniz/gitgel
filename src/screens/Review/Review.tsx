import { useEffect, useMemo, useRef, useState } from 'react';
import { BranchIcon, CheckIcon, ChevronDownIcon, CopyIcon, Icon } from '../../components/icons';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu, MenuDivider, MenuItem, MenuLabel } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { ResizeHandle, useStoredWidth } from '../../components/ResizeHandle';
import { askDiscard, targetOf } from '../../discard/discard';
import { range, toggled, usePicks } from '../../discard/picks';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { startGitAction, useRuns } from '../../scripts/runs';
import { providerOrder } from '../../lib/ai';
import { ScriptsMenu } from '../../scripts/ScriptsMenu';
import { conflictOf, conflictsTooltip, useGitActionRunning } from '../../sync/operation';
import { OperationBanner, OperationPill } from '../../sync/OperationUi';
import { SyncButtons, SyncItems } from '../../sync/SyncButtons';
import { DeleteBranchItem } from '../../sync/DeleteBranch';
import { divergedBanner, forcePushBranch, pullBranch, syncState, upstreamLabel, upstreamTitle, type SyncTarget } from '../../sync/sync';
import { StashBar } from '../../stash/StashBar';
import { useStashAction } from '../../stash/StashAction';
import { PageMenu } from '../../components/PageMenu';
import { rescanAll } from '../../lib/events';
import { ageText, ageTitle, cnt, formatCount } from '../../lib/format';
import { t } from '../../i18n';
import { getAiStatus, getCommitChanges, getHistory, getRangeChanges, getIndexChanges, getRemoteUrl, getReview, getStashChanges, generateMessageStart, gitCommit, gitRevert, gitSquash, gitUndoCommit, openRemoteLink } from '../../lib/ipc';
import { isTextField } from '../../lib/shortcuts';
import { basename, tildifyHome } from '../../lib/paths';
import type { AiStatus, CommitChanges, CommitFiles, CommitProvider, EntryRef, EntrySummary, FileChange, HistoryCommit, RangeChanges, ReviewGroup, ReviewTarget, StashChanges } from '../../lib/types';
import { useCopy } from '../../lib/useCopy';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useInvoke } from '../../lib/useInvoke';
import { next, prev } from '../../monaco/changeNav';
import { commitUrl } from '../../monaco/reference';
import { DiffView, type DiffNav, type NavInfo } from '../../monaco/DiffView';
import { CopyBranchItem, EntryMenuNote, OpenItems, useEntryFolder, useRepoFolder } from '../../components/OpenItems';
import { useData } from '../../state/data';
import { type CommitDraft, commitDraftKey, EMPTY_COMMIT_DRAFT, useUi } from '../../state/ui';
import { DiffStat, FileBar, FileRow, StashSection, useDiffView, type FileActions } from './parts';
import parts from './parts.module.css';
import { reviewStashes, type ReviewStash } from './stashes';
import { editProject, ReviewHeader } from './header';
import { conflictsBanner } from './banners';
import styles from './Review.module.css';
import { AmendModal } from './AmendModal';
import { CherryPickMenu, cherryTargets } from './CherryPickMenu';
import { CommitForm } from './CommitForm';
import { generateMessage } from './generate';
import { SquashModal } from './SquashModal';
import { requestStage, useStage, withMoves, type StageOp, type StageTo } from './stage';
import { SwitchBranchDialog } from './SwitchBranch';
import { historyRows, initials, isBot, lineRows, whenLabel, type HistoryRow } from './rows';

/** Commits asked for at a time; scrolling near the end asks for this many more. */
const PAGE = 200;
const WIP = 'wip';
/** A stash row's id in the list: `stash:<sha>`. */
const stashRow = (sha: string) => `stash:${sha}`;

interface Props {
  repoId: string;
  rev: string;
  backLabel: string;
  /** A deleted branch's last tip (`rev` is its SHA): the subtitle names the branch and says so. */
  lastKnown?: { branch: string | null };
  /** Project scope (SPEC §5): this branch is the project's open entry. */
  project?: ProjectScope;
}

/** A project's review around its open entry (SPEC §5, project scope). */
export interface ProjectScope {
  projectId: string;
  projectName: string;
  /** Every reviewable entry, in project order (the open one too). */
  groups: ReviewGroup[];
  notInReview: number;
  onOpen: (key: string) => void;
  /** The row picked when this entry was open before, while the screen is open. */
  pick: { get: () => string | null; set: (row: string | null) => void };
}

/** Review of one branch (SPEC §5, branch scope): the rev the target names, else its branch, else
 * the SHA a detached worktree is on. */
export function BranchReview({ target, backLabel }: { target: Extract<ReviewTarget, { kind: 'branch' }>; backLabel: string }) {
  const headSha = useData((s) =>
    target.worktreePath ? s.scan[target.repoId]?.active.find((e) => e.worktreePath === target.worktreePath)?.headSha : undefined,
  );
  const rev = target.rev ?? target.tipOverride ?? target.branch ?? headSha ?? null;
  if (!rev) return null;
  return (
    <BranchView
      repoId={target.repoId}
      rev={rev}
      backLabel={backLabel}
      lastKnown={target.tipOverride ? { branch: target.branch } : undefined}
    />
  );
}

/** A project's review (SPEC §5, project scope): one entry open at a time, the one a project row
 * asked for, else the first; each keeps its picked row while the screen is open. */
export function ProjectReview({ projectId, backLabel, focusKey }: { projectId: string; backLabel: string; focusKey?: string }) {
  const projects = useData((s) => s.config?.projects);
  const project = projects?.find((p) => p.id === projectId);
  const repoIds = useMemo(() => [...new Set(project?.entries.map((e) => e.repoId) ?? [])], [project]);
  const { data, error } = useInvoke(() => getReview({ kind: 'project', projectId }), [projectId], { repoIds, onConfig: true });
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const [openKey, setOpenKey] = useState<string | null>(focusKey ?? null);
  const picks = useRef(new Map<string, string | null>());
  const open = groups.find((g) => g.entry.key === openKey) ?? groups[0];
  const scope = useMemo<ProjectScope | null>(
    () =>
      open
        ? {
            projectId,
            projectName: project?.name ?? '',
            groups,
            notInReview: data?.notInReview.length ?? 0,
            onOpen: setOpenKey,
            pick: {
              get: () => picks.current.get(open.entry.key) ?? null,
              set: (row) => picks.current.set(open.entry.key, row),
            },
          }
        : null,
    [open, projectId, project?.name, groups, data],
  );
  const rev = open ? (open.entry.branch ?? open.entry.headSha) : null;
  if (!open || !scope || !rev)
    return (
      <div className={parts.screen}>
        <ReviewHeader entry={undefined} target={{ kind: 'project', projectId }} backLabel={backLabel} stashes={[]}>
          {null}
        </ReviewHeader>
        {(data || error) && <div className={parts.empty}>{error?.message ?? t('review.nothingToReview')}</div>}
      </div>
    );
  return <BranchView key={open.entry.key} repoId={open.entry.repoId} rev={rev} backLabel={backLabel} project={scope} />;
}

/** A repository's stash stack (SPEC §5, stash scope), opened from Branches: the stashes are the
 * list column, the picked one (the one asked for, else the newest) on the right. */
export function StashReview({ repoId, backLabel, focusKey }: { repoId: string; backLabel: string; focusKey?: string }) {
  const projects = useData((s) => s.config?.projects);
  const scans = useData((s) => s.scan);
  const repos = useData((s) => s.config?.repos);
  const stashes = useMemo(() => reviewStashes({ kind: 'stashes', repoId }, projects, scans), [repoId, projects, scans]);
  const [picked, setPicked] = useState<string | null>(focusKey ?? null);
  const stash = stashes.find((x) => x.sha === picked) ?? stashes[0];
  const [data, setData] = useState<Record<string, StashChanges>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!stash || requested.current.has(stash.sha)) return;
    requested.current.add(stash.sha);
    getStashChanges(stash.repoId, stash.sha).then(
      (c) => setData((d) => ({ ...d, [c.sha]: c })),
      (e) => {
        console.error('stash changes failed', e);
        requested.current.delete(stash.sha);
      },
    );
  }, [stash]);
  const changes = stash ? data[stash.sha] : undefined;
  const base = changes?.base ?? stash?.base ?? '';
  const files = changes?.files ?? [];
  const [path, setPath] = useState<string | null>(null);
  const fileIndex = Math.max(0, files.findIndex((f) => f.path === path));
  const file = files[fileIndex];
  const [land, setLand] = useState<'first' | 'last'>('first');
  const [nav, setNav] = useState<NavInfo>({ index: null, count: 0 });
  const diffNav = useRef<DiffNav | null>(null);
  const ids = files.map((f) => f.path);
  const step = (dir: 1 | -1) => {
    const r = (dir > 0 ? next : prev)({ index: nav.index, count: nav.count, files: ids, fileIndex });
    if (r?.kind === 'hunk') diffNav.current?.goTo(r.index);
    if (r?.kind === 'file') {
      setPath(r.key);
      setLand(r.land);
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const view = useDiffView();
  const listPane = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useStoredWidth('gitgel.historyListWidth');
  const pick = (sha: string) => {
    setPicked(sha);
    setPath(null);
    setLand('first');
  };
  return (
    <div className={parts.screen}>
      <ReviewHeader entry={undefined} target={{ kind: 'stashes', repoId }} backLabel={backLabel} stashes={stashes}>
        <PageMenu>
          {(close) => (
            <MenuItem
              icon="refresh"
              onSelect={() => {
                close();
                void rescanAll(true);
              }}
            >
              {t('review.refresh')}
            </MenuItem>
          )}
        </PageMenu>
      </ReviewHeader>
      <div className={parts.body}>
        <div ref={listPane} className={styles.listPane} style={listWidth ? { width: listWidth } : undefined}>
          <div className={styles.stashStack}>
            {stashes.length > 0 && (
              <StashSection
                heading={t('review.stashInRepo', { repo: stashes[0].repoName })}
                stashes={stashes}
                picked={stash?.sha}
                changes={changes}
                file={file?.path}
                divider={false}
                withRepo={false}
                onPick={pick}
                onFile={(p) => {
                  setPath(p);
                  setLand('first');
                }}
              />
            )}
          </div>
        </div>
        <ResizeHandle pane={listPane} min={280} max={640} onResize={setListWidth} onReset={() => setListWidth(null)} label={t('history.resizeList')} />
        <section className={parts.main}>
          {!stash ? (
            <div className={parts.empty}>{t('review.noStashes')}</div>
          ) : (
            <>
              <StashBar stash={stash} base={base} />
              {file ? (
                <>
                  <FileBar
                    file={file}
                    label={`${base.slice(0, 7)} ↔ stash@{${stash.index}}`}
                    view={view}
                    nav={nav}
                    prevFile={fileIndex > 0 ? `\u0000${ids[fileIndex - 1]}` : undefined}
                    nextFile={fileIndex < ids.length - 1 ? `\u0000${ids[fileIndex + 1]}` : undefined}
                    onStep={step}
                  />
                  <DiffView
                    repoId={stash.repoId}
                    worktreePath={null}
                    folder={repos?.find((r) => r.id === stash.repoId)?.path ?? null}
                    commit={null}
                    parent={null}
                    change={file}
                    mode="committed"
                    fileKey={`${stash.sha}\u0000${file.path}`}
                    land={land}
                    onNav={setNav}
                    onStep={(dir) => stepRef.current(dir)}
                    navRef={diffNav}
                    layout={view.layout}
                    ignoreWhitespace={view.ignoreWs}
                    tabSize={view.tabSize}
                    onToggleLayout={() => view.viewRef.current.toggleLayout()}
                    onToggleWhitespace={() => view.viewRef.current.toggleWs()}
                    context={view.context}
                    contextLines={view.contextLines}
                    onToggleContext={() => view.viewRef.current.toggleContext()}
                    onCommitStep={() => {}}
                    onFocusFilter={() => {}}
                  />
                </>
              ) : (
                changes && <div className={parts.empty}>{t('review.noChanges')}</div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** One branch's Review (SPEC §5, §16): its log, Uncommitted and stashes on the left, the picked
 * row's files and diff on the right. */
export function BranchView({ repoId, rev, backLabel, lastKnown, project }: Props) {
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

  // Commit (W1a): Uncommitted's files in Staged (HEAD ↔ index) and Unstaged (index ↔ working
  // tree), git's index as it is; + / − stage and unstage at once (stage.ts), and the commit takes
  // what is staged.
  const entryRef: EntryRef | null = entry
    ? { repoId, branch: entry.branch, worktreePath: entry.branch === null ? entry.worktreePath : null }
    : null;
  const entryKey = entry?.key ?? '';
  const stageDone = useStage((s) => s.done[entryKey] ?? 0);
  const { data: indexRead } = useInvoke(() => getIndexChanges(entryRef!), [repoId, entry?.key, stageDone], {
    repoIds: [repoId],
    enabled: wip && !!entryRef,
  });
  const moves = useStage((s) => s.over[entryKey]);
  const staging = useStage((s) => !!s.busy[repoId]);
  // The index read again with nothing in flight: the moves are in it now.
  useEffect(() => {
    if (indexRead && !useStage.getState().busy[repoId]) useStage.getState().settle(entryKey);
  }, [indexRead, repoId, entryKey]);
  const index = useMemo(
    () => (indexRead ? withMoves(indexRead, wipFiles, moves) : null),
    [indexRead, wipFiles, moves],
  );
  const staged = index?.staged ?? [];
  const unstaged = index?.unstaged ?? [];
  const stagePaths = (f: FileChange) => (f.oldPath ? [f.path, f.oldPath] : [f.path]);
  /** Moves files into Staged or out of it, whole. */
  const stageFiles = (list: FileChange[], to: StageTo) => {
    if (!entry || !entryRef) return;
    const where = (path: string): StageOp['from'] => {
      const s = staged.some((f) => f.path === path);
      const u = unstaged.some((f) => f.path === path);
      return s && u ? 'both' : s ? 'staged' : 'unstaged';
    };
    const seen = new Set<string>();
    const ops: StageOp[] = list
      .filter((f) => !seen.has(f.path) && !!seen.add(f.path))
      .map((f) => ({ path: f.path, paths: stagePaths(f), to, from: where(f.path) }));
    requestStage(
      { entry: entryRef, entryKey: entry.key, repoId, label: `${repoName} / ${entry.branch ?? entry.shortSha ?? ''}` },
      ops,
    );
  };
  // The form is kept per branch in the store, so leaving Review and coming back keeps it.
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
  const included = wip ? staged : [];
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
          if (r.status === 'exited' && r.exitCode === 0) setDraft(EMPTY_COMMIT_DRAFT, key);
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
  // Revert Changes: any commit of the checked-out branch, a new commit undoing it.
  const revertable = (c: HistoryCommit) =>
    !!entry?.worktreePath && !entry.operation && !committing && amending?.sha !== c.sha;
  const revertCommit = (c: HistoryCommit) => {
    if (!entryRef) return;
    const sha = c.shortSha;
    void startGitAction(t('revert.act', { sha }), t('revert.running', { sha }), () => gitRevert(entryRef, c.sha), {
      done: t('revert.done', { sha, rev }),
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
    generateMessage(
      active,
      () =>
        generateMessageStart(
          entryRef,
          included.flatMap(stagePaths),
          active,
          amending?.sha ?? null,
        ),
      {
        started: (runId) => (genRun.current = runId),
        ended: (runId) => {
          if (runId === null || genRun.current === runId) stop();
        },
        answer: (summary, description) => setDraft({ summary, description }, mine),
      },
    );
  };

  // The stashes taken on this branch (§15), or on any branch of the project, under the list; not
  // while searching.
  const allStashes = repoScan?.stashes;
  const projects = useData((s) => s.config?.projects);
  const scans = useData((s) => s.scan);
  const projectId = project?.projectId;
  const stashes: ReviewStash[] = useMemo(
    () =>
      search
        ? []
        : projectId
          ? reviewStashes({ kind: 'project', projectId }, projects, scans)
          : (allStashes ?? []).filter((s) => s.branch === rev).map((s) => ({ ...s, repoId, repoName })),
    [search, allStashes, rev, repoId, repoName, projectId, projects, scans],
  );
  const repos = useData((s) => s.config?.repos);
  // The open entry's group in a project review: its totals, stacked hint and commits' branches.
  const group = project?.groups.find((g) => g.entry.key === entry?.key);
  const stashesShut = useUi((s) => s.reviewStashesShut);
  const fromBranch = useMemo(
    () => Object.fromEntries((group?.commits ?? []).filter((c) => c.fromBranch).map((c) => [c.sha, c.fromBranch!])),
    [group],
  );

  const rows = useMemo(
    () => historyRows(commits, { wip, base, ahead: data?.ahead ?? null, upstream: search ? null : data?.upstream }),
    [commits, wip, base, data, search],
  );
  // The rows ↑ / ↓ step through, top to bottom: Uncommitted, then the commits. The stashes, in
  // their own section under the list (as in Review), are picked by click.
  const order = useMemo(() => [...(wip ? [WIP] : []), ...commits.map((c) => c.sha)], [wip, commits]);

  // The picked row: the one asked for while it is listed, else Uncommitted, else the newest commit.
  const [picked, setPicked] = useState<string | null>(() => project?.pick.get() ?? null);
  // A new search starts from its first match; the remembered row is the project's.
  const searched = useRef(search);
  useEffect(() => {
    if (searched.current === search) return;
    searched.current = search;
    setPicked(null);
  }, [search]);
  useEffect(() => project?.pick.set(picked), [picked, project]);
  const listed = (row: string) => order.includes(row) || stashes.some((s) => stashRow(s.sha) === row);
  const current = picked && listed(picked) ? picked : wip ? WIP : (commits[0]?.sha ?? null);
  // Several rows picked with ⌘ / ⇧-click (Hi12): Uncommitted and commits, shown taken together.
  // `lead` is the end ⇧↑ / ⇧↓ moves; `anchor` the row a range starts from.
  const [multi, setMulti] = useState<string[] | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [lead, setLead] = useState<string | null>(null);
  useEffect(() => setMulti(null), [repoId, rev, search]);
  // In list order (newest first); rows that left the list leave it too.
  const selected = useMemo(() => (multi ? order.filter((r) => multi.includes(r)) : []), [multi, order]);
  const isMulti = selected.length > 1;
  // Only rows next to each other have one diff: the oldest one's parent ↔ the newest one.
  const consecutive = selected.every((r, i) => i === 0 || order.indexOf(r) === order.indexOf(selected[i - 1]) + 1);
  const withWip = isMulti && selected[0] === WIP;
  const oldest = isMulti ? selected[selected.length - 1] : null;
  const newest = isMulti && !withWip ? selected[0] : null;
  const { data: rangeChanges } = useInvoke<RangeChanges>(
    () => getRangeChanges(repoId, oldest!, newest, withWip ? (entry?.worktreePath ?? null) : null),
    [repoId, oldest, newest, withWip, entry?.worktreePath],
    { repoIds: [repoId], enabled: isMulti && consecutive && !!oldest },
  );
  const spanned = isMulti && consecutive ? rangeChanges : undefined;
  const commit = isMulti ? undefined : commits.find((c) => c.sha === current);
  const stash = isMulti ? undefined : stashes.find((s) => stashRow(s.sha) === current);

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
    getStashChanges(stash.repoId, stash.sha).then(
      (c) => setStashData((d) => ({ ...d, [c.sha]: c })),
      (e) => {
        console.error('stash changes failed', e);
        stashRequested.current.delete(stash.sha);
      },
    );
  }, [stash]);
  const stashChanges = stash ? stashData[stash.sha] : undefined;
  const stashBase = stashChanges?.base ?? stash?.base ?? '';

  // The single row shown is Uncommitted.
  const wipShown = current === WIP && !isMulti;
  // Uncommitted's rows: Staged then Unstaged; a file staged and changed again is in both, so a
  // row's id is `s:` / `u:` and its path.
  const wipRows: WipRow[] = wipShown
    ? [
        ...staged.map((f) => ({ id: `s:${f.path}`, file: f, sec: 's' as const })),
        ...unstaged.map((f) => ({ id: `u:${f.path}`, file: f, sec: 'u' as const })),
      ]
    : [];
  const files: FileChange[] = isMulti
    ? (spanned?.files ?? [])
    : current === WIP
      ? wipRows.map((r) => r.file)
      : stash
        ? (stashChanges?.files ?? [])
        : (commitChanges?.files ?? []);
  const fileIds = wipShown ? wipRows.map((r) => r.id) : files.map((f) => f.path);
  // The row the files are listed under: the picked one, or the oldest of several.
  const filesAt = isMulti ? oldest : current;

  // The file shown (a row id in Uncommitted, else its path): the one picked while the row lists
  // it, else the same file in the other section (it moved there), else the first.
  const [path, setPath] = useState<string | null>(null);
  const moved = path && wipShown ? fileIds.indexOf(`${path.startsWith('s:') ? 'u' : 's'}:${path.slice(2)}`) : -1;
  const fileIndex = path && fileIds.includes(path) ? fileIds.indexOf(path) : moved >= 0 ? moved : files.length > 0 ? 0 : -1;
  const file = fileIndex >= 0 ? files[fileIndex] : undefined;
  const fileId = fileIndex >= 0 ? fileIds[fileIndex] : null;
  const wipRow = wipShown && fileIndex >= 0 ? wipRows[fileIndex] : undefined;
  // Several of Uncommitted's files picked with ⌘ / ⇧-click (Hi8): their right-click menu acts on
  // all of them.
  const picks = usePicks(
    wipShown ? fileIds : [],
    fileId,
    `${repoId}\u0000${rev}\u0000${current}\u0000${isMulti}`,
  );
  /** Discards rows: a Staged row's file goes back to HEAD, an Unstaged row's to what is staged. */
  const discard = (rows: WipRow[], all = false) => {
    if (!entry) return;
    const head = new Set(rows.filter((r) => r.sec === 's').map((r) => r.file.path));
    const seen = new Set<string>();
    const list = rows.map((r) => r.file).filter((f) => !seen.has(f.path) && !!seen.add(f.path));
    const keep = list.filter((f) => !head.has(f.path) && staged.some((x) => x.path === f.path)).map((f) => f.path);
    askDiscard({ targets: [targetOf(entry, list, keep)], all });
  };
  const wipActions = (row: WipRow): FileActions => {
    const ids = picks.targets(row.id);
    const rows = wipRows.filter((x) => ids.includes(x.id));
    const seen = new Set<string>();
    const shown = rows.filter((r) => !seen.has(r.file.path) && !!seen.add(r.file.path));
    const toStage = rows.filter((r) => r.sec === 'u').map((r) => r.file);
    const toUnstage = rows.filter((r) => r.sec === 's').map((r) => r.file);
    const off = committing || staging;
    return {
      files: shown.map((x) => ({ file: x.file, folder })),
      onDiscard: () => discard(rows),
      onStage: off
        ? undefined
        : {
            stage: toStage.length > 0 ? () => stageFiles(toStage, 'staged') : undefined,
            unstage: toUnstage.length > 0 ? () => stageFiles(toUnstage, 'unstaged') : undefined,
          },
    };
  };
  // The Uncommitted row's right-click menu: Discard All Changes, Stash All Changes.
  const [wipMenu, setWipMenu] = useState<DOMRect | null>(null);
  // A commit row's right-click menu (Hi10): Amend Commit… on the newest one, Copy SHA. On one of
  // several picked commits (`many`, Hi13): Squash N Commits….
  const [commitMenu, setCommitMenu] = useState<{ commit: HistoryCommit; at: DOMRect; many: boolean } | null>(null);
  // Squash (Hi13): consecutive commits of the checked-out branch (pushed or in the base too), not
  // the branch's first commit, no Uncommitted among them.
  const pickedCommits = isMulti ? selected.flatMap((r) => commits.filter((c) => c.sha === r)) : [];
  const squashable =
    isMulti &&
    consecutive &&
    !withWip &&
    !!entry?.worktreePath &&
    !entry.operation &&
    !committing &&
    pickedCommits.every((c) => c.sha !== amending?.sha) &&
    (pickedCommits[pickedCommits.length - 1]?.parents ?? 0) > 0;
  // A commit below the upstream line is on the remote: the branch will need a force push.
  const squashPushed =
    !!data?.upstream?.name && commits.indexOf(pickedCommits[pickedCommits.length - 1]) >= data.upstream.ahead;
  const [askSquash, setAskSquash] = useState<HistoryCommit[] | null>(null);
  const squash = (list: HistoryCommit[], summary: string, description: string) => {
    if (!entryRef) return;
    const n = cnt(list.length);
    void startGitAction(
      t('squash.act', n),
      t('squash.running', n),
      () => gitSquash(entryRef, list.map((c) => c.sha), summary, description),
      { done: t('squash.done', { ...n, rev }) },
    );
  };
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
  // Settings › Appearance › Review › Layout: the files under the picked row (tree) or in a
  // column of their own between the list and the diff (columns).
  const columns = useData((s) => s.config?.settings.historyLayout === 'columns');
  // The picked row lists its files under it; clicking it again folds them (and back). Columns
  // keep them.
  const [filesOpen, setFilesOpen] = useState(true);
  const pick = (row: string) => {
    setPicked(row);
    setMulti(null);
    setAnchor(row);
    setLead(row);
    setPath(null);
    setLand('first');
    setFilesOpen(true);
  };
  const click = (row: string) => {
    if (row !== current || isMulti) pick(row);
    else if (!columns) setFilesOpen((o) => !o);
  };
  // Several rows (Hi12): ⌘-click adds or drops one, ⇧-click takes the range from the last one
  // clicked. Down to one row, that row is picked as usual.
  const select = (rows: string[], end: string) => {
    if (rows.length === 0) return;
    if (rows.length === 1) {
      pick(rows[0]);
      return;
    }
    setMulti(rows);
    setLead(end);
    setPath(null);
    setLand('first');
    setFilesOpen(true);
  };
  const clickRow = (row: string, e: React.MouseEvent) => {
    if (e.metaKey) {
      const from = isMulti ? selected : current && order.includes(current) ? [current] : [];
      select(toggled(from, row), row);
      setAnchor(row);
      return;
    }
    if (e.shiftKey) {
      select(range(order, anchor ?? current ?? row, row), row);
      return;
    }
    click(row);
  };
  // The origin and base lines (SPEC §5) pick the rows above them, as several rows.
  const pickLine = (line: 'origin' | 'base') => {
    const list = lineRows(rows, line);
    if (list.length > 0) select(list, list[list.length - 1]);
    setAnchor(list[0] ?? null);
  };
  const lineOn = (line: 'origin' | 'base') => {
    const list = lineRows(rows, line);
    const now = isMulti ? selected : current ? [current] : [];
    return list.length > 0 && list.length === now.length && list.every((r, i) => r === now[i]);
  };
  // Not checked out: the branch opens on its base line, the whole review (once per rev).
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (openedOn.current === rev || !data?.tip || search) return;
    openedOn.current = rev;
    if (entry?.worktreePath || picked || multi) return;
    const list = lineRows(rows, 'base');
    if (list.length > 1) select(list, list[list.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rev, search]);
  // ⇧↑ / ⇧↓ in the list move the range's far end.
  const extend = (dir: 1 | -1) => {
    const end = lead && order.includes(lead) ? lead : current;
    if (!end) return;
    const j = order.indexOf(end) + dir;
    if (j < 0 || j >= order.length) return;
    select(range(order, anchor ?? end, order[j]), order[j]);
  };
  // Esc goes back to one row.
  useEffect(() => {
    if (!isMulti) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTextField(e.target) || useUi.getState().modalCount > 0) return;
      if (document.querySelector('[data-popover]')) return;
      setMulti(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMulti]);

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
  // And the picked file (next / previous change steps through them).
  useEffect(() => {
    (columns ? filesPane : listPane).current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [current, file?.path, columns]);
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
  // The files column's (columns layout) once dragged; until then 300px.
  const filesPane = useRef<HTMLDivElement>(null);
  const [filesWidth, setFilesWidth] = useStoredWidth('gitgel.historyFilesWidth');
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
  // Change Base… (⋮) opens the Base menu where the ⋮ was.
  const [baseMenu, setBaseMenu] = useState<DOMRect | null>(null);
  const [baseSaved, setBaseSaved] = useState<string | null>(null);
  // A project's repositories, for Fetch; the conflicts a stash apply left (no operation).
  const projectRepos = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of project?.groups ?? []) seen.set(g.entry.repoId, g.entry.repoName);
    return [...seen].map(([id, name]) => ({ repoId: id, repoName: name }));
  }, [project]);
  const conflicts = conflictsBanner(project ? project.groups : entry ? [{ entry } as ReviewGroup] : []);
  const subtitle = lastKnown
    ? [repoName, lastKnown.branch ?? rev.slice(0, 7), t('review.lastKnownState')].join(' · ')
    : [repoName, rev, worktree].filter(Boolean).join(' · ');

  // Only a search has a label: the subtitle names the rev.
  const label =
    data?.tip && search
      ? t('history.searchLabel', {
          n: formatCount(commits.length) + (data.more ? '+' : ''),
          one: commits.length === 1 && !data.more ? '1' : '0',
        })
      : '';

  // The picked row's files: under it in the list (tree), or in the files column (columns).
  const fileList = (
    <FileList
      rows={wipShown ? wipRows : files.map((f) => ({ id: f.path, file: f }))}
      file={fileId ?? undefined}
      folder={folder}
      stage={
        wipShown && index
          ? {
              disabled: committing,
              counts: { s: staged.length, u: unstaged.length },
              onRow: (r) => stageFiles([r.file], r.sec === 's' ? 'unstaged' : 'staged'),
              onAll: (sec) => (sec === 's' ? stageFiles(staged, 'unstaged') : stageFiles(unstaged, 'staged')),
              onDiscard: (r) => discard([r]),
              foldKey: draftKey,
            }
          : undefined
      }
      onFile={(id) => {
        setPath(id);
        setLand('first');
      }}
      picks={wipShown ? picks : undefined}
      actions={wipShown ? (r) => wipActions(r as WipRow) : undefined}
      conflict={wipShown && entry ? (f) => conflictOf(entry, f) : undefined}
    />
  );
  const commitForm = ((wipShown && wip) || amending) && (
    <CommitForm
      rev={rev}
      summary={summary}
      description={description}
      files={included.length}
      amend={amending?.short ?? null}
      committing={committing}
      blocked={
        wip && !index
          ? t('history.readingIndex')
          : (entry?.conflicts ?? 0) > 0
            ? t('history.resolveFirst')
            : staging
              ? t('history.staging')
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
  );

  const headerRight = (
    <>
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
        <SyncButtons
          target={syncTarget}
          fetchedAt={data?.fetchedAt ?? null}
          repos={project ? projectRepos : undefined}
        />
        <PageMenu>
          {(close, anchor) => {
            // The open entry's part: Branch in a project review, the whole menu for a branch.
            const branchItems = (
              <>
                {!project && (
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
                )}
                {entry?.worktreePath && !entry.operation && stashAction.item(close, anchor)}
                {entry && (
                  <MenuItem
                    icon={<BranchIcon size={14} />}
                    sub={t('review.baseSub', { base: entry.base ?? t('review.baseNone') })}
                    onSelect={() => {
                      close();
                      setBaseMenu(anchor);
                    }}
                  >
                    {t('review.changeBase')}
                  </MenuItem>
                )}
                {entry && <SyncItems entry={entry} onDone={close} rebaseOnly />}
                {!project && (
                  <MenuItem
                    icon="refresh"
                    onSelect={() => {
                      close();
                      void rescanAll(true);
                    }}
                  >
                    {t('review.refresh')}
                  </MenuItem>
                )}
                {entry && (
                  <>
                    <CopyBranchItem entry={entry} onDone={close} />
                    <MenuDivider />
                    <OpenItems entry={entry} onDone={close} />
                    {project ? (
                      <ScriptsMenu entry={entry} menu="project" project={project.projectName} onDone={close} />
                    ) : (
                      <ScriptsMenu entry={entry} menu="branches" onDone={close} />
                    )}
                    <DeleteBranchItem entry={entry} onDone={close} />
                    <EntryMenuNote entry={entry} />
                  </>
                )}
              </>
            );
            if (!project) return branchItems;
            return (
              <>
                <MenuLabel>{t('review.menuProject')}</MenuLabel>
                <MenuItem
                  icon="refresh"
                  onSelect={() => {
                    close();
                    void rescanAll(true);
                  }}
                >
                  {t('review.refresh')}
                </MenuItem>
                <MenuItem
                  icon="pencil"
                  onSelect={() => {
                    close();
                    editProject(project.projectId);
                  }}
                >
                  {t('review.editProject')}
                </MenuItem>
                <MenuDivider />
                <MenuLabel>{t('review.menuBranch')}</MenuLabel>
                {branchItems}
              </>
            );
          }}
        </PageMenu>
        {stashAction.dialog}
        {baseMenu && entry && (
          <BaseMenu
            repoId={repoId}
            entryKey={entry.key}
            branchName={entry.branch ?? entry.shortSha ?? ''}
            anchorRect={baseMenu}
            alignRight
            onClose={() => setBaseMenu(null)}
            onChosen={(b) => setBaseSaved(t('review.baseSaved', { base: b }))}
          />
        )}
        {switching && repoScan && (
          <SwitchBranchDialog scan={repoScan} rev={rev} onClose={() => setSwitching(false)} />
        )}
    </>
  );

  return (
    <div className={parts.screen}>
      {project ? (
        <ReviewHeader entry={entry} target={{ kind: 'project', projectId: project.projectId }} backLabel={backLabel} stashes={stashes}>
          {headerRight}
        </ReviewHeader>
      ) : (
        <PageHeader title={t('review.title')} subtitle={subtitle} backLabel={backLabel}>
          {headerRight}
        </PageHeader>
      )}
      {wipMenu && (
        <Popover anchorRect={wipMenu} width={230} onClose={() => setWipMenu(null)}>
          <Menu aria-label={t('history.wipActions')}>
            <MenuItem
              danger
              disabled={wipFiles.length === 0}
              onSelect={() => {
                setWipMenu(null);
                discard(
                  wipFiles.map((f) => ({ id: f.path, file: f, sec: 's' })),
                  true,
                );
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
      {commitMenu?.many && (
        <Popover anchorRect={commitMenu.at} width={200} onClose={() => setCommitMenu(null)}>
          <Menu aria-label={t('history.commitsMenu')}>
            <MenuItem
              icon="rebase"
              onSelect={() => {
                setCommitMenu(null);
                setAskSquash(pickedCommits);
              }}
            >
              {t('squash.menu', cnt(pickedCommits.length))}
            </MenuItem>
          </Menu>
        </Popover>
      )}
      {askSquash && entryRef && (
        <SquashModal
          commits={askSquash}
          entry={entryRef}
          sub={`${repoName} / ${rev}`}
          pushed={squashPushed}
          provider={provider}
          providers={menuProviders}
          aiEnabled={ai?.enabled ?? true}
          onClose={() => setAskSquash(null)}
          onSquash={(summary, description) => squash(askSquash, summary, description)}
        />
      )}
      {commitMenu && !commitMenu.many && (
        <Popover anchorRect={commitMenu.at} width={220} onClose={() => setCommitMenu(null)}>
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
            {revertable(commitMenu.commit) && (
              <MenuItem
                icon="revert"
                onHover={() => setCherrySub(null)}
                onSelect={() => {
                  setCommitMenu(null);
                  revertCommit(commitMenu.commit);
                }}
              >
                {t('revert.menu')}
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
      {project
        ? project.groups.map(
            (g) => g.entry.operation && <OperationBanner key={g.entry.key} entry={g.entry} op={g.entry.operation} />,
          )
        : entry?.operation && <OperationBanner entry={entry} op={entry.operation} names={false} />}
      {conflicts && <Banner tone="danger">{conflicts}</Banner>}
      {baseSaved && <Banner tone="neutral">{baseSaved}</Banner>}
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
        <div
          ref={listPane}
          className={columns ? `${styles.listPane} ${styles.listPaneColumns}` : styles.listPane}
          style={listWidth ? { width: listWidth } : undefined}
        >
          <aside
            ref={list}
            role="listbox"
            aria-label={t('history.commitsList')}
            className={styles.list}
            onScroll={onScroll}
            onKeyDown={(e) => {
              if (e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
              e.preventDefault();
              const dir = e.key === 'ArrowDown' ? 1 : -1;
              if (e.shiftKey) extend(dir);
              else stepRow(dir);
            }}
          >
            {project && entry && <BranchHead entry={entry} group={group} />}
            {group?.stackHint && !search && (
              <div className={styles.stackHint}>
                {t('review.stackHint', {
                  contains: formatCount(group.stackHint.contains),
                  total: formatCount(group.stackHint.total),
                  branch: group.stackHint.branch,
                })}
              </div>
            )}
            {label && <div className={styles.listLabel}>{label}</div>}
            {rows.map((r) => (
              <ListRow
                key={rowKey(r)}
                row={r}
                current={isMulti ? null : current}
                selected={isMulti ? selected : []}
                filesAt={filesAt}
                fileList={!columns && filesOpen ? fileList : null}
                wipConflicts={entry?.conflicts ?? 0}
                wipAge={entry?.changedAt ?? null}
                wipFailed={commitFailed}
                onPick={clickRow}
                onLine={pickLine}
                lineOn={lineOn}
                onWipMenu={setWipMenu}
                onCommitMenu={(commit, at) => {
                  // On one of several picked commits the menu is theirs: Squash, when they can be.
                  const many = isMulti && selected.includes(commit.sha);
                  if (many && !squashable) return;
                  setCommitMenu({ commit, at, many });
                }}
                amending={amending?.sha ?? null}
                fromBranch={fromBranch}
              />
            ))}
            {data && !data.tip && <div className={styles.listEmpty}>{t('history.revNotFound', { rev })}</div>}
            {project && project.notInReview > 0 && !search && (
              <div className={styles.notInReview}>
                {t('review.notReviewable', { ...cnt(project.notInReview) })} ·{' '}
                <button type="button" className={parts.linkButton} onClick={() => editProject(project.projectId)}>
                  {t('review.openProject')}
                </button>
              </div>
            )}
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
                heading={t(project ? 'review.stashOfProject' : 'review.stashOfBranch')}
                stashes={stashes}
                picked={stash?.sha}
                changes={!columns && filesOpen ? stashChanges : undefined}
                file={file?.path}
                divider={false}
                withRepo={!!project}
                onPick={(sha) => click(stashRow(sha))}
                onFile={(p) => {
                  setPath(p);
                  setLand('first');
                }}
                fold={{ open: !stashesShut, onToggle: () => useUi.getState().toggleReviewStashes() }}
              />
            </div>
          )}
          {project && project.groups.length > 1 && entry && <OtherBranches project={project} open={entry.key} />}
          {!columns && commitForm}
        </div>
        <ResizeHandle pane={listPane} min={280} max={640} onResize={setListWidth} onReset={() => setListWidth(null)} label={t('history.resizeList')} />
        {columns && (
          <>
            <div ref={filesPane} className={styles.filesPane} style={filesWidth ? { width: filesWidth } : undefined}>
              {/* The count and totals, here instead of in the header over the diff. */}
              {(wipShown || commitChanges || stashChanges || spanned) && (
                <div className={styles.filesHead}>
                  <span>{t('branches.fileCount', { ...cnt((wipShown ? wipFiles : files).length) })}</span>
                  <span className={parts.grow} />
                  <DiffStat {...totals(wipShown ? wipFiles : files)} />
                </div>
              )}
              <div role="group" aria-label={t('history.filesList')} className={styles.filesList}>
                {fileList}
              </div>
              {commitForm}
            </div>
            <ResizeHandle
              pane={filesPane}
              min={220}
              max={560}
              onResize={setFilesWidth}
              onReset={() => setFilesWidth(null)}
              label={t('history.resizeFiles')}
            />
          </>
        )}

        <section className={parts.main}>
          {error ? (
            <div className={parts.empty}>{error.message}</div>
          ) : isMulti ? (
            <RangeHeader
              rows={selected}
              commits={commits}
              changes={spanned}
              consecutive={consecutive}
              stats={!columns}
            />
          ) : current === WIP ? (
            <WipHeader files={wipFiles} stats={!columns} />
          ) : stash ? (
            <StashBar stash={stash} base={stashBase} />
          ) : commit ? (
            <CommitHeader repoId={repoId} commit={commit} changes={columns ? undefined : commitChanges} />
          ) : null}
          {!error && file && (wipShown || commitChanges || stashChanges || spanned) && (
            <>
              <FileBar
                file={file}
                label={
                  isMulti
                    ? `${spanned?.parent?.slice(0, 7) ?? t('review.emptyTree')} ↔ ${newest ? newest.slice(0, 7) : t('history.workingTree')}`
                    : current === WIP
                    ? wipRow?.sec === 's'
                      ? t('history.headToIndex')
                      : t('history.indexToTree')
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
                repoId={stash ? stash.repoId : repoId}
                worktreePath={wipShown || withWip ? (entry?.worktreePath ?? null) : null}
                folder={stash ? (repos?.find((r) => r.id === stash.repoId)?.path ?? null) : folder}
                commit={isMulti ? newest : (commit?.sha ?? null)}
                parent={isMulti ? (spanned?.parent ?? null) : (commitChanges?.parent ?? null)}
                change={file}
                mode={wipShown ? 'uncommitted' : withWip ? 'all' : 'committed'}
                fileKey={`${isMulti ? selected.join(',') : current}\u0000${fileId}`}
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
          {!error && (commitChanges || stashChanges || spanned) && files.length === 0 && !wipShown && (
            <div className={parts.empty}>{t('history.noChanges')}</div>
          )}
          {!error && isMulti && !consecutive && <div className={parts.empty}>{t('history.notConsecutive')}</div>}
        </section>
      </div>
    </div>
  );
}

/** A project review's open branch, sticky over its rows (SPEC §5 "Branch head"): repo and the
 * branch's totals against its base, then the branch and its operation / conflicts pills. */
function BranchHead({ entry: e, group }: { entry: EntrySummary; group: ReviewGroup | undefined }) {
  const files = group?.files.committed ?? [];
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  const where = e.worktreePath ? tildifyHome(e.worktreePath) : null;
  return (
    <div className={styles.branchHead} title={[e.repoName, e.branch ?? e.shortSha, where].filter(Boolean).join(' · ')}>
      <div className={styles.branchHeadLine}>
        <span className={styles.branchHeadRepo}>{e.repoName}</span>
        <DiffStat add={files.length > 0 ? add : undefined} del={del > 0 ? del : undefined} />
      </div>
      <div className={styles.branchHeadLine}>
        <span className={styles.branchHeadName}>{e.branch ?? e.shortSha}</span>
        {e.operation && <OperationPill op={e.operation} short />}
        {e.conflicts > 0 && (
          <Pill tone="danger" size="sm" title={conflictsTooltip(e)}>
            {t('branches.conflictCount', { ...cnt(e.conflicts) })}
          </Pill>
        )}
      </div>
    </div>
  );
}

/** The project's other entries (SPEC §5 "Branches"), pinned under the stashes; a click opens one. */
function OtherBranches({ project, open: openKey }: { project: ProjectScope; open: string }) {
  const shown = useUi((s) => s.reviewBranchesOpen);
  const others = project.groups.filter((g) => g.entry.key !== openKey);
  return (
    <div className={styles.branchesPane}>
      <button
        type="button"
        className={styles.branchesHeading}
        aria-expanded={shown}
        onClick={() => useUi.getState().toggleReviewBranches()}
      >
        <ChevronDownIcon size={12} className={shown ? parts.sectionChevron : `${parts.sectionChevron} ${parts.sectionShut}`} />
        {t('review.branchesSection')} · {formatCount(others.length)}
      </button>
      {shown && (
        <div className={styles.branchesList}>
          {others.map((g) => {
            const e = g.entry;
            const files = g.files.committed;
            const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
            const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
            return (
              <button
                key={e.key}
                type="button"
                className={styles.otherBranch}
                title={[e.repoName, e.branch ?? e.shortSha, e.worktreePath ? tildifyHome(e.worktreePath) : null].filter(Boolean).join(' · ')}
                onClick={() => project.onOpen(e.key)}
              >
                <span className={styles.branchHeadLine}>
                  <span className={styles.branchHeadRepo}>{e.repoName}</span>
                  <DiffStat add={files.length > 0 ? add : undefined} del={del > 0 ? del : undefined} />
                </span>
                <span className={styles.branchHeadLine}>
                  <span className={styles.branchHeadName}>{e.branch ?? e.shortSha}</span>
                  {(e.uncommitted ?? 0) > 0 && <span className={styles.dirtyDot} title={t('history.wipTitle')} />}
                  {e.upstream && (
                    <span className={styles.otherUpstream} title={upstreamTitle(e.upstream)}>
                      {upstreamLabel(e.upstream)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function rowKey(r: HistoryRow): string {
  return r.kind === 'commit' ? r.commit.sha : r.kind;
}

function ListRow({
  row,
  current,
  selected,
  filesAt,
  fileList,
  wipConflicts,
  wipAge,
  wipFailed,
  onPick,
  onLine,
  lineOn,
  onWipMenu,
  onCommitMenu,
  amending,
  fromBranch,
}: {
  row: HistoryRow;
  current: string | null;
  /** Several rows picked with ⌘ / ⇧-click (Hi12), tinted. */
  selected: string[];
  /** The row the files are listed under. */
  filesAt: string | null;
  wipConflicts: number;
  wipAge: number | null;
  /** The picked row's files, listed under it (tree layout); null when folded or in columns. */
  fileList: React.ReactNode;
  /** Uncommitted: the last commit failed. */
  wipFailed: boolean;
  onPick: (row: string, e: React.MouseEvent) => void;
  /** The origin or base line clicked: picks the rows above it. */
  onLine: (line: 'origin' | 'base') => void;
  /** Whether the picked rows are exactly that line's. */
  lineOn: (line: 'origin' | 'base') => boolean;
  /** A right-click on the Uncommitted row, at the pointer. */
  onWipMenu: (at: DOMRect) => void;
  /** A right-click on a commit row, at the pointer. */
  onCommitMenu: (commit: HistoryCommit, at: DOMRect) => void;
  /** The commit being amended (Hi10): its row says so. */
  amending: string | null;
  /** Commits that come from another branch (stacked), by SHA: a warning pill names it. */
  fromBranch: Record<string, string>;
}) {
  const oneLine = useData((s) => s.config?.settings.commitRows === 'one-line');
  switch (row.kind) {
    case 'origin':
    case 'base': {
      const origin = row.kind === 'origin';
      const on = lineOn(row.kind);
      const label = origin
        ? row.pushed > 0
          ? t('review.originLinePushed', { remote: row.remote, n: formatCount(row.pushed) })
          : row.remote
        : t('review.baseLine', { base: row.base, sha: row.mergeBase });
      const rule = origin ? `${styles.lineRule} ${styles.lineDashed}` : styles.lineRule;
      return (
        <button
          type="button"
          className={on ? `${styles.line} ${styles.lineOn}` : styles.line}
          aria-pressed={on}
          title={origin ? t('review.originLineHint') : t('review.baseLineHint')}
          onClick={() => onLine(row.kind)}
        >
          <span className={rule} />
          <span className={styles.lineLabel}>{label}</span>
          <span className={rule} />
        </button>
      );
    }
    case 'wip': {
      const on = current === WIP;
      const many = selected.includes(WIP);
      const cls = [styles.wip, oneLine && styles.wipOneLine, on && styles.rowOn, many && styles.rowPicked]
        .filter(Boolean)
        .join(' ');
      const title = (
        <span className={styles.subjectLine}>
          <span className={styles.wipTitle}>{t('history.wipTitle')}</span>
          {wipFailed && (
            <Pill tone="danger" size="sm">
              {t('history.commitFailed')}
            </Pill>
          )}
        </span>
      );
      // No file count; one-line rows leave out the age too.
      const metaText = [
        wipConflicts > 0 && t('branches.conflictCount', { ...cnt(wipConflicts) }),
        !oneLine && wipAge && ageText(wipAge),
      ]
        .filter(Boolean)
        .join(' · ');
      const meta = metaText && <span className={styles.meta}>{metaText}</span>;
      return (
        <>
          <button
            type="button"
            role="option"
            aria-selected={on || many}
            title={t('history.showWip')}
            className={cls}
            onClick={(e) => onPick(WIP, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              onWipMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
            }}
          >
            {oneLine ? (
              // One line, as the commit rows: dot and title (conflicts, if any, on the right).
              <>
                <span className={styles.wipDot} />
                {title}
                {meta}
              </>
            ) : (
              <>
                <span className={styles.wipSlot}>
                  <span className={styles.wipDot} />
                </span>
                <span className={styles.rowText}>
                  {title}
                  {meta}
                </span>
              </>
            )}
          </button>
          {filesAt === WIP && fileList}
        </>
      );
    }
    case 'commit': {
      const c = row.commit;
      const on = current === c.sha;
      const many = selected.includes(c.sha);
      const cls = [
        styles.commit,
        oneLine && styles.commitOneLine,
        on && styles.rowOn,
        many && styles.rowPicked,
        c.inBase && styles.shared,
      ]
        .filter(Boolean)
        .join(' ');
      const pills = (
        <>
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
          {fromBranch[c.sha] && (
            <Pill tone="warning" size="sm" mono>
              {fromBranch[c.sha]}
            </Pill>
          )}
        </>
      );
      const age = c.committedAt ? ageTitle(c.committedAt) : undefined;
      return (
        <>
          <button
            type="button"
            role="option"
            aria-selected={on || many}
            title={t('history.showCommit')}
            className={cls}
            onClick={(e) => onPick(c.sha, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              onCommitMenu(c, new DOMRect(e.clientX, e.clientY, 0, 0));
            }}
          >
            {oneLine ? (
              // One line (Settings › Appearance › Review): SHA, subject, pills, age.
              <>
                <span className={`${styles.sha} ${styles.shaCol}`}>{c.shortSha}</span>
                <span className={styles.subjectLine}>
                  <span className={styles.subject}>{c.subject}</span>
                  {pills}
                </span>
                <span className={styles.oneLineAge} title={age ? `${c.author} · ${age}` : c.author}>
                  {ageText(c.committedAt)}
                </span>
              </>
            ) : (
              <>
                <Avatar author={c.author} size={24} />
                <span className={styles.rowText}>
                  <span className={styles.subjectLine}>
                    <span className={styles.subject}>{c.subject}</span>
                    {pills}
                  </span>
                  <span className={styles.metaLine}>
                    <span className={styles.metaWho} title={age}>
                      {c.author} · {ageText(c.committedAt)}
                    </span>
                    <span className={styles.sha}>{c.shortSha}</span>
                  </span>
                </span>
              </>
            )}
          </button>
          {filesAt === c.sha && fileList}
        </>
      );
    }
  }
}

/** A row of the files list: a file (Uncommitted's with its section, `s` / `u`). */
interface ListedFile {
  id: string;
  file: FileChange;
  sec?: 's' | 'u';
}
type WipRow = Required<ListedFile>;

function FileList({
  rows,
  file,
  folder,
  stage,
  onFile,
  picks,
  actions,
  conflict,
}: {
  rows: ListedFile[];
  /** The id of the row shown. */
  file: string | undefined;
  /** Where the files' right-click menu opens them from. */
  folder: string | null;
  /** Uncommitted's sections (Hi5), when it is picked: Staged and Unstaged, + / − per row. */
  stage?: {
    disabled: boolean;
    counts: { s: number; u: number };
    onRow: (row: WipRow) => void;
    onAll: (sec: 's' | 'u') => void;
    onDiscard: (row: WipRow) => void;
    /** Where the folded sections are kept: the branch. */
    foldKey: string;
  };
  onFile: (id: string) => void;
  /** Uncommitted's files picked with ⌘ / ⇧-click (Hi8). */
  picks?: { isPicked: (id: string) => boolean; click: (id: string, e: React.MouseEvent, open: () => void) => void };
  /** Uncommitted's file menu. */
  actions?: (row: ListedFile) => FileActions;
  /** Uncommitted's conflicted files of an operation in progress: ⚠ / ✓ (T4). */
  conflict?: (f: FileChange) => 'unresolved' | 'resolved' | undefined;
}) {
  // Staged / Unstaged (SPEC §5 "Uncommitted sections"): the header folds its section (per branch,
  // while the app runs); Stage / Unstage All on its hover; the count in a pill.
  const shut = useUi((s) => s.shutSections);
  const isShut = (sec: 's' | 'u') => !!stage && !!shut[`${stage.foldKey}\u0000${sec}`];
  const section = (sec: 's' | 'u') => {
    if (!stage) return null;
    const open = !isShut(sec);
    const all = t(sec === 's' ? 'history.unstageAll' : 'history.stageAll');
    return (
      <div key={sec} className={parts.section}>
        <button
          type="button"
          className={parts.sectionToggle}
          aria-expanded={open}
          onClick={() => useUi.getState().toggleSection(`${stage.foldKey}\u0000${sec}`)}
        >
          <ChevronDownIcon size={12} className={open ? parts.sectionChevron : `${parts.sectionChevron} ${parts.sectionShut}`} />
          <span className={parts.sectionLabel}>{t(sec === 's' ? 'history.staged' : 'history.unstaged')}</span>
        </button>
        {stage.counts[sec] > 0 && (
          <button
            type="button"
            className={parts.sectionAct}
            aria-label={all}
            title={all}
            disabled={stage.disabled}
            onClick={() => stage.onAll(sec)}
          >
            <Icon name={sec === 's' ? 'minus' : 'plus'} size={14} />
          </button>
        )}
        <span className={parts.sectionPill}>{formatCount(stage.counts[sec])}</span>
      </div>
    );
  };
  const row = (r: ListedFile) => (
    <FileRow
      key={r.id}
      file={r.file}
      folder={folder}
      on={r.id === file}
      picked={picks?.isPicked(r.id)}
      onClick={(e) => (picks ? picks.click(r.id, e, () => onFile(r.id)) : onFile(r.id))}
      actions={actions?.(r)}
      conflict={conflict?.(r.file)}
      stage={
        stage && r.sec
          ? {
              glyph: r.sec === 's' ? '−' : '+',
              label: t(r.sec === 's' ? 'history.unstageFile' : 'history.stageFile', { file: basename(r.file.path) }),
              disabled: stage.disabled,
              onClick: () => stage.onRow(r as WipRow),
              discard: { label: t('review.discardOne'), onClick: () => stage.onDiscard(r as WipRow) },
            }
          : undefined
      }
    />
  );
  return (
    // Rows start at 8px, like the commit rows (SPEC §5).
    <div className={`${parts.fileRows} ${parts.fileRowsFlat}`}>
      {stage ? (
        <>
          {section('s')}
          {!isShut('s') && rows.filter((r) => r.sec === 's').map(row)}
          {section('u')}
          {!isShut('u') && rows.filter((r) => r.sec === 'u').map(row)}
        </>
      ) : (
        rows.map(row)
      )}
    </div>
  );
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

/** Above several rows taken together (Hi12): how many, each one's SHA and subject, and the span. */
function RangeHeader({
  rows,
  commits,
  changes,
  consecutive,
  stats,
}: {
  rows: string[];
  commits: HistoryCommit[];
  changes: RangeChanges | undefined;
  consecutive: boolean;
  /** The file count and totals (the files column has them instead). */
  stats: boolean;
}) {
  const withWip = rows[0] === WIP;
  const picked = rows.flatMap((r) => commits.filter((c) => c.sha === r));
  const n = cnt(picked.length);
  const stat = changes ? totals(changes.files) : null;
  const newest = picked[0];
  return (
    <div className={styles.head}>
      <div className={parts.entryLine}>
        <span className={parts.barTitle}>{withWip ? t('history.selWip', n) : t('history.selCommits', n)}</span>
      </div>
      <div className={styles.rangeList}>
        {withWip && (
          <div className={styles.rangeRow}>
            <span className={styles.rangeSha}>
              <span className={styles.wipDot} />
            </span>
            <span className={styles.rangeSubject}>{t('history.wipTitle')}</span>
          </div>
        )}
        {picked.map((c) => (
          <div key={c.sha} className={styles.rangeRow}>
            <span className={`${styles.rangeSha} selectable`}>{c.shortSha}</span>
            <span className={`${styles.rangeSubject} selectable`} title={c.subject}>
              {c.subject}
            </span>
          </div>
        ))}
      </div>
      {consecutive && changes && (stats || (!withWip && newest)) && (
        <div className={parts.barMeta}>
          {!withWip && newest && (
            <span className="selectable">{`${changes.parent?.slice(0, 7) ?? t('review.emptyTree')}..${newest.shortSha}`}</span>
          )}
          {stats && (
            <>
              {!withWip && newest && <span className={parts.dot}>·</span>}
              <span>{t('branches.fileCount', { ...cnt(changes.files.length) })}</span>
              <DiffStat add={stat!.add} del={stat!.del} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The worktree path is already in the page subtitle.
// `stats`: the file count and totals (the files column has them instead).
function WipHeader({ files, stats }: { files: FileChange[]; stats: boolean }) {
  const stat = totals(files);
  return (
    <div className={styles.head}>
      <div className={parts.entryLine}>
        <span className={parts.barTitle}>{t('history.wipTitle')}</span>
      </div>
      {stats && (
        <div className={parts.barMeta}>
          <span>{t('branches.fileCount', { ...cnt(files.length) })}</span>
          <DiffStat add={stat.add} del={stat.del} />
        </div>
      )}
    </div>
  );
}
