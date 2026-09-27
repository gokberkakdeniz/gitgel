import { useEffect, useMemo, useRef, useState } from 'react';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { BranchLargeIcon, ChevronDownIcon, CloseIcon, FolderIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker';
import { RefreshButton } from '../../components/RefreshButton';
import { Segmented } from '../../components/Segmented';
import { openAddRepos } from '../../lib/addRepos';
import { startDraftProject } from '../../lib/draft';
import { formatAge, plural } from '../../lib/format';
import { tildifyHome } from '../../lib/paths';
import { readProjectSort, sortProjects } from '../../lib/projectSort';
import { refOf } from '../../lib/projects';
import type { Config, EntrySummary } from '../../lib/types';
import { selectRepoScans, useData } from '../../state/data';
import { selectRoute, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import styles from './Branches.module.css';
import { FilterField } from './FilterField';
import { branchGroups, projectsOf, scopeCounts, type BranchScope, type RepoGroup } from './rows';

export function Branches() {
  const config = useData((s) => s.config);
  if (!config) return null;
  return config.repos.length === 0 ? <FirstRun /> : <BranchList />;
}

function FirstRun() {
  return (
    <>
      <PageHeader title="Branches" subtitle="Nothing to review yet" />
      <div className={styles.center}>
        <div className={styles.emptyBody}>
          <BranchLargeIcon className={styles.emptyIcon} />
          <h2 className={styles.emptyTitle}>No repositories yet</h2>
          <p className={styles.emptyText}>
            Add the git repositories you want to watch. Branches and worktrees are read in place;
            nothing is checked out or changed.
          </p>
          <Button variant="primary" size={40} className={styles.emptyButton} onClick={() => void openAddRepos()}>
            Add repository…
          </Button>
          <span className={styles.emptyHint}>or drop folders onto this window</span>
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

/** A popover opened from a row: its Projects menu, the project picker, or the base menu. */
type RowPopover =
  | { kind: 'projects'; key: string; rect: DOMRect }
  | { kind: 'picker'; key: string; rect: DOMRect }
  | { kind: 'base'; key: string; rect: DOMRect };

function BranchList() {
  const config = useData((s) => s.config)!;
  const scan = useData((s) => s.scan);
  const scannedOnce = useData((s) => s.scannedOnce);
  const filter = useUi((s) => s.branchesFilter);
  const setFilter = useUi((s) => s.setBranchesFilter);
  const filterRef = useRef<HTMLInputElement>(null);

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

  // Arriving from a repo name: clear the filter, scroll to its band and flash it.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRepoId) return;
    useUi.getState().setBranchesFilter('');
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

  const shownRepos = groups.filter((g) => g.rows.length > 0).length;
  const subtitle = `${scope === 'all' ? 'Active branches' : 'Active branches not in any project'} · ${plural(
    shownRepos,
    'repo',
    'repos',
  )} · checked out in a worktree, or committed in the last ${days} days`;

  let body;
  // Repos appear as they finish scanning; the rest are counted below the list.
  const pending = config.repos.length - scans.length;
  const pendingNote =
    pending > 0 ? (
      <div className={styles.pending}>
        Scanning {plural(pending, 'more repository', 'more repositories')}…
      </div>
    ) : null;
  if (groups.length === 0 && (pending > 0 || !scannedOnce)) {
    body = <div className={`${styles.center} ${styles.muted}`}>Scanning repositories…</div>;
  } else if (groups.length === 0 && filter.trim()) {
    body = <div className={`${styles.center} ${styles.muted}`}>No branches match “{filter.trim()}”</div>;
  } else if (groups.length === 0 && scope === 'unassigned' && counts.all > 0) {
    body = (
      <div className={styles.center}>
        <h2 className="page-title">Every active branch is in a project</h2>
      </div>
    );
  } else if (groups.length === 0) {
    body = (
      <div className={styles.center}>
        <div className={styles.emptyBody}>
          <h2 className="page-title">No active branches</h2>
          <p className={styles.emptyText}>
            Branches checked out in a worktree or committed in the last {days} days show up here.
          </p>
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
      <PageHeader title="Branches" subtitle={subtitle}>
        <RefreshButton />
        <Segmented
          aria-label="Show branches"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'unassigned', label: 'Not in a project', count: counts.unassigned },
          ]}
        />
        <FilterField ref={filterRef} value={filter} onChange={setFilter} />
      </PageHeader>
      <div className={styles.table}>
        <div className={`${styles.grid} ${styles.columns}`}>
          <span />
          <span>Branch</span>
          <span>Ahead</span>
          <span>Files</span>
          <span>Uncommitted</span>
          <span>State</span>
          <span>Projects</span>
          <span>Age</span>
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
            label={<span className={styles.toastBranch}>{popoverEntry.branch ?? popoverEntry.shortSha}</span>}
            firstEntry={`${popoverEntry.repoName} / ${popoverEntry.branch ?? popoverEntry.shortSha}${
              popoverEntry.base ? ` · base ${popoverEntry.base}` : ''
            }`}
            excludeProjectIds={projectsOf(config, popoverEntry.key).map((p) => p.id)}
            onAdded={setJustAdded}
            onDone={() => setPopover(null)}
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
    <div role="toolbar" aria-label="Selection" className={styles.selectionBar}>
      <span className={styles.selCount}>{plural(selected.length, 'branch', 'branches')} selected</span>
      <span className={styles.selRepos}>across {plural(repos, 'repo', 'repos')}</span>
      <span className={styles.selDivider} />
      <button type="button" className={styles.selAdd} onClick={(e) => setPickAt(e.currentTarget.getBoundingClientRect())}>
        Add to project
        <ChevronDownIcon />
      </button>
      <Button variant="primary" onClick={newProject}>
        New project
      </Button>
      <button type="button" aria-label="Clear selection" className={styles.selClear} onClick={clear}>
        <CloseIcon />
      </button>
      {pickAt && (
        <Popover anchorRect={pickAt} above onClose={() => setPickAt(null)}>
          <ProjectPicker
            entries={refs}
            label={plural(selected.length, 'branch', 'branches')}
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
  group: { scan, rows },
  config,
  flash,
  selectedKeys,
  justAdded,
  popover,
  onPopover,
}: {
  group: RepoGroup;
  config: Config;
  flash: boolean;
  selectedKeys: string[];
  justAdded: string[];
  popover: RowPopover | null;
  onPopover: (p: RowPopover) => void;
}) {
  const push = useNav((s) => s.push);
  return (
    <section id={`repo-${scan.repo.id}`} className={styles.section}>
      <div className={flash ? `${styles.band} ${styles.flash}` : styles.band}>
        <FolderIcon size={16} className={styles.bandIcon} />
        <span className={styles.repoName}>{scan.name}</span>
        <span className={styles.repoPath}>{tildifyHome(scan.repo.path)}</span>
        {scan.status === 'missing' ? (
          <button type="button" className={styles.pillButton} onClick={() => push({ name: 'settings' })}>
            <Pill tone="danger">path not found</Pill>
          </button>
        ) : scan.status === 'error' ? (
          <Pill tone="danger" title={scan.error ?? undefined}>
            git error
          </Pill>
        ) : (
          <span className={styles.count}>{plural(rows.length, 'branch', 'branches')}</span>
        )}
      </div>
      {rows.map((e) => (
        <Row
          key={e.key}
          entry={e}
          projectNames={sortProjects(projectsOf(config, e.key), readProjectSort()).map((p) => p.name)}
          selected={selectedKeys.includes(e.key)}
          justAdded={justAdded.includes(e.key)}
          popover={popover?.key === e.key ? popover.kind : null}
          onPopover={(kind, rect) => onPopover({ kind, key: e.key, rect })}
        />
      ))}
    </section>
  );
}

function Row({
  entry: e,
  projectNames,
  selected,
  justAdded,
  popover,
  onPopover,
}: {
  entry: EntrySummary;
  projectNames: string[];
  selected: boolean;
  justAdded: boolean;
  popover: RowPopover['kind'] | null;
  onPopover: (kind: RowPopover['kind'], rect: DOMRect) => void;
}) {
  const push = useNav((s) => s.push);
  const where = e.worktreePath ? `worktree ${tildifyHome(e.worktreePath)}` : 'not checked out';
  const sub = e.base ? `base ${e.base} · ${where}` : where;
  const open = () =>
    push({
      name: 'review',
      target: { kind: 'branch', repoId: e.repoId, branch: e.branch, worktreePath: e.worktreePath, tipOverride: null },
      backLabel: 'Back to Branches',
    });
  const toggle = () => {
    const ui = useUi.getState();
    ui.setSelectedKeys(selected ? ui.selectedKeys.filter((k) => k !== e.key) : [...ui.selectedKeys, e.key]);
  };
  const hot = popover === 'projects' || popover === 'picker';
  const cls = [styles.grid, styles.row, selected && styles.selected, hot && styles.hot].filter(Boolean).join(' ');
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
    <div className={cls}>
      <Checkbox aria-label={`Select ${e.branch ?? e.shortSha}`} className={styles.check} checked={selected} onChange={toggle} />
      <div className={styles.branchCell}>
        <button type="button" className={styles.branchName} onClick={open} title={e.branch ?? e.headSha ?? ''}>
          {e.branch ?? e.shortSha}
        </button>
        <span className={styles.sub}>{sub}</span>
      </div>
      <span className={styles.mono}>{e.ahead === null ? '—' : `↑${e.ahead}`}</span>
      <span className={styles.mono}>{e.files ?? '—'}</span>
      {e.uncommitted ? (
        <span className={styles.dirty}>● {e.uncommitted} changed</span>
      ) : (
        <span className={styles.faint}>—</span>
      )}
      <StateCell entry={e} onBase={(rect) => onPopover('base', rect)} />
      <button
        type="button"
        aria-haspopup="menu"
        className={cellCls}
        title={projectNames.join(', ') || undefined}
        onClick={(ev) => onPopover(n > 0 ? 'projects' : 'picker', ev.currentTarget.getBoundingClientRect())}
      >
        {n > 0 ? (
          <>
            <span>{n === 1 ? '1 project' : `${n} projects`}</span>
            <ChevronDownIcon size={10} />
          </>
        ) : (
          <>
            <span className={styles.projectsDash}>—</span>
            <span className={styles.projectsAdd}>+ Add</span>
          </>
        )}
      </button>
      <span className={`${styles.mono} ${styles.age}`}>{e.lastCommitAt ? formatAge(e.lastCommitAt) : '—'}</span>
    </div>
  );
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={ref} role="menu" aria-label={`Projects containing ${entry.branch ?? entry.shortSha}`} className={styles.projMenu} onKeyDown={move}>
      <div className={styles.projMenuLabel}>In {plural(projects.length, 'project', 'projects')}</div>
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className={styles.projMenuItem}
          onClick={() => {
            onClose();
            push({ name: 'project', projectId: p.id });
          }}
        >
          <span className={styles.projDot} />
          <span className={styles.projName}>{p.name}</span>
          <span className={styles.projArrow}>→</span>
        </button>
      ))}
      <div className={styles.projDivider} />
      <button type="button" role="menuitem" className={`${styles.projMenuItem} ${styles.projAddAnother}`} onClick={onAddAnother}>
        + Add to another project…
      </button>
    </div>
  );
}

function StateCell({ entry: e, onBase }: { entry: EntrySummary; onBase: (rect: DOMRect) => void }) {
  switch (e.state) {
    case 'merged':
      return <Pill tone="success" className={styles.pill}>merged into {e.base}</Pill>;
    case 'detached':
      return <Pill tone="warning" className={styles.pill}>detached HEAD</Pill>;
    case 'base_missing':
      return (
        <button
          type="button"
          className={`${styles.pillButton} ${styles.pill}`}
          title={e.error ?? undefined}
          onClick={(ev) => onBase(ev.currentTarget.getBoundingClientRect())}
        >
          <Pill tone="warning">base missing</Pill>
        </button>
      );
    case 'git_error':
      return <Pill tone="danger" className={styles.pill} title={e.error ?? undefined}>git error</Pill>;
    default:
      return <span className={styles.faint}>—</span>;
  }
}
