// A small router with back/forward history.
import { create } from 'zustand';
import type { ReviewTarget } from '../lib/types';
import { useUi, type SettingsSection } from './ui';

export type Route =
  | { name: 'branches'; focusRepoId?: string } // focus: scroll to that repo's band
  | { name: 'project'; projectId: string } // 'draft' = unsaved draft project (T5.6)
  | { name: 'review'; target: ReviewTarget; focusKey?: string; backLabel: string }
  // rev: a local or remote-tracking branch, or a SHA (SPEC §16)
  | { name: 'history'; repoId: string; rev: string; backLabel: string }
  | { name: 'settings' };

interface NavState {
  stack: Route[];
  index: number;
  push: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  forward: () => void;
}

export const useNav = create<NavState>()((set) => ({
  stack: [{ name: 'branches' }],
  index: 0,
  push: (route) =>
    set((s) => ({ stack: [...s.stack.slice(0, s.index + 1), route], index: s.index + 1 })),
  replace: (route) => set((s) => ({ stack: s.stack.map((r, i) => (i === s.index ? route : r)) })),
  back: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  forward: () => set((s) => ({ index: Math.min(s.stack.length - 1, s.index + 1) })),
}));

export const selectRoute = (s: NavState): Route => s.stack[s.index];
export const selectCanBack = (s: NavState): boolean => s.index > 0;
export const selectCanForward = (s: NavState): boolean => s.index < s.stack.length - 1;

/** Opens Settings on `section`, or on the section shown last. */
export function openSettings(section?: SettingsSection) {
  if (section) useUi.getState().setSettingsSection(section);
  const nav = useNav.getState();
  if (selectRoute(nav).name !== 'settings') nav.push({ name: 'settings' });
}

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());

/** A branch's History (SPEC §16); Back is named after the page it is opened from. */
export function openHistory(repoId: string, rev: string | null | undefined, backLabel: string) {
  if (rev) useNav.getState().push({ name: 'history', repoId, rev, backLabel });
}
