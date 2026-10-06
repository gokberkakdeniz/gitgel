import { useEffect } from 'react';
import styles from './App.module.css';
import { AuxBlocker } from './components/AuxBlocker';
import { FolderPlusIcon } from './components/icons';
import { Sidebar } from './components/Sidebar/Sidebar';
import { DeleteProjectModal } from './components/DeleteProjectModal';
import { ToastHost } from './components/Toast';
import { OutputPanelHost } from './scripts/OutputPanel';
import { PassphraseDialog } from './scripts/PassphraseDialog';
import { RunDialogHost } from './scripts/RunDialog';
import { DropStashModal } from './stash/DropStashModal';
import { startDraftProject } from './lib/draft';
import { startEventBridge } from './lib/events';
import { revealWindow } from './lib/ipc';
import { applyTheme, resolveEffective, systemIsDark, watchSystemTheme } from './lib/theme';
import { useFolderDrop } from './lib/useFolderDrop';
import { useWhatsNewAfterUpdate } from './lib/whatsNew';
import { AddReposSheet } from './screens/AddRepos/AddReposSheet';
import { Branches } from './screens/Branches/Branches';
import { Palette } from './screens/Palette/Palette';
import { Settings } from './screens/Settings/Settings';
import { Project } from './screens/Project/Project';
import { History } from './screens/History/History';
import { Review } from './screens/Review/Review';
import { selectRoute, useNav, type Route } from './state/nav';
import { useData } from './state/data';
import { useUi } from './state/ui';

export default function App() {
  const route = useNav(selectRoute);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const dropping = useFolderDrop();
  useWhatsNewAfterUpdate();

  useEffect(() => {
    startEventBridge().catch((e) => console.error('event bridge failed', e));
    // The window starts hidden (appearance.rs); show it now that the app has drawn.
    void revealWindow();
  }, []);

  // Appearance (Settings › Appearance): the config wins once loaded; System follows macOS.
  const appearance = useData((s) => s.config?.settings.appearance);
  useEffect(() => {
    return watchSystemTheme(() => useData.getState().config?.settings.appearance ?? 'system');
  }, []);
  // Until the config arrives, the theme index.html applied from the cache stays.
  useEffect(() => {
    if (appearance) applyTheme(resolveEffective(appearance, systemIsDark()), appearance);
  }, [appearance]);

  // ⌘N: new project (flow C), from anywhere unless a modal is open. ⌘R never reloads the
  // webview; on the Project screen it opens the review. ⌘← / ⌘→ (and ⌘[ / ⌘]): back / forward.
  // ⌘, (Settings) is the app menu's. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'r') e.preventDefault();
      const dir = e.metaKey && useUi.getState().modalCount === 0 ? historyKey(e) : null;
      if (dir) {
        e.preventDefault();
        const nav = useNav.getState();
        if (dir === 'back') nav.back();
        else nav.forward();
        return;
      }
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'n' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        startDraftProject([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // No webview context menu ("Reload", "Inspect"), except where text is edited or selected.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('input, textarea, .monaco-editor')) e.preventDefault();
    };
    window.addEventListener('contextmenu', onMenu);
    return () => window.removeEventListener('contextmenu', onMenu);
  }, []);

  // Leaving the draft project page discards the draft; leaving any page closes the palette.
  const onDraft = route.name === 'project' && route.projectId === 'draft';
  useEffect(() => {
    if (!onDraft) useUi.getState().setDraftProject(null);
  }, [onDraft]);
  useEffect(() => useUi.getState().setPaletteOpen(false), [route]);

  return (
    <div className={styles.app}>
      {sidebarVisible && <Sidebar />}
      <main className={styles.main}>
        <Screen route={route} />
      </main>
      <AddReposSheet />
      <DeleteProjectModal />
      <Palette />
      <RunDialogHost />
      <OutputPanelHost />
      <DropStashModal />
      <PassphraseDialog />
      <ToastHost />
      <AuxBlocker />
      {dropping && (
        <div className={styles.drop} aria-hidden>
          <div className={styles.dropPill}>
            <FolderPlusIcon className={styles.dropIcon} />
            Drop folders to add repositories
          </div>
        </div>
      )}
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'branches':
      return <Branches />;
    case 'project':
      return <Project key={route.projectId} projectId={route.projectId} />;
    case 'review':
      return (
        <Review
          key={JSON.stringify(route.target) + (route.focusKey ?? '')}
          target={route.target}
          backLabel={route.backLabel}
          focusKey={route.focusKey}
          keepSidebar={route.keepSidebar}
        />
      );
    case 'history':
      return <History key={`${route.repoId}:${route.rev}`} repoId={route.repoId} rev={route.rev} backLabel={route.backLabel} />;
    case 'settings':
      return <Settings />;
  }
}

/**
 * Back/forward for ⌘←/⌘→ outside text fields (where they move the caret), and for the physical
 * [ / ] keys, whatever they type: `ğ` / `ü` on a Turkish Q keyboard, where `[` needs ⌥.
 */
function historyKey(e: KeyboardEvent): 'back' | 'forward' | null {
  if (e.code === 'BracketLeft') return 'back';
  if (e.code === 'BracketRight') return 'forward';
  const t = e.target as HTMLElement | null;
  const editing = !!t?.closest('input, textarea, [contenteditable], .monaco-editor');
  if (editing || e.shiftKey || e.altKey) return null;
  if (e.key === 'ArrowLeft') return 'back';
  if (e.key === 'ArrowRight') return 'forward';
  return null;
}
