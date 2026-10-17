// UI state that is not backend data.
import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { EntryRef } from '../lib/types';
import type { Route } from './nav';

/** A project being named (flows C and H2); saved on ↵, discarded on esc or when leaving. */
export interface DraftProject {
  name: string;
  entries: EntryRef[];
  returnTo: Route | null;
}

export interface Toast {
  id: number;
  message: ReactNode;
  /** A mono part before the message (a branch name). */
  code?: string;
  /** A mono line under the message (repo / branch). */
  sub?: string;
  /** An icon before the message; a running toast stays until replaced. */
  status?: 'running' | 'success' | 'failed';
  actionLabel?: string;
  onAction?: () => void;
  linkLabel?: string;
  onLink?: () => void;
  /** The whole toast is a button (a script run: opens its output). */
  onClick?: () => void;
  /** What the toast is about (a run id), so it can be taken down with it. */
  owner?: string;
}

/** History's commit form for one branch (`commitDraftKey`), kept while the app runs so leaving
 * History and coming back finds it as it was. */
export interface CommitDraft {
  summary: string;
  description: string;
  /** Amend (Hi10): the newest commit the form rewrites, and the form as it was before, which Stop
   * amending puts back. */
  amending: { sha: string; short: string; summary: string; description: string } | null;
}

export const EMPTY_COMMIT_DRAFT: CommitDraft = { summary: '', description: '', amending: null };

export function commitDraftKey(repoId: string, rev: string): string {
  return `${repoId}\n${rev}`;
}

/** The Settings section on the right of its section list (flow M). */
export type SettingsSection = 'general' | 'appearance' | 'repositories' | 'scripts' | 'ai' | 'prompts' | 'shortcuts';

interface UiState {
  sidebarVisible: boolean;
  /** The hidden sidebar shown over the page while the pointer is on the show-sidebar button or on it. */
  sidebarPeek: boolean;
  branchesFilter: string;
  selectedKeys: string[];
  draftProject: DraftProject | null;
  paletteOpen: boolean;
  toast: Toast | null;
  addReposSheet: string[] | null; // picked folder paths while the sheet is open
  modalCount: number; // open modals; folder drops are ignored while any is open
  auxWindows: string[]; // About / Software Update / What's New windows open (`aux-windows`)
  deletingProjectId: string | null; // the delete confirmation is open for this project
  settingsSection: SettingsSection; // the last one shown; Settings opens on it
  commitDrafts: Record<string, CommitDraft>;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarPeek: (peek: boolean) => void;
  setBranchesFilter: (filter: string) => void;
  setSelectedKeys: (keys: string[]) => void;
  setDraftProject: (draft: DraftProject | null) => void;
  setPaletteOpen: (open: boolean) => void;
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  setAddReposSheet: (paths: string[] | null) => void;
  setAuxWindows: (labels: string[]) => void;
  modalOpened: () => void;
  modalClosed: () => void;
  setDeletingProjectId: (id: string | null) => void;
  setSettingsSection: (section: SettingsSection) => void;
  /** Changes a branch's commit form; an empty one is dropped. */
  setCommitDraft: (key: string, patch: Partial<CommitDraft>) => void;
}

let toastId = 0;

/** Where `lib/sidebar.ts` caches the sidebar's visibility, so a launch draws it right before
 * the config arrives. */
export const SIDEBAR_CACHE_KEY = 'gitgel.sidebarVisible';

function cachedSidebarVisible(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_CACHE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export const useUi = create<UiState>()((set) => ({
  sidebarVisible: cachedSidebarVisible(),
  sidebarPeek: false,
  branchesFilter: '',
  selectedKeys: [],
  draftProject: null,
  paletteOpen: false,
  toast: null,
  addReposSheet: null,
  modalCount: 0,
  auxWindows: [],
  setAuxWindows: (auxWindows) => set({ auxWindows }),
  deletingProjectId: null,
  settingsSection: 'general',
  commitDrafts: {},
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible, sidebarPeek: false }),
  setSidebarPeek: (sidebarPeek) => set({ sidebarPeek }),
  setBranchesFilter: (branchesFilter) => set({ branchesFilter }),
  setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
  setDraftProject: (draftProject) => set({ draftProject }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  showToast: (toast) => set({ toast: { ...toast, id: ++toastId } }),
  dismissToast: () => set({ toast: null }),
  setAddReposSheet: (addReposSheet) => set({ addReposSheet }),
  modalOpened: () => set((s) => ({ modalCount: s.modalCount + 1 })),
  modalClosed: () => set((s) => ({ modalCount: Math.max(0, s.modalCount - 1) })),
  setDeletingProjectId: (deletingProjectId) => set({ deletingProjectId }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setCommitDraft: (key, patch) =>
    set((s) => {
      const draft = { ...(s.commitDrafts[key] ?? EMPTY_COMMIT_DRAFT), ...patch };
      const { [key]: _, ...rest } = s.commitDrafts;
      const empty = draft.summary === '' && draft.description === '' && draft.amending === null;
      return { commitDrafts: empty ? rest : { ...rest, [key]: draft } };
    }),
}));

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());
