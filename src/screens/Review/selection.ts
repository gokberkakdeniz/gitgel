import { dirname } from '../../lib/paths';
import type { DiffMode, EntrySummary, FileChange, ReviewGroup } from '../../lib/types';

/** A file in the review: the entry it belongs to and its path. */
export interface FileRef {
  key: string;
  path: string;
}

/**
 * The file to show: the selected one while it is still listed; otherwise the first file of the
 * same entry; otherwise the first file of the first entry that has one.
 */
export function resolveSelection(
  groups: ReviewGroup[],
  mode: DiffMode,
  selected: FileRef | null,
): FileRef | null {
  const first = (g: ReviewGroup): FileRef | null =>
    g.files[mode].length > 0 ? { key: g.entry.key, path: g.files[mode][0].path } : null;
  if (selected) {
    const g = groups.find((g) => g.entry.key === selected.key);
    if (g?.files[mode].some((f) => f.path === selected.path)) return selected;
    const fallback = g && first(g);
    if (fallback) return fallback;
  }
  for (const g of groups) {
    const f = first(g);
    if (f) return f;
  }
  return null;
}

/** Dimmed folder next to the file name: `src/auth`, `src/auth ← old/path.ts`, `scripts · untracked`. */
export function dirLabel(change: FileChange): string {
  const dir = dirname(change.path) || '.';
  if (change.kind === 'R' && change.oldPath) return `${dir} ← ${change.oldPath}`;
  if (change.kind === 'U') return `${dir} · untracked`;
  return dir;
}

/** Committed, unless there are no committed changes but some uncommitted ones. */
export function defaultMode(groups: ReviewGroup[]): DiffMode {
  const count = (m: DiffMode) => groups.reduce((n, g) => n + g.files[m].length, 0);
  return count('committed') === 0 && count('uncommitted') > 0 ? 'uncommitted' : 'committed';
}

/** What the diff compares, shown in the file bar. */
export function compareLabel(mode: DiffMode, entry: EntrySummary): string {
  if (mode === 'uncommitted') return 'HEAD ↔ working tree';
  if (mode === 'all' && entry.worktreePath) return 'merge-base ↔ working tree';
  return `merge-base ↔ ${entry.branch ?? entry.shortSha}`;
}

export const EMPTY_MESSAGES: Record<DiffMode, string> = {
  committed: 'No committed changes',
  uncommitted: 'No uncommitted changes',
  all: 'No changes',
};
