// What the Add palette lists: every scanned entry, grouped, with its meta line.
import Fuse from 'fuse.js';
import { t } from '../../i18n';
import { agoText, cnt, formatCount } from '../../lib/format';
import { refOf, refOfOther } from '../../lib/projects';
import type { EntryRef, RepoScan } from '../../lib/types';

export type PaletteGroup = 'worktrees' | 'active' | 'older';

export const GROUP_TITLES: Record<PaletteGroup, string> = {
  worktrees: 'palette.groupWorktrees',
  active: 'palette.groupActive',
  older: 'palette.groupOlder',
};

export interface PaletteItem {
  key: string;
  group: PaletteGroup;
  ref: EntryRef;
  branch: string; // shown name: the branch, or the short SHA of a detached worktree
  repoName: string;
  worktreePath: string | null;
  meta: string;
  tag: 'In Project' | 'merged' | null;
  disabled: boolean;
}

/** Older branches shown at most while searching. */
export const OLDER_LIMIT = 50;

export function paletteItems(
  scans: RepoScan[],
  inProject: Set<string>,
  projectName: string,
  now: number = Date.now() / 1000,
): PaletteItem[] {
  const age = (t2: number | null) => (t2 ? agoText(t2, now) : null);
  const join = (parts: (string | null | false)[]) => parts.filter(Boolean).join(' · ');
  const items: PaletteItem[] = [];
  for (const scan of scans) {
    for (const e of scan.active) {
      const inside = inProject.has(e.key);
      const merged = e.state === 'merged';
      const group: PaletteGroup = e.worktreePath ? 'worktrees' : 'active';
      const stats = [
        e.ahead !== null && `↑${formatCount(e.ahead)}`,
        e.files !== null && t('branches.fileCount', { ...cnt(e.files) }),
      ];
      const meta = inside
        ? join([e.repoName, t('palette.alreadyIn', { project: projectName })])
        : merged
          ? join([e.repoName, t('palette.mergedInto', { base: e.base ?? '' }), age(e.lastCommitAt)])
          : group === 'worktrees'
            ? join([e.repoName, ...stats, !!e.uncommitted && t('palette.uncommittedCount', { n: formatCount(e.uncommitted) })])
            : join([e.repoName, ...stats, age(e.lastCommitAt)]);
      items.push({
        key: e.key,
        group,
        ref: refOf(e),
        branch: e.branch ?? e.shortSha ?? '',
        repoName: e.repoName,
        worktreePath: e.worktreePath,
        meta,
        tag: inside ? 'In Project' : merged ? 'merged' : null,
        disabled: inside,
      });
    }
    for (const o of scan.others) {
      const ref = refOfOther(o);
      const key = `${o.repoId}:${o.branch}`;
      const inside = inProject.has(key);
      items.push({
        key,
        group: 'older',
        ref,
        branch: o.branch,
        repoName: o.repoName,
        worktreePath: null,
        meta: inside
          ? join([o.repoName, t('palette.alreadyIn', { project: projectName })])
          : join([o.repoName, o.merged && t('palette.mergedInto', { base: scan.defaultBase ?? '' }), age(o.lastCommitAt)]),
        tag: inside ? 'In Project' : o.merged ? 'merged' : null,
        disabled: inside,
      });
    }
  }
  return items;
}

/**
 * Items to show, in group order. Without a query: worktrees and active branches; older branches
 * appear only when searching (at most `OLDER_LIMIT`).
 */
export function searchPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim();
  let found: PaletteItem[];
  if (!q) {
    found = items.filter((i) => i.group !== 'older');
  } else {
    const fuse = new Fuse(items, {
      keys: [
        { name: 'branch', weight: 2 },
        { name: 'repoName', weight: 1 },
        { name: 'worktreePath', weight: 1 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    });
    found = fuse.search(q).map((r) => r.item);
  }
  const byGroup = (g: PaletteGroup) => found.filter((i) => i.group === g);
  return [...byGroup('worktrees'), ...byGroup('active'), ...byGroup('older').slice(0, OLDER_LIMIT)];
}
