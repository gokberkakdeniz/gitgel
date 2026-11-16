import { t } from '../i18n';
import { agoText } from '../lib/format';
import parts from '../screens/Review/parts.module.css';
import type { ReviewStash } from '../screens/Review/stashes';
import styles from './StashBar.module.css';

/** Above a stash's diff: its message, then where it was taken and on what. Its actions are in
 * the page header (`StashActions`). */
export function StashBar({ stash, base }: { stash: ReviewStash; base: string }) {
  const branch = stash.branch ?? t('branches.detachedHead');
  return (
    <div className={parts.entryBar}>
      <div className={parts.entryLine}>
        <span className={parts.barTitle} title={stash.message}>
          {stash.message}
        </span>
      </div>
      <div className={parts.barMeta}>
        <span className={styles.where}>
          {stash.repoName} / {branch}
        </span>
        <span className={parts.dot}>·</span>
        <span>{t('stash.fromBase', { sha: base.slice(0, 7) })}</span>
        <span className={parts.dot}>·</span>
        <span>{agoText(stash.createdAt)}</span>
      </div>
    </div>
  );
}
