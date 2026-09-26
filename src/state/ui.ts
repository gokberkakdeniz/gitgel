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
  actionLabel?: string;
  onAction?: () => void;
  linkLabel?: string;
  onLink?: () => void;
}

interface UiState {
  sidebarVisible: boolean;
  branchesFilter: string;
  selectedKeys: string[];
  draftProject: DraftProject | null;
  paletteOpen: boolean;
  toast: Toast | null;
  addReposSheet: string[] | null; // picked folder paths while the sheet is open
  modalCount: number; // open modals; folder drops are ignored while any is open
  renamingProjectId: string | null; // the Project screen opens this project in rename mode
  deletingProjectId: string | null; // the delete confirmation is open for this project
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
  setRenamingProjectId: (id: string | null) => void;
  setDeletingProjectId: (id: string | null) => void;
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
  renamingProjectId: null,
  deletingProjectId: null,
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
  setRenamingProjectId: (renamingProjectId) => set({ renamingProjectId }),
  setDeletingProjectId: (deletingProjectId) => set({ deletingProjectId }),
}));
