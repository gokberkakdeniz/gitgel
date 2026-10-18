// A small router with back/forward history.
import { create } from 'zustand';
import type { ReviewTarget } from '../lib/types';
import { useUi, type SettingsSection } from './ui';

export type Route =
  | { name: 'branches'; focusRepoId?: string } // focus: scroll to that repo's band
  | { name: 'project'; projectId: string } // 'draft' = unsaved draft project (T5.6)
  | { name: 'review'; target: ReviewTarget; focusKey?: string; backLabel: string }
  | { name: 'settings' };

interface NavState {
  stack: Route[];
  index: number;
  push: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  forward: () => void;
}

const ROUTE_KEY = 'gitgel.route';

/** The route stack survives the language reload (sessionStorage); a draft cannot. */
function loadRoute(): { stack: Route[]; index: number } | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(ROUTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stack: Route[]; index: number };
    if (!Array.isArray(parsed.stack) || typeof parsed.index !== 'number') return null;
    const names = ['branches', 'project', 'review', 'history', 'settings'];
    const stack = parsed.stack
      .filter((r) => r && names.includes(r.name))
      .map((r) => (r.name === 'project' && r.projectId === 'draft' ? { name: 'branches' as const } : fromHistory(r)));
    if (stack.length === 0) return null;
    return { stack, index: Math.min(Math.max(0, parsed.index), stack.length - 1) };
  } catch {
    return null;
  }
}

/** A stored `history` route (before Review and History were one screen) opens Review on its rev. */
function fromHistory(r: Route | { name: 'history'; repoId: string; rev: string; backLabel: string }): Route {
  if (r.name !== 'history') return r;
  return { name: 'review', target: revTarget(r.repoId, r.rev), backLabel: r.backLabel };
}

/** Review of a rev (SPEC §5, branch scope): a local or remote-tracking branch, or a SHA. */
export function revTarget(repoId: string, rev: string): ReviewTarget {
  return { kind: 'branch', repoId, branch: null, worktreePath: null, tipOverride: null, rev };
}

const saved = loadRoute();

export const useNav = create<NavState>()((set) => ({
  stack: saved?.stack ?? [{ name: 'branches' }],
  index: saved?.index ?? 0,
  push: (route) =>
    set((s) => ({ stack: [...s.stack.slice(0, s.index + 1), route], index: s.index + 1 })),
  replace: (route) => set((s) => ({ stack: s.stack.map((r, i) => (i === s.index ? route : r)) })),
  back: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  forward: () => set((s) => ({ index: Math.min(s.stack.length - 1, s.index + 1) })),
}));

export const selectRoute = (s: NavState): Route => s.stack[s.index];
export const selectCanBack = (s: NavState): boolean => s.index > 0;
export const selectCanForward = (s: NavState): boolean => s.index < s.stack.length - 1;

// Kept current for the language reload.
useNav.subscribe((s) => {
  try {
    sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ stack: s.stack, index: s.index }));
  } catch {
    // Nowhere to keep it; the reload lands on Branches.
  }
});

/** Opens Settings on `section`, or on the section shown last. */
export function openSettings(section?: SettingsSection) {
  if (section) useUi.getState().setSettingsSection(section);
  const nav = useNav.getState();
  if (selectRoute(nav).name !== 'settings') nav.push({ name: 'settings' });
}

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());

/** After a branch is deleted (SPEC §15 "Delete branch"), when its Review is shown:
 * every page about it leaves the stack (forward ones too), and Branches shows, unless the pages
 * under it are in a project (then the project page or review it was opened from). */
export function leaveDeletedBranch(repoId: string, branch: string) {
  const about = (r: Route) =>
    r.name === 'review' &&
    r.target.kind === 'branch' &&
    r.target.repoId === repoId &&
    (r.target.branch === branch || r.target.rev === branch);
  useNav.setState((s) => {
    if (!about(s.stack[s.index])) return s;
    const stack = s.stack.slice(0, s.index + 1).filter((r) => !about(r));
    const inProject = stack.some((r) => r.name === 'project' || (r.name === 'review' && r.target.kind === 'project'));
    if (!inProject && stack[stack.length - 1]?.name !== 'branches') stack.push({ name: 'branches' });
    return { stack, index: stack.length - 1 };
  });
}

/** Review of a rev (SPEC §5, branch scope; what History was); Back is named after the page it is
 * opened from. */
export function openRevReview(repoId: string, rev: string | null | undefined, backLabel: string) {
  if (rev) useNav.getState().push({ name: 'review', target: revTarget(repoId, rev), backLabel });
}
