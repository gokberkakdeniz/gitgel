// Data the backend pushes: config and scan results, kept current by backend events.
import { create } from 'zustand';
import type { Config, EditorOption, OpenApp, RepoScan, RepoUpdated, ScanResult, TerminalOption, UpdateInfo } from '../lib/types';

interface DataState {
  config: Config | null;
  scan: Record<string, RepoScan>; // by repoId
  scannedOnce: boolean;
  repoVersion: Record<string, number>; // bumped on every update of that repo
  configVersion: number; // bumped on every config change
  refreshing: boolean; // a full rescan is running
  openApps: OpenApp[]; // installed apps for the entry menus' open items
  editorOptions: EditorOption[]; // install state of the known editors, for Settings
  terminalOptions: TerminalOption[]; // install state of Terminal/iTerm2/WezTerm, for Settings
  update: UpdateInfo | null; // a newer version, from the update check
  updateProgress: number | 'unknown' | null; // download percent while installing; null otherwise
  setConfig: (config: Config) => void;
  setScan: (result: ScanResult) => void;
  applyRepoUpdated: (event: RepoUpdated) => void;
  setRefreshing: (refreshing: boolean) => void;
  setOpenApps: (apps: OpenApp[]) => void;
  setEditorOptions: (options: EditorOption[]) => void;
  setTerminalOptions: (options: TerminalOption[]) => void;
  setUpdate: (update: UpdateInfo | null) => void;
  setUpdateProgress: (progress: number | 'unknown' | null) => void;
}

export const useData = create<DataState>()((set) => ({
  config: null,
  scan: {},
  scannedOnce: false,
  repoVersion: {},
  configVersion: 0,
  refreshing: false,
  openApps: [],
  editorOptions: [],
  terminalOptions: [],
  update: null,
  updateProgress: null,
  setConfig: (config) => set((s) => ({ config, configVersion: s.configVersion + 1 })),
  setScan: (result) =>
    set((s) => {
      const scan: Record<string, RepoScan> = {};
      const repoVersion = { ...s.repoVersion };
      for (const r of result.repos) {
        scan[r.repo.id] = r;
        repoVersion[r.repo.id] = (repoVersion[r.repo.id] ?? 0) + 1;
      }
      return { scan, repoVersion, scannedOnce: true };
    }),
  applyRepoUpdated: (e) =>
    set((s) => ({
      scan: { ...s.scan, [e.repoId]: e.scan },
      repoVersion: { ...s.repoVersion, [e.repoId]: (s.repoVersion[e.repoId] ?? 0) + 1 },
    })),
  setRefreshing: (refreshing) => set({ refreshing }),
  setOpenApps: (openApps) => set({ openApps }),
  setEditorOptions: (editorOptions) => set({ editorOptions }),
  setTerminalOptions: (terminalOptions) => set({ terminalOptions }),
  setUpdate: (update) => set({ update }),
  setUpdateProgress: (updateProgress) => set({ updateProgress }),
}));

/** Scans of the repos in the config, in config order. Records of removed repos are ignored. */
export function selectRepoScans(s: Pick<DataState, 'config' | 'scan'>): RepoScan[] {
  if (!s.config) return [];
  return s.config.repos.flatMap((r) => (s.scan[r.id] ? [s.scan[r.id]] : []));
}

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());
