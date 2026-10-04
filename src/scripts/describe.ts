import type { ScriptConfig } from '../lib/types';

/** "Worktree folder · Branches, Projects · Opens the output" (import preview). */
export function scriptMeta(s: ScriptConfig): string {
  const folder = s.runsIn === 'worktree' ? 'Worktree folder' : 'Repository folder';
  const menus = s.showIn.map((m) => (m === 'branches' ? 'Branches' : 'Projects')).join(', ') || 'No menu';
  return s.openOutput ? `${folder} · ${menus} · Opens the output` : `${folder} · ${menus}`;
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
