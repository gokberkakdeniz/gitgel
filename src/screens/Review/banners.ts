// Review's banners that read several entries (SPEC §5 "Banners").
import { t } from '../../i18n';
import { cnt, formatCount } from '../../lib/format';
import type { ReviewGroup } from '../../lib/types';

/** Unmerged files outside an operation in progress (a stash apply that conflicted); a stopped
 * rebase or merge has its own banner. */
export function conflictsBanner(groups: Pick<ReviewGroup, 'entry'>[]): string | null {
  const hit = groups.filter((g) => g.entry.conflicts > 0 && !g.entry.operation);
  const n = hit.reduce((s, g) => s + g.entry.conflicts, 0);
  if (n === 0) return null;
  return t('review.conflictsBanner', { ...cnt(n), m: String(hit.length), e: formatCount(hit.length) });
}
