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

/** The Settings section on the right of its section list (flow M). */
export type SettingsSection = 'general' | 'repositories' | 'scripts' | 'shortcuts';

interface UiState {
  sidebarVisible: boolean;
  branchesFilter: string;
  selectedKeys: string[];
  draftProject: DraftProject | null;
  paletteOpen: boolean;
  toast: Toast | null;
  addReposSheet: string[] | null; // picked folder paths while the sheet is open
  modalCount: number; // open modals; folder drops are ignored while any is open
  deletingProjectId: string | null; // the delete confirmation is open for this project
  settingsSection: SettingsSection; // the last one shown; Settings opens on it
  setSidebarVisible: (visible: boolean) => void;
  setBranchesFilter: (filter: string) => void;
  setSelectedKeys: (keys: string[]) => void;
  setDraftProject: (draft: DraftProject | null) => void;
  setPaletteOpen: (open: boolean) => void;
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  setAddReposSheet: (paths: string[] | null) => void;
  modalOpened: () => void;
  modalClosed: () => void;
  setDeletingProjectId: (id: string | null) => void;
  setSettingsSection: (section: SettingsSection) => void;
}

let toastId = 0;

export const useUi = create<UiState>()((set) => ({
  sidebarVisible: true,
  branchesFilter: '',
  selectedKeys: [],
  draftProject: null,
  paletteOpen: false,
  toast: null,
  addReposSheet: null,
  modalCount: 0,
  deletingProjectId: null,
  settingsSection: 'general',
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
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
}));

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());
