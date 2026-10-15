// New Branch's defaults (SPEC §15 "New branch").
import { basename, dirname } from '../lib/paths';
import type { RepoScan } from '../lib/types';

/** The bases offered: the repo's default base and base branch, the other local branches, then
 * the remote branches no local branch has. */
export function baseChoices(scan: RepoScan): string[] {
  const first = [scan.defaultBase, scan.baseBranch].filter((b): b is string => !!b);
  const local = [...scan.active.map((e) => e.branch), ...scan.others.map((o) => o.branch)]
    .filter((b): b is string => !!b)
    .sort((a, b) => a.localeCompare(b));
  return [...new Set([...first, ...local, ...scan.remotes.map((r) => r.name)])];
}

/** The worktree folder's default: `<repo>-worktrees/<branch>` beside the repository folder, the
 * branch's slashes as dashes. */
export function defaultParent(repoPath: string): string {
  return `${dirname(repoPath)}/${basename(repoPath)}-worktrees`;
}
export const folderName = (branch: string) => branch.trim().replace(/\//g, '-');
