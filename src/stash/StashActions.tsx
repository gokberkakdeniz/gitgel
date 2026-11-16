import { Icon } from '../components/icons';
import { t } from '../i18n';
import type { ReviewStash } from '../screens/Review/stashes';
import { askApply, askDrop } from './actions';
import styles from './StashActions.module.css';

/** Apply | Pop | Drop of the stash shown, or of the picked stashes (SPEC §15), in the page
 * header where Fetch | Pull | Push are otherwise: Apply and Pop ask for the worktree, Drop asks
 * first (P6). */
export function StashActions({ stashes }: { stashes: ReviewStash[] }) {
  const button = (pop: boolean) => (
    <button type="button" className={styles.button} onClick={() => askApply(stashes, pop)}>
      <Icon name={pop ? 'stash-pop' : 'stash-apply'} size={12} />
      {t(pop ? 'stash.popBtn' : 'stash.applyBtn')}
    </button>
  );
  return (
    <div role="group" aria-label={t('branches.stashActions')} className={styles.group}>
      {button(false)}
      {button(true)}
      <span className={styles.divider} />
      <button type="button" className={`${styles.button} ${styles.drop}`} onClick={() => askDrop(stashes)}>
        <Icon name="trash" size={12} />
        {t('stash.drop')}
      </button>
    </div>
  );
}
