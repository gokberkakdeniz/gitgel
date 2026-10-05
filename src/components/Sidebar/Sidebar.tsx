import { useMemo, useRef, useState } from 'react';
import { installUpdate } from '../../lib/ipc';
import { startDraftProject } from '../../lib/draft';
import { openAddRepos } from '../../lib/addRepos';
import { plural } from '../../lib/format';
import type { AppError, ProjectConfig } from '../../lib/types';
import { readProjectSort, sortProjects, writeProjectSort, type ProjectSort } from '../../lib/projectSort';
import { branchCount } from '../../screens/Branches/rows';
import { selectRepoScans, useData } from '../../state/data';
import { openSettings, selectCanBack, selectCanForward, selectRoute, useNav, type Route } from '../../state/nav';
import { useUi } from '../../state/ui';
import {
  BackIcon,
  BranchIcon,
  FolderIcon,
  ForwardIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
  SlidersIcon,
  UpdateIcon,
} from '../icons';
import { IconButton } from '../IconButton';
import { Menu, MenuItem } from '../Menu';
import { Popover } from '../Popover';
import { ProjectNameInput } from '../ProjectNameInput';
import { ProjectMenu } from '../ProjectMenu';
import { Input } from '../Input';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const route = useNav(selectRoute);
  const canBack = useNav(selectCanBack);
  const canForward = useNav(selectCanForward);
  const { back, forward, push } = useNav.getState();
  const setSidebarVisible = useUi((s) => s.setSidebarVisible);
  const config = useData((s) => s.config);
  const scan = useData((s) => s.scan);
  const repoCount = config?.repos.length ?? 0;
  const rowCount = useMemo(() => branchCount(config, selectRepoScans({ config, scan })), [config, scan]);

  const draft = useUi((s) => s.draftProject);
  const onDraft = route.name === 'project' && route.projectId === 'draft';

  const goBranches = () => {
    if (route.name !== 'branches') push({ name: 'branches' });
  };

  return (
    <nav className={styles.sidebar}>
      <div className={styles.top} data-tauri-drag-region>
        <div className={styles.lights} data-tauri-drag-region />
        <IconButton aria-label="Toggle sidebar" onClick={() => setSidebarVisible(false)}>
          <SidebarIcon />
        </IconButton>
        <IconButton aria-label="Back" onClick={back} disabled={!canBack}>
          <BackIcon />
        </IconButton>
        <IconButton aria-label="Forward" onClick={forward} disabled={!canForward}>
          <ForwardIcon />
        </IconButton>
      </div>

      <div className={styles.nav}>
        <button
          type="button"
          className={onDraft ? `${styles.row} ${styles.active}` : styles.row}
          title="New project (⌘N)"
          onClick={() => startDraftProject([])}
        >
          <span className={styles.plus}>
            <PlusIcon />
          </span>
          <span>New project</span>
        </button>
        <button
          type="button"
          className={route.name === 'branches' ? `${styles.row} ${styles.active}` : styles.row}
          onClick={() => goBranches()}
        >
          <BranchIcon className={styles.branchIcon} />
          <span className={styles.grow}>Branches</span>
          <span className={styles.count}>{rowCount}</span>
        </button>
      </div>

      <ProjectList route={route} draftName={onDraft ? draft?.name : undefined} />

      <UpdateRow />

      <div className={styles.footer}>
        <button type="button" className={styles.repoRow} onClick={() => openSettings('repositories')}>
          <FolderIcon className={styles.folderIcon} />
          <span className={styles.grow}>{plural(repoCount, 'repository', 'repositories')}</span>
        </button>
        <button
          type="button"
          aria-label="Add repository"
          title="Add repository…"
          className={styles.repoAdd}
          onClick={() => void openAddRepos()}
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className={route.name === 'settings' ? `${styles.gear} ${styles.gearActive}` : styles.gear}
          onClick={() => openSettings()}
        >
          <GearIcon />
        </button>
      </div>
    </nav>
  );
}

function ProjectList({ route, draftName }: { route: Route; draftName?: string }) {
  const projects = useData((s) => s.config?.projects);
  const pageId = route.name === 'project' ? route.projectId : null;
  const reviewId = route.name === 'review' && route.target.kind === 'project' ? route.target.projectId : null;
  const activeId = pageId ?? reviewId;
  const push = useNav((s) => s.push);
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<ProjectSort>(readProjectSort);
  const [sortMenu, setSortMenu] = useState<DOMRect | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
    return sortProjects(shown, sort);
  }, [projects, filter, sort]);

  const chooseSort = (order: ProjectSort) => {
    setSort(order);
    setSortMenu(null);
    writeProjectSort(order);
  };
  const closeFilter = () => {
    setFiltering(false);
    setFilter('');
  };
  const openPage = (id: string) => {
    if (id !== pageId) push({ name: 'project', projectId: id });
  };
  // A project with entries opens its review (the pencil there opens the page); an empty one its page.
  const open = (id: string) => {
    if (!projects?.find((p) => p.id === id)?.entries.length) openPage(id);
    else if (id !== reviewId)
      push({ name: 'review', target: { kind: 'project', projectId: id }, backLabel: 'Back', keepSidebar: true });
  };

  return (
    <>
      <div className={styles.projectsHeader}>
        {filtering ? (
          <Input
            ref={filterRef}
            autoFocus
            leftIcon="search"
            clearable
            size={28}
            className={styles.projectFilter}
            placeholder="Search"
            aria-label="Search projects"
            value={filter}
            onChange={setFilter}
            onKeyDown={(e) => e.key === 'Escape' && closeFilter()}
            onBlur={() => !filter && closeFilter()}
          />
        ) : (
          <span>Projects</span>
        )}
        <div className={styles.projectsActions}>
          {!filtering && (
            <IconButton aria-label="Search projects" onClick={() => setFiltering(true)}>
              <SearchIcon />
            </IconButton>
          )}
          <IconButton
            aria-label="Sort and filter projects"
            onClick={(e) => setSortMenu(e.currentTarget.getBoundingClientRect())}
          >
            <SlidersIcon />
          </IconButton>
        </div>
      </div>
      <div className={styles.projects}>
        {list.map((p) =>
          p.id === renamingId ? (
            <RenameRow key={p.id} project={p} active={p.id === activeId} onDone={() => setRenamingId(null)} />
          ) : (
            <button
              key={p.id}
              type="button"
              className={p.id === activeId ? `${styles.projectRow} ${styles.active}` : styles.projectRow}
              onClick={() => open(p.id)}
              onDoubleClick={() => setRenamingId(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ id: p.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
              }}
            >
              <span className={p.id === activeId ? `${styles.dot} ${styles.dotActive}` : styles.dot} />
              <span className={styles.projectName}>{p.name}</span>
            </button>
          ),
        )}
        {draftName !== undefined && (
          <div className={`${styles.projectRow} ${styles.active}`}>
            <span className={`${styles.dot} ${styles.dotActive}`} />
            <span className={styles.projectName}>{draftName || 'Untitled project'}</span>
          </div>
        )}
      </div>

      {sortMenu && (
        <Popover anchorRect={sortMenu} width={200} onClose={() => setSortMenu(null)}>
          <Menu aria-label="Sort projects">
            <MenuItem hint={sort === 'name' ? '✓' : undefined} onSelect={() => chooseSort('name')}>
              Sort by name
            </MenuItem>
            <MenuItem hint={sort === 'created' ? '✓' : undefined} onSelect={() => chooseSort('created')}>
              Sort by date created
            </MenuItem>
          </Menu>
        </Popover>
      )}
      {contextMenu && (
        <Popover anchorRect={contextMenu.rect} width={230} onClose={() => setContextMenu(null)}>
          <ProjectMenu
            onRename={() => {
              setRenamingId(contextMenu.id);
              setContextMenu(null);
            }}
            onDelete={() => {
              useUi.getState().setDeletingProjectId(contextMenu.id);
              setContextMenu(null);
            }}
          />
        </Popover>
      )}
    </>
  );
}

/** Shown while the update check has found a newer version: installs it and restarts. */
function UpdateRow() {
  const update = useData((s) => s.update);
  const progress = useData((s) => s.updateProgress);
  const [error, setError] = useState<string | null>(null);
  if (!update) return null;

  const install = async () => {
    setError(null);
    useData.getState().setUpdateProgress('unknown');
    try {
      await installUpdate(); // the app restarts when it succeeds
    } catch (e) {
      useData.getState().setUpdateProgress(null);
      setError((e as AppError).message ?? String(e));
    }
  };

  const installing = progress !== null;
  const label = installing
    ? `Updating…${typeof progress === 'number' ? ` ${progress}%` : ''}`
    : error
      ? 'Update failed · Retry'
      : `Update to ${update.version}`;
  const title =
    error ?? `You have ${update.currentVersion}`;
  return (
    <button
      type="button"
      className={error && !installing ? `${styles.update} ${styles.updateFailed}` : styles.update}
      title={title}
      disabled={installing}
      onClick={() => void install()}
    >
      <UpdateIcon className={styles.updateIcon} />
      <span className={styles.grow}>{label}</span>
    </button>
  );
}

/** Rename in place (right-click Rename or double-click): the row becomes an input. */
function RenameRow({ project, active, onDone }: { project: ProjectConfig; active: boolean; onDone: () => void }) {
  const cls = [styles.projectRow, styles.renameRow, active && styles.active].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className={active ? `${styles.dot} ${styles.dotActive}` : styles.dot} />
      <ProjectNameInput project={project} className={styles.renameInput} onDone={onDone} />
    </div>
  );
}
