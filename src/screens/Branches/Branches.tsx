import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { IconButton } from '../../components/IconButton';
import { List, type ListSubPart } from '../../components/List';
import {
  BranchLargeIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  HistoryIcon,
  MoreVerticalIcon,
  PinIcon,
  SplitIcon,
  WorktreeIcon,
} from '../../components/icons';
import { Menu, MenuDivider, MenuItem, MenuLabel } from '../../components/Menu';
import { CopyBranchItem, EntryMenuNote, OpenItems } from '../../components/OpenItems';
import { conflictsTooltip } from '../../sync/operation';
import { OperationPill } from '../../sync/OperationUi';
import { RepoFetchButton, SyncItems } from '../../sync/SyncButtons';
import { ScriptsMenu } from '../../scripts/ScriptsMenu';
import { askDrop } from '../../stash/actions';
import { StashTargetMenu } from '../../stash/StashTargetMenu';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker';
import { RefreshButton } from '../../components/RefreshButton';
import { Segmented } from '../../components/Segmented';
import { openAddRepos } from '../../lib/addRepos';
import { startDraftProject } from '../../lib/draft';
import { ageText, ageTitle, cnt, formatCount } from '../../lib/format';
import { t } from '../../i18n';
import { setRepoPinned } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import { readProjectSort, sortProjects } from '../../lib/projectSort';
import { refOf } from '../../lib/projects';
import type { Config, EntrySummary, RemoteBranch, StashInfo } from '../../lib/types';
import { selectRepoScans, useData } from '../../state/data';
import { openHistory, openSettings, selectRoute, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import styles from './Branches.module.css';
import { REPOS_KEY, STASHES_KEY, toggled, useCollapsed } from './collapsed';
import { FilterField } from './FilterField';
import {
  afu,
  branchGroups,
  isBaseRow,
  middleCut,
  projectsOf,
  scopeCounts,
  type BranchScope,
  type RepoGroup,
} from './rows';

export function Branches() {
  const config = useData((s) => s.config);
  if (!config) return null;
  return config.repos.length === 0 ? <FirstRun /> : <BranchList />;
}

function FirstRun() {
  return (
    <>
      <PageHeader title={t('branches.title')} subtitle={t('branches.emptySubtitle')} />
      <div className={styles.center}>
        <div className={styles.emptyBody}>
          <BranchLargeIcon className={styles.emptyIcon} />
          <h2 className={styles.emptyTitle}>{t('branches.noRepos')}</h2>
          <p className={styles.emptyText}>{t('branches.noReposText')}</p>
          <Button variant="primary" size={40} className={styles.emptyButton} onClick={() => void openAddRepos()}>
            {t('sidebar.addRepository')}
          </Button>
          <span className={styles.emptyHint}>{t('branches.dropHint')}</span>
        </div>
      </div>
    </>
  );
}

const SCOPE_KEY = 'gitgel.branches.scope';

function readScope(): BranchScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'unassigned' ? 'unassigned' : 'all';
  } catch {
    return 'all';
  }
}

/** A popover opened from a row: its Projects menu, the project picker, the base menu, or the row
 * menu (⋯). */
type RowPopover =
  | { kind: 'projects'; key: string; rect: DOMRect }
  | { kind: 'picker'; key: string; rect: DOMRect }
  | { kind: 'base'; key: string; rect: DOMRect }
  // `atPointer`: opened by right-clicking the row, so it opens at the pointer.
  | { kind: 'menu'; key: string; rect: DOMRect; atPointer?: boolean };

function BranchList() {
  const config = useData((s) => s.config)!;
  const scan = useData((s) => s.scan);
  const scannedOnce = useData((s) => s.scannedOnce);
  const typed = useUi((s) => s.branchesFilter);
  const setFilter = useUi((s) => s.setBranchesFilter);
  const filterRef = useRef<HTMLInputElement>(null);
  // The list follows the field 150 ms after the last keystroke; clearing it applies at once.
  const [filter, setApplied] = useState(typed);
  useEffect(() => {
    if (!typed.trim()) {
      setApplied(typed);
      return;
    }
    const timer = window.setTimeout(() => setApplied(typed), 150);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const [scope, setScopeState] = useState<BranchScope>(readScope);
  const setScope = (next: BranchScope) => {
    setScopeState(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  };

  const route = useNav(selectRoute);
  const focusRepoId = route.name === 'branches' ? route.focusRepoId : undefined;
  const scans = useMemo(() => selectRepoScans({ config, scan }), [config, scan]);
  const groups = useMemo(
    () => branchGroups(config, scans, filter, scope, focusRepoId),
    [config, scans, filter, scope, focusRepoId],
  );
  const counts = useMemo(() => scopeCounts(config, scans), [config, scans]);
  const allRows = useMemo(() => scans.flatMap((s) => s.active), [scans]);
  const days = config.settings.activeDays;

  // Collapsed repo bands and stash lists, remembered. While filtering everything starts open and
  // collapsing is kept apart, not remembered, and forgotten when the filter is cleared.
  const [savedRepos, setSavedRepos] = useCollapsed(REPOS_KEY);
  const [savedStashes, setSavedStashes] = useCollapsed(STASHES_KEY);
  const [searchRepos, setSearchRepos] = useState<Set<string>>(new Set());
  const [searchStashes, setSearchStashes] = useState<Set<string>>(new Set());
  const filtering = filter.trim() !== '';
  useEffect(() => {
    if (filtering) return;
    setSearchRepos(new Set());
    setSearchStashes(new Set());
  }, [filtering]);
  const shutRepos = filtering ? searchRepos : savedRepos;
  const setShutRepos = filtering ? setSearchRepos : setSavedRepos;
  const shutStashes = filtering ? searchStashes : savedStashes;
  const setShutStashes = filtering ? setSearchStashes : setSavedStashes;
  // ⌥-click collapses every band when the clicked one is open, and opens them all otherwise.
  const toggleRepo = (id: string, all: boolean) =>
    setShutRepos((ids) => {
      if (!all) return toggled(ids, id);
      const shown = groups.map((g) => g.scan.repo.id);
      const next = new Set(ids);
      for (const g of shown) {
        if (ids.has(id)) next.delete(g);
        else next.add(g);
      }
      return next;
    });

  // Arriving from a repo name: clear the filter, open its band, scroll to it and flash it.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRepoId) return;
    useUi.getState().setBranchesFilter('');
    setShutRepos((ids) => (ids.has(focusRepoId) ? toggled(ids, focusRepoId) : ids));
    requestAnimationFrame(() =>
      document.getElementById(`repo-${focusRepoId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
    setFlash(focusRepoId);
    const timer = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(timer);
  }, [focusRepoId]);

  // Rows just added to a project are highlighted for a moment.
  const [justAdded, setJustAdded] = useState<string[]>([]);
  useEffect(() => {
    if (justAdded.length === 0) return;
    const timer = window.setTimeout(() => setJustAdded([]), 2000);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  // Selection (flow H) counts rows hidden by the filter too.
  const selectedKeys = useUi((s) => s.selectedKeys);
  const selected = allRows.filter((r) => selectedKeys.includes(r.key));
  const [popover, setPopover] = useState<RowPopover | null>(null);
  const popoverEntry = allRows.find((r) => r.key === popover?.key);

  // ⌘K focuses the filter on this screen. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc clears the selection, or else the filter (popovers and modals close first). Listed in
  // lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key !== 'Escape' || popover || ui.modalCount > 0) return;
      if (ui.selectedKeys.length > 0) ui.setSelectedKeys([]);
      else if (ui.branchesFilter) ui.setBranchesFilter('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

  // What is listed: repos with rows or remote matches, their branches (base rows and remote
  // branches left out, as in the scope counts) and stashes; stashes only when there are any.
  const shown = groups.filter((g) => g.rows.length > 0 || g.remotes.length > 0);
  const shownBranches = shown.reduce((n, g) => n + g.rows.filter((r) => !isBaseRow(g.scan, r)).length, 0);
  const shownStashes = shown.reduce((n, g) => n + g.stashes.length, 0);
  const subtitle = [
    t('branches.subRepos', { ...cnt(shown.length) }),
    t('branches.subBranches', { ...cnt(shownBranches) }),
    ...(shownStashes > 0 ? [t('branches.subStashes', { ...cnt(shownStashes) })] : []),
  ].join(' · ');

  let body;
  // Repos appear as they finish scanning; the rest are counted below the list.
  const pending = config.repos.length - scans.length;
  const pendingNote =
    pending > 0 ? (
      <div className={styles.pending}>{t('branches.pendingMore', { ...cnt(pending) })}</div>
    ) : null;
  if (groups.length === 0 && (pending > 0 || !scannedOnce)) {
    body = <div className={`${styles.center} ${styles.muted}`}>{t('branches.scanning')}</div>;
  } else if (groups.length === 0 && filter.trim()) {
    body = <div className={`${styles.center} ${styles.muted}`}>{t('branches.noMatch', { filter: filter.trim() })}</div>;
  } else if (groups.length === 0 && scope === 'unassigned' && counts.all > 0) {
    body = (
      <div className={styles.center}>
        <h2 className="page-title">{t('branches.allInProject')}</h2>
      </div>
    );
  } else if (groups.length === 0) {
    body = (
      <div className={styles.center}>
        <div className={styles.emptyBody}>
          <h2 className="page-title">{t('branches.noActive')}</h2>
          <p className={styles.emptyText}>{t('branches.noActiveText', { days: formatCount(days) })}</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className={selected.length > 0 ? `${styles.list} ${styles.selecting}` : styles.list}>
        {groups.map((g) => (
          <RepoSection
            key={g.scan.repo.id}
            group={g}
            config={config}
            flash={flash === g.scan.repo.id}
            open={!shutRepos.has(g.scan.repo.id)}
            onToggle={(all) => toggleRepo(g.scan.repo.id, all)}
            stashesOpen={!shutStashes.has(g.scan.repo.id)}
            onToggleStashes={() => setShutStashes((ids) => toggled(ids, g.scan.repo.id))}
            selectedKeys={selectedKeys}
            justAdded={justAdded}
            popover={popover}
            onPopover={setPopover}
          />
        ))}
        {pendingNote}
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t('branches.title')} subtitle={subtitle}>
        <RefreshButton />
        <Segmented
          aria-label={t('branches.showBranches')}
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('branches.scopeAll'), count: counts.all },
            { value: 'unassigned', label: t('branches.scopeUnassigned'), count: counts.unassigned },
          ]}
        />
        <FilterField ref={filterRef} value={typed} onChange={setFilter} />
      </PageHeader>
      <div className={styles.table}>
        <div className={`${styles.grid} ${styles.columns}`}>
          <span />
          <span>{t('branches.colBranch')}</span>
          <span>{t('branches.colProjects')}</span>
          <span />
        </div>
        {body}
      </div>
      {selected.length > 0 && <SelectionBar selected={selected} onAdded={setJustAdded} />}

      {popover?.kind === 'projects' && popoverEntry && (
        <Popover anchorRect={popover.rect} width={270} alignRight onClose={() => setPopover(null)}>
          <ProjectsMenu
            entry={popoverEntry}
            config={config}
            onAddAnother={() => setPopover({ ...popover, kind: 'picker' })}
            onClose={() => setPopover(null)}
          />
        </Popover>
      )}
      {popover?.kind === 'picker' && popoverEntry && (
        <Popover anchorRect={popover.rect} alignRight onClose={() => setPopover(null)}>
          <ProjectPicker
            entries={[refOf(popoverEntry)]}
            label={{ branch: popoverEntry.branch ?? popoverEntry.shortSha ?? '' }}
            firstEntry={`${popoverEntry.repoName} / ${popoverEntry.branch ?? popoverEntry.shortSha}${
              popoverEntry.base ? ` · ${t('branches.baseName', { base: popoverEntry.base })}` : ''
            }`}
            excludeProjectIds={projectsOf(config, popoverEntry.key).map((p) => p.id)}
            onAdded={setJustAdded}
            onDone={() => setPopover(null)}
          />
        </Popover>
      )}
      {popover?.kind === 'menu' && popoverEntry && (
        <Popover anchorRect={popover.rect} width={260} alignRight={!popover.atPointer} onClose={() => setPopover(null)}>
          <RowMenu
            entry={popoverEntry}
            isBase={scans.some((s) => s.repo.id === popoverEntry.repoId && isBaseRow(s, popoverEntry))}
            onClose={() => setPopover(null)}
          />
        </Popover>
      )}
      {popover?.kind === 'base' && popoverEntry && (
        <BaseMenu
          repoId={popoverEntry.repoId}
          entryKey={popoverEntry.key}
          branchName={popoverEntry.branch ?? popoverEntry.shortSha ?? ''}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
}

function SelectionBar({ selected, onAdded }: { selected: EntrySummary[]; onAdded: (keys: string[]) => void }) {
  const [pickAt, setPickAt] = useState<DOMRect | null>(null);
  const clear = () => useUi.getState().setSelectedKeys([]);
  const refs = selected.map(refOf);
  const repos = new Set(selected.map((e) => e.repoId)).size;
  const newProject = () => {
    clear();
    startDraftProject(refs);
  };

  return (
    <div role="toolbar" aria-label={t('branches.selectionBar')} className={styles.selectionBar}>
      <span className={styles.selCount}>{t('branches.selCount', { ...cnt(selected.length) })}</span>
      <span className={styles.selRepos}>{t('branches.selAcross', { ...cnt(repos) })}</span>
      <span className={styles.selDivider} />
      <button type="button" className={styles.selAdd} onClick={(e) => setPickAt(e.currentTarget.getBoundingClientRect())}>
        {t('branches.addToProject')}
        <ChevronDownIcon />
      </button>
      <Button variant="primary" onClick={newProject}>
        {t('sidebar.newProject')}
      </Button>
      <button type="button" aria-label={t('branches.clearSelection')} className={styles.selClear} onClick={clear}>
        <CloseIcon />
      </button>
      {pickAt && (
        <Popover anchorRect={pickAt} above onClose={() => setPickAt(null)}>
          <ProjectPicker
            entries={refs}
            label={t('branches.selCount', { ...cnt(selected.length) })}
            firstEntry=""
            onNewProject={newProject}
            onAdded={onAdded}
            onDone={() => {
              setPickAt(null);
              clear();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function RepoSection({
  group: { scan, rows, stashes, remotes },
  config,
  flash,
  open,
  onToggle,
  stashesOpen,
  onToggleStashes,
  selectedKeys,
  justAdded,
  popover,
  onPopover,
}: {
  group: RepoGroup;
  config: Config;
  flash: boolean;
  open: boolean;
  /** `all`: ⌥-click, for every band. */
  onToggle: (all: boolean) => void;
  stashesOpen: boolean;
  onToggleStashes: () => void;
  selectedKeys: string[];
  justAdded: string[];
  popover: RowPopover | null;
  onPopover: (p: RowPopover) => void;
}) {
  const pinned = config.pinnedRepos.includes(scan.repo.id);
  const remote = scan.active.find((e) => e.upstream)?.upstream?.remote ?? scan.remotes[0]?.name.split('/')[0];
  return (
    <section id={`repo-${scan.repo.id}`} className={styles.section}>
      <div className={flash ? `${styles.band} ${styles.flash}` : styles.band}>
        <button
          type="button"
          className={styles.bandToggle}
          aria-expanded={open}
          // ⌥-click: every band. Listed in lib/shortcuts.ts.
          onClick={(ev) => onToggle(ev.altKey)}
        >
          <ChevronDownIcon size={12} className={open ? styles.bandChevron : `${styles.bandChevron} ${styles.bandShut}`} />
          <FolderIcon size={16} className={styles.bandIcon} />
          <span className={styles.repoName}>{scan.name}</span>
          <span className={styles.repoPath}>{tildifyHome(scan.repo.path)}</span>
        </button>
        {scan.status === 'ok' && remote && (
          <RepoFetchButton repoId={scan.repo.id} repoName={scan.name} remote={remote} className={styles.fetch} />
        )}
        {scan.status === 'missing' ? (
          <Pill tone="danger" onClick={() => openSettings('repositories')}>
            {t('branches.pathNotFound')}
          </Pill>
        ) : scan.status === 'error' ? (
          <Pill tone="danger" title={scan.error ?? undefined}>
            {t('branches.gitError')}
          </Pill>
        ) : (
          <span className={styles.count} title={t('branches.subBranches', { ...cnt(rows.length) })}>
            {formatCount(rows.length)}
          </span>
        )}
        <IconButton
          size={24}
          aria-label={pinned ? t('branches.unpinName', { name: scan.name }) : t('branches.pinName', { name: scan.name })}
          aria-pressed={pinned}
          title={pinned ? t('branches.unpin') : t('branches.pinToTop')}
          className={pinned ? `${styles.pin} ${styles.pinned}` : styles.pin}
          onClick={() => void setRepoPinned(scan.repo.id, !pinned)}
        >
          <PinIcon size={13} />
        </IconButton>
      </div>
      {open && rows.map((e) => (
        <Row
          key={e.key}
          entry={e}
          isBase={isBaseRow(scan, e)}
          projectNames={sortProjects(projectsOf(config, e.key), readProjectSort()).map((p) => p.name)}
          selected={selectedKeys.includes(e.key)}
          justAdded={justAdded.includes(e.key)}
          popover={popover?.key === e.key ? popover.kind : null}
          onPopover={(kind, rect, atPointer) => onPopover({ kind, key: e.key, rect, atPointer })}
        />
      ))}
      {open && stashes.length > 0 && (
        <StashList
          repoId={scan.repo.id}
          repoName={scan.name}
          stashes={stashes}
          collapsed={!stashesOpen}
          onToggle={onToggleStashes}
        />
      )}
      {open && remotes.length > 0 && <RemoteList repoId={scan.repo.id} remotes={remotes} />}
    </section>
  );
}

/** The repo's stash stack under its rows (flow P1); a row or its menu opens the stash review. */
function StashList({
  repoId,
  repoName,
  stashes,
  collapsed,
  onToggle,
}: {
  repoId: string;
  repoName: string;
  stashes: StashInfo[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const push = useNav((s) => s.push);
  const [menu, setMenu] = useState<{ sha: string; rect: DOMRect } | null>(null);
  // Apply to… / Pop to…: the worktree picker (P5) beside the item, on hover or click.
  // `focus`: opened by click or keyboard, so its first item takes the focus (not on hover).
  const [sub, setSub] = useState<{ pop: boolean; el: HTMLElement; focus?: boolean } | null>(null);
  const closeMenu = () => {
    setSub(null);
    setMenu(null);
  };
  const picked = stashes.find((st) => st.sha === menu?.sha);
  const stash = picked && { ...picked, repoId, repoName };
  const open = (sha: string) =>
    push({ name: 'review', target: { kind: 'stashes', repoId }, focusKey: sha, backLabel: t('branches.backToBranches') });
  return (
    <div className={styles.stashes}>
      <List
        heading={t('branches.stashes')}
        label={t('branches.stashes')}
        collapsed={collapsed}
        onToggle={onToggle}
        items={stashes.map((st) => ({
          key: st.sha,
          lead: 'icon',
          icon: 'package',
          prefix: `stash@{${st.index}}`,
          title: st.message,
          active: menu?.sha === st.sha,
          sub: stashSub(st),
          actions: [
            {
              icon: 'more-vertical',
              ariaLabel: t('branches.stashOptions'),
              active: menu?.sha === st.sha,
              onPress: (e) => {
                e.stopPropagation();
                setMenu({ sha: st.sha, rect: e.currentTarget.getBoundingClientRect() });
              },
            },
          ],
          rowProps: { className: styles.stashRow, onClick: () => open(st.sha) },
        }))}
      />
      {menu && stash && (
        <Popover anchorRect={menu.rect} width={240} alignRight onClose={closeMenu}>
          <Menu aria-label={t('branches.stashActions')}>
            <MenuItem kbd="↵" onHover={() => setSub(null)} onSelect={() => open(menu.sha)}>
              {t('stash.reviewChanges')}
            </MenuItem>
            <MenuItem submenu onHover={(el) => setSub({ pop: false, el })} onSelect={(el) => setSub({ pop: false, el, focus: true })}>
              {t('stash.applyTo')}
            </MenuItem>
            <MenuItem submenu onHover={(el) => setSub({ pop: true, el })} onSelect={(el) => setSub({ pop: true, el, focus: true })}>
              {t('stash.popTo')}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              kbd="⌫"
              danger
              onHover={() => setSub(null)}
              onSelect={() => {
                closeMenu();
                askDrop(stash);
              }}
            >
              {t('stash.drop')}
            </MenuItem>
          </Menu>
          {sub && (
            <Popover
              anchor={sub.el}
              anchorRect={sub.el.getBoundingClientRect()}
              side="right"
              width={280}
              onClose={() => setSub(null)}
            >
              <div
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  sub.el.focus();
                  setSub(null);
                }}
              >
                <StashTargetMenu
                  key={String(sub.pop)}
                  stash={stash}
                  pop={sub.pop}
                  autoFocus={!!sub.focus}
                  onDone={closeMenu}
                />
              </div>
            </Popover>
          )}
        </Popover>
      )}
    </div>
  );
}

/** Remote Branches matching the filter, under the band's rows; a row opens its History. */
function RemoteList({ repoId, remotes }: { repoId: string; remotes: RemoteBranch[] }) {
  const [menu, setMenu] = useState<{ name: string; rect: DOMRect } | null>(null);
  const open = (rev: string) => openHistory(repoId, rev, t('branches.backToBranches'));
  return (
    <div className={styles.remotes}>
      <List
        heading={t('branches.remoteBranches')}
        items={remotes.map((r) => ({
          key: r.name,
          lead: 'icon',
          icon: 'branch',
          title: r.name,
          titleMono: true,
          active: menu?.name === r.name,
          sub: [{ text: ageText(r.lastCommitAt) }],
          actions: [
            {
              icon: 'more-vertical',
              ariaLabel: t('branches.remoteOptions'),
              active: menu?.name === r.name,
              onPress: (e) => {
                e.stopPropagation();
                setMenu({ name: r.name, rect: e.currentTarget.getBoundingClientRect() });
              },
            },
          ],
          rowProps: { className: styles.remoteRow, title: t('branches.showHistoryOf', { name: r.name }), onClick: () => open(r.name) },
        }))}
      />
      {menu && (
        <Popover anchorRect={menu.rect} width={240} alignRight onClose={() => setMenu(null)}>
          <Menu aria-label={t('branches.remoteActions')}>
            <MenuItem icon={<HistoryIcon />} kbd="↵" onSelect={() => open(menu.name)}>
              {t('branches.openHistory')}
            </MenuItem>
            <MenuItem
              icon={<CopyIcon />}
              onSelect={() => {
                void writeText(menu.name);
                setMenu(null);
              }}
            >
              {t('common.copyBranchName')}
            </MenuItem>
          </Menu>
        </Popover>
      )}
    </div>
  );
}

function stashSub(st: StashInfo): ListSubPart[] {
  const branch: ListSubPart = st.branch
    ? st.branchExists
      ? { pill: st.branch, tone: 'accent' }
      : { pill: t('branches.stashDeleted', { branch: st.branch }), tone: 'outline' }
    : { pill: t('branches.detachedHead'), tone: 'outline' };
  const parts: ListSubPart[] = [branch];
  if (st.files !== null) parts.push({ text: t('branches.fileCount', { ...cnt(st.files) }) });
  parts.push({ text: ageText(st.createdAt) });
  return parts;
}

function Row({
  entry: e,
  isBase,
  projectNames,
  selected,
  justAdded,
  popover,
  onPopover,
}: {
  entry: EntrySummary;
  /** The repo's base branch: always listed, opens History instead of Review (T20.3). */
  isBase: boolean;
  projectNames: string[];
  selected: boolean;
  justAdded: boolean;
  popover: RowPopover['kind'] | null;
  onPopover: (kind: RowPopover['kind'], rect: DOMRect, atPointer?: boolean) => void;
}) {
  const wt = e.worktreePath ? tildifyHome(e.worktreePath) : null;
  const counts = afu(e);
  const [head, tail] = middleCut(e.branch ?? e.shortSha ?? '');
  const open = () => openReview(e);
  const toggle = () => {
    const ui = useUi.getState();
    ui.setSelectedKeys(selected ? ui.selectedKeys.filter((k) => k !== e.key) : [...ui.selectedKeys, e.key]);
  };
  const hot = popover === 'projects' || popover === 'picker' || popover === 'menu';
  const cls = [styles.grid, styles.row, selected && styles.selected, hot && styles.hot]
    .filter(Boolean)
    .join(' ');
  const name = e.branch ?? e.shortSha ?? '';
  const n = projectNames.length;
  const cellCls = [
    styles.projects,
    n > 0 ? styles.projectsChip : styles.projectsNone,
    popover === 'picker' && styles.projectsPicking,
    popover === 'projects' && styles.projectsOpen,
    justAdded && popover === null && styles.projectsAdded,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onPopover('menu', new DOMRect(ev.clientX, ev.clientY, 0, 0), true);
      }}
    >
      {isBase ? (
        <span />
      ) : (
        <Checkbox aria-label={t('branches.selectBranch', { name })} className={styles.check} checked={selected} onChange={toggle} />
      )}
      <div className={styles.branchCell}>
        {isBase ? (
          <span className={styles.nameLine}>
            <button type="button" className={styles.branchName} onClick={() => openEntryHistory(e)} title={t('branches.showHistoryOf', { name })}>
              <span className={styles.nameHead}>{name}</span>
            </button>
            <Pill tone="outline" size="sm">
              {t('branches.basePill')}
            </Pill>
          </span>
        ) : (
          <button type="button" className={styles.branchName} onClick={open} title={e.branch ?? e.headSha ?? ''}>
            <span className={styles.nameHead}>{head}</span>
            {tail && <span className={styles.nameTail}>{tail}</span>}
          </button>
        )}
        <span className={styles.subLine}>
          {e.base && <span className={styles.base}>{t('branches.baseName', { base: e.base })}</span>}
          {e.base && <span className={styles.sep}>·</span>}
          <span title={counts.title}>
            {counts.a}
            <span className={styles.sep}> / </span>
            {counts.f}
            <span className={styles.sep}> / </span>
            <span className={e.uncommitted ? styles.dirty : styles.sep}>{counts.u}</span>
          </span>
          <span className={styles.sep}>·</span>
          <span
            title={
              e.changedAt
                ? `${ageTitle(e.changedAt)} · ${t('branches.lastChangeUncommitted')}`
                : e.lastCommitAt
                  ? ageTitle(e.lastCommitAt)
                  : undefined
            }
          >
            {e.changedAt ? ageText(e.changedAt) : e.lastCommitAt ? ageText(e.lastCommitAt) : '—'}
          </span>
          <StateCell entry={e} onBase={(rect) => onPopover('base', rect)} />
          {e.operation && <OperationPill op={e.operation} />}
          {e.conflicts > 0 && (
            <Pill tone="danger" size="sm" title={conflictsTooltip(e)}>
              {t('branches.conflictCount', { ...cnt(e.conflicts) })}
            </Pill>
          )}
        </span>
        {/* Line 3 is always there, so every row has the same height. */}
        {wt ? (
          <span className={styles.wtLine} title={t('branches.checkedOutIn', { path: wt })}>
            <WorktreeIcon size={12} className={styles.wtIcon} />
            <span className={styles.wtPath}>{wt}</span>
          </span>
        ) : (
          <span className={`${styles.wtLine} ${styles.wtNone}`} title={t('branches.notCheckedOutFull')}>
            <WorktreeIcon size={12} className={styles.wtIcon} />
            <span className={styles.wtPath}>—</span>
          </span>
        )}
      </div>
      {isBase ? (
        <button type="button" className={styles.historyButton} title={t('branches.baseHistoryOf', { name })} onClick={() => openEntryHistory(e)}>
          <HistoryIcon size={12} />
          {t('branches.historyBtn')}
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          className={cellCls}
          title={projectNames.join(', ') || undefined}
          onClick={(ev) => onPopover(n > 0 ? 'projects' : 'picker', ev.currentTarget.getBoundingClientRect())}
        >
          {n > 0 ? (
            <>
              <span>{t('branches.inCount', { ...cnt(n) })}</span>
              <ChevronDownIcon size={10} />
            </>
          ) : (
            <>
              <span className={styles.projectsDash}>—</span>
              <span className={styles.projectsAdd}>{t('branches.projectsAdd')}</span>
            </>
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={t('branches.branchOptions')}
        aria-haspopup="menu"
        className={popover === 'menu' ? `${styles.rowMenu} ${styles.rowMenuOpen}` : styles.rowMenu}
        onClick={(ev) => onPopover('menu', ev.currentTarget.getBoundingClientRect())}
      >
        <MoreVerticalIcon size={14} />
      </button>
    </div>
  );
}

/** The row's ⋯ menu: Copy Branch Name and Open History (Open Review on the base row, whose name
 * already opens History), the always-listed open items, the Scripts group, then the closing note. */
function RowMenu({ entry, isBase, onClose }: { entry: EntrySummary; isBase: boolean; onClose: () => void }) {
  return (
    <Menu aria-label={t('branches.branchOptions')} autoFocus>
      <CopyBranchItem entry={entry} onDone={onClose} />
      {isBase ? (
        <MenuItem
          icon={<SplitIcon />}
          onSelect={() => {
            onClose();
            openReview(entry);
          }}
        >
          {t('branches.openReview')}
        </MenuItem>
      ) : (
        (entry.branch ?? entry.headSha) && (
          <MenuItem
            icon={<HistoryIcon />}
            onSelect={() => {
              onClose();
              openEntryHistory(entry);
            }}
          >
            {t('branches.openHistory')}
          </MenuItem>
        )
      )}
      <MenuDivider />
      <OpenItems entry={entry} onDone={onClose} />
      <SyncItems entry={entry} onDone={onClose} />
      <ScriptsMenu entry={entry} menu="branches" onDone={onClose} />
      <EntryMenuNote entry={entry} />
    </Menu>
  );
}

/** Review (SPEC §5) of a row: the branch against its base, or the base branch against its upstream. */
function openReview(e: EntrySummary) {
  useNav.getState().push({
    name: 'review',
    target: { kind: 'branch', repoId: e.repoId, branch: e.branch, worktreePath: e.worktreePath, tipOverride: null },
    backLabel: t('branches.backToBranches'),
  });
}

/** History (SPEC §16) of a row's branch, or of its SHA for a detached HEAD. */
function openEntryHistory(e: EntrySummary) {
  openHistory(e.repoId, e.branch ?? e.headSha, t('branches.backToBranches'));
}

/** Flow I: the projects a branch is in, and adding it to another one. */
function ProjectsMenu({
  entry,
  config,
  onAddAnother,
  onClose,
}: {
  entry: EntrySummary;
  config: Config;
  onAddAnother: () => void;
  onClose: () => void;
}) {
  const push = useNav((s) => s.push);
  const projects = sortProjects(projectsOf(config, entry.key), readProjectSort());
  return (
    <Menu aria-label={t('branches.projectsFor', { name: entry.branch ?? entry.shortSha ?? '' })} autoFocus>
      <MenuLabel>{t('branches.inCount', { ...cnt(projects.length) })}</MenuLabel>
      {projects.map((p) => (
        <MenuItem
          key={p.id}
          dot
          arrow
          onSelect={() => {
            onClose();
            push({ name: 'project', projectId: p.id });
          }}
        >
          {p.name}
        </MenuItem>
      ))}
      <MenuDivider />
      <MenuItem accent onSelect={onAddAnother}>
        {t('branches.addAnother')}
      </MenuItem>
    </Menu>
  );
}

/** The state pill, at the end of the sub line. */
function StateCell({ entry: e, onBase }: { entry: EntrySummary; onBase: (rect: DOMRect) => void }) {
  switch (e.state) {
    case 'merged':
      return (
        <Pill tone="success" size="sm" title={e.base ? t('branches.mergedInto', { base: e.base }) : undefined}>
          {t('branches.merged')}
        </Pill>
      );
    case 'detached':
      return (
        <Pill tone="warning" size="sm">
          {t('branches.detachedHead')}
        </Pill>
      );
    case 'base_missing':
      return (
        <Pill
          tone="warning"
          size="sm"
          title={e.error ?? undefined}
          onClick={(ev) => onBase(ev.currentTarget.getBoundingClientRect())}
        >
          {t('branches.baseMissing')}
        </Pill>
      );
    case 'git_error':
      return (
        <Pill tone="danger" size="sm" title={e.error ?? undefined}>
          {t('branches.gitErr')}
        </Pill>
      );
    default:
      return null;
  }
}
