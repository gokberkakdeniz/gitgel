import { rescanAll } from '../lib/events';
import { t } from '../i18n';
import { useData } from '../state/data';
import { IconButton } from './IconButton';
import { RefreshIcon } from './icons';
import styles from './RefreshButton.module.css';

/** Full rescan of every repo; the icon spins while it runs. */
export function RefreshButton() {
  const refreshing = useData((s) => s.refreshing);
  return (
    <IconButton size={32} aria-label={t('review.refresh')} onClick={() => void rescanAll(true)}>
      <RefreshIcon className={refreshing ? styles.spin : undefined} />
    </IconButton>
  );
}
