// The stashes a review lists under its files (flows P2–P3).
import { t } from '../../i18n';
import { ageText, cnt } from '../../lib/format';
import type { ProjectConfig, RepoScan, ReviewTarget, StashInfo } from '../../lib/types';

export interface ReviewStash extends StashInfo {
  repoId: string;
  repoName: string;
}

/**
 * Project scope: the stashes taken on one of its branches, in entry order. Branch scope: those
 * taken on that branch. Stash scope: the repo's whole stack.
 */
export function reviewStashes(
  target: ReviewTarget,
  projects: ProjectConfig[] | undefined,
  scans: Record<string, RepoScan>,
): ReviewStash[] {
  const of = (repoId: string, keep: (s: StashInfo) => boolean): ReviewStash[] => {
    const scan = scans[repoId];
    if (!scan) return [];
    return scan.stashes.filter(keep).map((s) => ({ ...s, repoId, repoName: scan.name }));
  };
  switch (target.kind) {
    case 'stashes':
      return of(target.repoId, () => true);
    case 'branch':
      return target.branch ? of(target.repoId, (s) => s.branch === target.branch) : [];
    case 'project': {
      const project = projects?.find((p) => p.id === target.projectId);
      const seen = new Set<string>();
      const out: ReviewStash[] = [];
      for (const e of project?.entries ?? []) {
        if (!e.branch) continue;
        for (const s of of(e.repoId, (x) => x.branch === e.branch)) {
          const id = `${s.repoId}\u0000${s.sha}`;
          if (!seen.has(id)) {
            seen.add(id);
            out.push(s);
          }
        }
      }
      return out;
    }
  }
}

/** The heading of the stash section. */
export function stashHeading(target: ReviewTarget, repoName: string): string {
  if (target.kind === 'project') return t('review.stashOfProject');
  if (target.kind === 'branch') return t('review.stashOfBranch');
  return t('review.stashInRepo', { repo: repoName });
}

/** Line 2 of a stash row: `web-app / session-token-refresh · 1 file · 20m`; without the repo in
 * stash scope, where the header names it. */
export function stashMeta(s: ReviewStash, withRepo = true, now?: number): string {
  const branch = s.branch
    ? s.branchExists
      ? s.branch
      : t('review.branchDeletedParen', { branch: s.branch })
    : t('branches.detachedHead');
  const parts = [withRepo ? `${s.repoName} / ${branch}` : branch];
  if (s.files !== null) parts.push(t('branches.fileCount', { ...cnt(s.files) }));
  parts.push(ageText(s.createdAt, now));
  return parts.join(' · ');
}
