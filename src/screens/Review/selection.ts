import { t } from '../../i18n';
import { dirname } from '../../lib/paths';
import type { FileChange } from '../../lib/types';

/** Dimmed folder next to the file name: `src/auth`, `src/auth ← old/path.ts`, `scripts · untracked`. */
export function dirLabel(change: FileChange): string {
  const dir = dirname(change.path) || '.';
  if (change.kind === 'R' && change.oldPath) return t('review.dirRenamed', { dir, old: change.oldPath });
  if (change.kind === 'U') return t('review.dirUntracked', { dir });
  if (change.kind === 'C') return t('review.dirConflict', { dir });
  return dir;
}
