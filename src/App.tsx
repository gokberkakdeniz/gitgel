import { useEffect, useLayoutEffect, useState } from 'react';
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
import { AbortOperationModal } from './sync/OperationUi';
import { CheckoutBranchModal } from './sync/CheckoutBranch';
import { DeleteBranchModal } from './sync/DeleteBranch';
import { DiscardModal } from './discard/DiscardModal';
import { startDraftProject } from './lib/draft';
import { startEventBridge } from './lib/events';
import { fmtFromSettings, getFmt, setFmt } from './lib/format';
import { getLocale, resolveLocale, setLocale } from './i18n';
import { t } from './i18n';
import { revealWindow } from './lib/ipc';
import { isTextField } from './lib/shortcuts';
import { setSidebarVisible } from './lib/sidebar';
import { applyTheme, resolveEffective, systemIsDark, watchSystemTheme } from './lib/theme';
import { useFolderDrop } from './lib/useFolderDrop';
import { useWhatsNewAfterUpdate } from './lib/whatsNew';
import { AddReposSheet } from './screens/AddRepos/AddReposSheet';
import { Branches } from './screens/Branches/Branches';
import { Palette } from './screens/Palette/Palette';
import { Settings } from './screens/Settings/Settings';
import { Project } from './screens/Project/Project';
import { BranchReview, ProjectReview, StashReview } from './screens/Review/Review';
import { selectRoute, useNav, type Route } from './state/nav';
import { useData } from './state/data';
import { useUi } from './state/ui';

export default function App() {
  const route = useNav(selectRoute);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const sidebarPeek = useUi((s) => s.sidebarPeek);
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

  // The UI language and formats (Settings › General, Appearance): the config wins once
  // loaded; until then the module defaults (the browser language) stand. One re-render,
  // before paint.
  const settings = useData((s) => s.config?.settings);
  const [, setLangTick] = useState(0);
  useLayoutEffect(() => {
    let changed = false;
    const next = resolveLocale(settings?.language ?? 'system');
    if (next !== getLocale()) {
      setLocale(next);
      changed = true;
    }
    if (settings) {
      const fmt = fmtFromSettings(settings);
      if (JSON.stringify(fmt) !== JSON.stringify(getFmt())) {
        setFmt(fmt);
        changed = true;
      }
    }
    if (changed) setLangTick((n) => n + 1);
  }, [settings]);

  // ⌘N: new project (flow C), from anywhere unless a modal is open. ⌘R never reloads the
  // webview; on the Project screen it opens the review. ⌘← / ⌘→ (and ⌘[ / ⌘]): back / forward.
  // ⌘B shows or hides the sidebar.
  // ⌘, (Settings) is the app menu's. Listed in lib/shortcuts.ts. Caught before the diff: Monaco
  // takes ⌘← / ⌘→ (line start / end) and stops them there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'r') e.preventDefault();
      const dir = e.metaKey && useUi.getState().modalCount === 0 ? historyKey(e) : null;
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        const nav = useNav.getState();
        if (dir === 'back') nav.back();
        else nav.forward();
        return;
      }
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'n' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        startDraftProject([]);
      }
      if (e.metaKey && !e.shiftKey && !e.altKey && e.code === 'KeyB' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        setSidebarVisible(!useUi.getState().sidebarVisible);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // No webview context menu ("Reload", "Inspect"), except where text is edited or
  // selectable (commit subject, body, SHAs: right-click copies).
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // Monaco's hidden textarea is under the pointer on a right-click, so the diff is checked first.
      if (!t?.closest('.monaco-editor') && t?.closest('input, textarea, .selectable')) return;
      e.preventDefault();
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
      {sidebarVisible ? <Sidebar /> : sidebarPeek && <Sidebar peek />}
      <main className={styles.main}>
        <Screen route={route} />
      </main>
      <AddReposSheet />
      <DeleteProjectModal />
      <Palette />
      <RunDialogHost />
      <OutputPanelHost />
      <DropStashModal />
      <AbortOperationModal />
      <DeleteBranchModal />
      <CheckoutBranchModal />
      <DiscardModal />
      <PassphraseDialog />
      <ToastHost />
      <AuxBlocker />
      {dropping && (
        <div className={styles.drop} aria-hidden>
          <div className={styles.dropPill}>
            <FolderPlusIcon className={styles.dropIcon} />
            {t('addrepos.dropHint')}
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
      // One screen for a branch, a project (one entry open at a time) and a repo's stashes (SPEC §5).
      switch (route.target.kind) {
        case 'branch':
          return <BranchReview key={JSON.stringify(route.target)} target={route.target} backLabel={route.backLabel} />;
        case 'stashes':
          return (
            <StashReview
              key={route.target.repoId + (route.focusKey ?? '')}
              repoId={route.target.repoId}
              backLabel={route.backLabel}
              focusKey={route.focusKey}
            />
          );
        case 'project':
          return (
            <ProjectReview
              key={route.target.projectId + (route.focusKey ?? '')}
              projectId={route.target.projectId}
              backLabel={route.backLabel}
              focusKey={route.focusKey}
            />
          );
      }
      break;
    case 'settings':
      return <Settings />;
  }
}

/**
 * Back/forward for ⌘←/⌘→ outside text fields (where they move the caret; the read-only diff is
 * not one), and for the physical [ / ] keys, whatever they type: `ğ` / `ü` on a Turkish Q
 * keyboard, where `[` needs ⌥.
 */
function historyKey(e: KeyboardEvent): 'back' | 'forward' | null {
  if (e.code === 'BracketLeft') return 'back';
  if (e.code === 'BracketRight') return 'forward';
  const editing = isTextField(e.target);
  if (editing || e.shiftKey || e.altKey) return null;
  if (e.key === 'ArrowLeft') return 'back';
  if (e.key === 'ArrowRight') return 'forward';
  return null;
}
