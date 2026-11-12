// The palette's rows that need no screen: places (⌘P) and app commands (⇧⌘P).
import { askDeleteProject } from '../components/DeleteProjectModal';
import { t } from '../i18n';
import { openAddRepos } from '../lib/addRepos';
import { startDraftProject } from '../lib/draft';
import { entryKey } from '../lib/entryKey';
import { rescanAll } from '../lib/events';
import { checkForUpdates, openWindow, reportIssue, updateSettings } from '../lib/ipc';
import { readProjectSort, sortProjects } from '../lib/projectSort';
import { setSidebarVisible } from '../lib/sidebar';
import type { EntrySummary, Settings } from '../lib/types';
import { THEME_CHOICES } from '../lib/theme';
import { paletteItems } from '../screens/Palette/items';
import { selectRepoScans, useData } from '../state/data';
import { openSettings, selectCanBack, selectCanForward, selectRoute, useNav, type Route } from '../state/nav';
import { useUi, type SettingsSection } from '../state/ui';
import type { Command, GoItem } from './registry';

/** The saved project on show (its page or its review), if any. */
export function routeProjectId(route: Route): string | null {
  if (route.name === 'project' && route.projectId !== 'draft') return route.projectId;
  if (route.name === 'review' && route.target.kind === 'project') return route.target.projectId;
  return null;
}

/** An entry of the project on show as a ⌘P row (`repo/branch`), under the project's name. */
export function entryGoItem(e: EntrySummary, project: string, run: () => void, current = false): GoItem {
  return {
    key: `entry:${e.key}`,
    group: 'entries',
    heading: project,
    kind: e.worktreePath ? 'worktree' : 'branch',
    label: e.branch ?? e.shortSha ?? '',
    repo: e.repoName,
    terms: e.worktreePath ?? undefined,
    current,
    run,
  };
}

/** A project opens as the sidebar opens it: its review, or its page while it has no entries. */
export function openProject(id: string): void {
  const nav = useNav.getState();
  const route = selectRoute(nav);
  const project = useData.getState().config?.projects.find((p) => p.id === id);
  if (!project) return;
  if (project.entries.length === 0) {
    if (!(route.name === 'project' && route.projectId === id)) nav.push({ name: 'project', projectId: id });
  } else if (!(route.name === 'review' && route.target.kind === 'project' && route.target.projectId === id)) {
    nav.push({ name: 'review', target: { kind: 'project', projectId: id }, backLabel: t('sidebar.back') });
  }
}

/**
 * Projects, worktrees and active branches, older branches while searching. In a project its own
 * entries come from its screen, above these, so the project and its entries are left out here.
 */
export function appGoItems(route: Route): GoItem[] {
  const { config, scan } = useData.getState();
  if (!config) return [];
  const inProject = routeProjectId(route);
  const own = new Set(config.projects.find((p) => p.id === inProject)?.entries.map(entryKey) ?? []);
  const projects: GoItem[] = sortProjects(config.projects, readProjectSort())
    .filter((p) => p.id !== inProject)
    .map((p) => ({
      key: `project:${p.id}`,
      group: 'projects',
      kind: 'project' as const,
      label: p.name,
      run: () => openProject(p.id),
    }));
  const branches: GoItem[] = paletteItems(selectRepoScans({ config, scan }), new Set(), '')
    .filter((i) => !own.has(i.key))
    .map((i) => ({
      key: `branch:${i.key}`,
      group: i.group,
      kind: i.worktreePath ? ('worktree' as const) : ('branch' as const),
      label: i.branch,
      repo: i.repoName,
      terms: i.worktreePath ?? undefined,
      searchOnly: i.group === 'older',
      run: () =>
        useNav.getState().push({
          name: 'review',
          target: { kind: 'branch', ...i.ref, worktreePath: i.worktreePath, tipOverride: null },
          backLabel: t('sidebar.back'),
        }),
    }));
  return [...projects, ...branches];
}

const SETTINGS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'settings.navGeneral' },
  { id: 'appearance', label: 'settings.navAppearance' },
  { id: 'repositories', label: 'settings.navRepositories' },
  { id: 'scripts', label: 'settings.navScripts' },
  { id: 'ai', label: 'settings.aiHeading' },
  { id: 'prompts', label: 'settings.navPrompts' },
  { id: 'shortcuts', label: 'settings.navShortcuts' },
];

function saveSettings(patch: Partial<Settings>): void {
  const now = useData.getState().config?.settings;
  if (now) void updateSettings({ ...now, ...patch });
}

/** General and Settings commands, and the project ones that need only its id. */
export function appCommands(route: Route): Command[] {
  const nav = useNav.getState();
  const settings = useData.getState().config?.settings;
  const general = t('cmd.groupGeneral');
  const sidebarShown = useUi.getState().sidebarVisible;
  const list: Command[] = [
    { id: 'newProject', title: t('sidebar.newProject'), group: general, keys: '⌘N', run: () => startDraftProject([]) },
  ];
  if (route.name !== 'branches')
    list.push({ id: 'goBranches', title: t('cmd.goBranches'), group: general, run: () => nav.push({ name: 'branches' }) });
  if (selectCanBack(nav)) list.push({ id: 'back', title: t('cmd.back'), group: general, keys: '⌘[', run: () => useNav.getState().back() });
  if (selectCanForward(nav))
    list.push({ id: 'forward', title: t('cmd.forward'), group: general, keys: '⌘]', run: () => useNav.getState().forward() });
  list.push(
    {
      id: 'sidebar',
      title: t(sidebarShown ? 'cmd.hideSidebar' : 'cmd.showSidebar'),
      group: general,
      keys: '⌘B',
      run: () => setSidebarVisible(!useUi.getState().sidebarVisible),
    },
    { id: 'refresh', title: t('review.refresh'), group: general, run: () => void rescanAll(true) },
    { id: 'addRepository', title: t('sidebar.addRepository'), group: general, run: () => void openAddRepos() },
  );

  const projectId = routeProjectId(route);
  if (projectId)
    list.push({
      id: 'deleteProject',
      title: t('common.deleteProject'),
      group: t('cmd.groupProject'),
      run: () => askDeleteProject(projectId),
    });

  const settingsGroup = t('cmd.groupSettings');
  list.push(
    { id: 'settings', title: t('cmd.openSettings'), group: settingsGroup, keys: '⌘,', run: () => openSettings() },
    ...SETTINGS.map((s) => ({
      id: `settings:${s.id}`,
      title: t('cmd.settingsSection', { section: t(s.label) }),
      group: settingsGroup,
      run: () => openSettings(s.id),
    })),
  );
  if (settings)
    list.push(
      ...THEME_CHOICES.filter((th) => th.id !== settings.appearance).map((th) => ({
        id: `theme:${th.id}`,
        title: t('cmd.theme', { name: t(th.label) }),
        group: settingsGroup,
        run: () => saveSettings({ appearance: th.id }),
      })),
      // Review's commit rows and layout (Settings › Appearance): the one not chosen.
      settings.commitRows === 'one-line'
        ? { id: 'rows:two', title: t('cmd.commitRows', { name: t('settings.commitRowsTwo') }), group: settingsGroup, run: () => saveSettings({ commitRows: 'two-line' }) }
        : { id: 'rows:one', title: t('cmd.commitRows', { name: t('settings.commitRowsOne') }), group: settingsGroup, run: () => saveSettings({ commitRows: 'one-line' }) },
      settings.historyLayout === 'columns'
        ? { id: 'layout:tree', title: t('cmd.layout', { name: t('settings.historyLayoutTree') }), group: settingsGroup, run: () => saveSettings({ historyLayout: 'tree' }) }
        : { id: 'layout:columns', title: t('cmd.layout', { name: t('settings.historyLayoutColumns') }), group: settingsGroup, run: () => saveSettings({ historyLayout: 'columns' }) },
    );
  list.push(
    {
      id: 'checkUpdates',
      title: t('cmd.checkUpdates'),
      group: general,
      run: () => {
        void openWindow('update');
        void checkForUpdates();
      },
    },
    { id: 'whatsNew', title: t('update.whatsNew'), group: general, run: () => void openWindow('whats-new') },
    { id: 'about', title: t('cmd.about'), group: general, run: () => void openWindow('about') },
    { id: 'reportIssue', title: t('update.reportIssue'), group: general, run: () => void reportIssue() },
  );
  return list;
}
