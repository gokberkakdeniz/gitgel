import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { installUpdate } from '../../lib/ipc';
import { startDraftProject } from '../../lib/draft';
import { openAddRepos } from '../../lib/addRepos';
import { cnt, formatCount } from '../../lib/format';
import { t } from '../../i18n';
import type { AppError, ProjectConfig } from '../../lib/types';
import { readProjectSort, sortProjects, writeProjectSort, type ProjectSort } from '../../lib/projectSort';
import { branchCount } from '../../screens/Branches/rows';
import { selectRepoScans, useData } from '../../state/data';
import { openSettings, selectCanBack, selectCanForward, selectRoute, useNav, type Route } from '../../state/nav';
import { useUi } from '../../state/ui';
import { setSidebarVisible } from '../../lib/sidebar';
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
import { ResizeHandle, useStoredWidth } from '../ResizeHandle';
import { ProjectNameInput } from '../ProjectNameInput';
import { ProjectMenu } from '../ProjectMenu';
import { askDeleteProject } from '../DeleteProjectModal';
import { Input } from '../Input';
import styles from './Sidebar.module.css';

/** `peek`: the hidden sidebar shown over the page from the header's show-sidebar button; it
 * goes when the pointer leaves it (a menu it opened counts as inside), and its toggle pins it. */
export function Sidebar({ peek = false }: { peek?: boolean }) {
  const route = useNav(selectRoute);
  const canBack = useNav(selectCanBack);
  const canForward = useNav(selectCanForward);
  const { back, forward, push } = useNav.getState();
  const config = useData((s) => s.config);
  const scan = useData((s) => s.scan);
  const repoCount = config?.repos.length ?? 0;
  const rowCount = useMemo(() => branchCount(config, selectRepoScans({ config, scan })), [config, scan]);

  const draft = useUi((s) => s.draftProject);
  const onDraft = route.name === 'project' && route.projectId === 'draft';

  const goBranches = () => {
    if (route.name !== 'branches') push({ name: 'branches' });
  };

  // Resizable (200–400px, remembered; double-click resets), like Review's file list.
  const pane = useRef<HTMLElement>(null);
  const [width, setWidth] = useStoredWidth('gitgel.sidebarWidth');

  // Too narrow for "N repositories" (the header counts them too): the row hides and the "+" stays.
  const repoLabel = useRef<HTMLSpanElement>(null);
  const [repoNarrow, setRepoNarrow] = useState(false);
  const repoText = t('sidebar.repositories', { ...cnt(repoCount) });
  useLayoutEffect(() => {
    const el = repoLabel.current;
    if (!el) return;
    const measure = () => setRepoNarrow(el.scrollWidth > el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [repoText]);

  const peekBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!peek) return;
    const close = () => useUi.getState().setSidebarPeek(false);
    const over = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el && (peekBox.current?.contains(el) || el.closest('[data-popover], [data-sidebar-peek]'))) return;
      close();
    };
    // Out of the window: no element gets the pointer next.
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) close();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
    };
  }, [peek]);

  const sidebar = (
    <>
    <nav ref={pane} className={styles.sidebar} style={width ? { width } : undefined}>
      <div className={styles.top} data-tauri-drag-region>
        <div className={styles.lights} data-tauri-drag-region />
        <IconButton
          aria-label={peek ? t('nav.showSidebar') : t('sidebar.toggleSidebar')}
          onClick={() => setSidebarVisible(peek)}
        >
          <SidebarIcon />
        </IconButton>
        <IconButton aria-label={t('sidebar.back')} onClick={back} disabled={!canBack}>
          <BackIcon />
        </IconButton>
        <IconButton aria-label={t('sidebar.forward')} onClick={forward} disabled={!canForward}>
          <ForwardIcon />
        </IconButton>
      </div>

      <div className={styles.nav}>
        <button
          type="button"
          className={onDraft ? `${styles.row} ${styles.active}` : styles.row}
          title={t('sidebar.newProjectTitle')}
          onClick={() => startDraftProject([])}
        >
          <span className={styles.plus}>
            <PlusIcon />
          </span>
          <span>{t('sidebar.newProject')}</span>
        </button>
        <button
          type="button"
          className={route.name === 'branches' ? `${styles.row} ${styles.active}` : styles.row}
          onClick={() => goBranches()}
        >
          <BranchIcon className={styles.branchIcon} />
          <span className={styles.grow}>{t('sidebar.branches')}</span>
          <span className={styles.count}>{formatCount(rowCount)}</span>
        </button>
      </div>

      <ProjectList route={route} draftName={onDraft ? draft?.name : undefined} />

      <UpdateRow />

      <div className={repoNarrow ? `${styles.footer} ${styles.narrow}` : styles.footer}>
        <button
          type="button"
          className={styles.repoRow}
          tabIndex={repoNarrow ? -1 : undefined}
          aria-hidden={repoNarrow || undefined}
          onClick={() => openSettings('repositories')}
        >
          <FolderIcon className={styles.folderIcon} />
          <span ref={repoLabel} className={styles.grow}>{repoText}</span>
        </button>
        <button
          type="button"
          aria-label={t('sidebar.addRepository')}
          title={t('sidebar.addRepository')}
          className={styles.repoAdd}
          onClick={() => void openAddRepos()}
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          aria-label={t('sidebar.settings')}
          className={route.name === 'settings' ? `${styles.gear} ${styles.gearActive}` : styles.gear}
          onClick={() => openSettings()}
        >
          <GearIcon />
        </button>
      </div>
    </nav>
    <ResizeHandle pane={pane} min={200} max={400} onResize={setWidth} onReset={() => setWidth(null)} label={t('sidebar.resizeSidebar')} />
    </>
  );
  return peek ? (
    <div ref={peekBox} className={styles.peek}>
      {sidebar}
    </div>
  ) : (
    sidebar
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
      push({ name: 'review', target: { kind: 'project', projectId: id }, backLabel: t('sidebar.back') });
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
            placeholder={t('sidebar.search')}
            aria-label={t('sidebar.searchProjects')}
            value={filter}
            onChange={setFilter}
            onKeyDown={(e) => e.key === 'Escape' && closeFilter()}
            onBlur={() => !filter && closeFilter()}
          />
        ) : (
          <span>{t('sidebar.projects')}</span>
        )}
        <div className={styles.projectsActions}>
          {!filtering && (
            <IconButton aria-label={t('sidebar.searchProjects')} onClick={() => setFiltering(true)}>
              <SearchIcon />
            </IconButton>
          )}
          <IconButton
            aria-label={t('sidebar.sortFilterProjects')}
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
            <span className={styles.projectName}>{draftName || t('project.untitled')}</span>
          </div>
        )}
      </div>

      {sortMenu && (
        <Popover anchorRect={sortMenu} width={200} onClose={() => setSortMenu(null)}>
          <Menu aria-label={t('sidebar.sortProjects')}>
            <MenuItem checked={sort === 'name'} onSelect={() => chooseSort('name')}>
              {t('sidebar.sortByName')}
            </MenuItem>
            <MenuItem checked={sort === 'created'} onSelect={() => chooseSort('created')}>
              {t('sidebar.sortByDate')}
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
              askDeleteProject(contextMenu.id);
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
    ? t('sidebar.updating', { progress: typeof progress === 'number' ? ` ${progress}%` : '' })
    : error
      ? t('sidebar.updateFailed')
      : t('sidebar.updateTo', { version: update.version });
  const title = error ?? t('sidebar.haveVersion', { version: update.currentVersion });
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
