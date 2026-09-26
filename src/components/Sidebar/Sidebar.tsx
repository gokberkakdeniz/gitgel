import { useMemo, useRef, useState } from 'react';
import { startDraftProject } from '../../lib/draft';
import { openAddRepos } from '../../lib/addRepos';
import { plural } from '../../lib/format';
import { readProjectSort, sortProjects, writeProjectSort, type ProjectSort } from '../../lib/projectSort';
import { branchCount } from '../../screens/Branches/rows';
import { selectRepoScans, useData } from '../../state/data';
import { selectCanBack, selectCanForward, selectRoute, useNav } from '../../state/nav';
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
} from '../icons';
import { IconButton } from '../IconButton';
import { Menu, MenuItem } from '../Menu';
import { Popover } from '../Popover';
import { ProjectMenu } from '../ProjectMenu';
import { TextInput } from '../TextInput';
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

  const go = (name: 'branches' | 'settings') => {
    if (route.name !== name) push({ name });
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
          onClick={() => go('branches')}
        >
          <BranchIcon className={styles.branchIcon} />
          <span className={styles.grow}>Branches</span>
          <span className={styles.count}>{rowCount}</span>
        </button>
      </div>

      <ProjectList activeId={route.name === 'project' ? route.projectId : null} draftName={onDraft ? draft?.name : undefined} />

      <div className={styles.footer}>
        <button type="button" className={styles.repoRow} onClick={() => go('settings')}>
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
          onClick={() => go('settings')}
        >
          <GearIcon />
        </button>
      </div>
    </nav>
  );
}

function ProjectList({ activeId, draftName }: { activeId: string | null; draftName?: string }) {
  const projects = useData((s) => s.config?.projects);
  const push = useNav((s) => s.push);
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<ProjectSort>(readProjectSort);
  const [sortMenu, setSortMenu] = useState<DOMRect | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
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
  const open = (id: string) => {
    if (id !== activeId) push({ name: 'project', projectId: id });
  };

  return (
    <>
      <div className={styles.projectsHeader}>
        {filtering ? (
          <TextInput
            ref={filterRef}
            autoFocus
            className={styles.projectFilter}
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
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
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === activeId ? `${styles.projectRow} ${styles.active}` : styles.projectRow}
            onClick={() => open(p.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ id: p.id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
            }}
          >
            <span className={p.id === activeId ? `${styles.dot} ${styles.dotActive}` : styles.dot} />
            <span className={styles.projectName}>{p.name}</span>
          </button>
        ))}
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
              open(contextMenu.id);
              useUi.getState().setRenamingProjectId(contextMenu.id);
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
