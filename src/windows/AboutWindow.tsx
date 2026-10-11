import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { version } from '../../package.json';
import { Button } from '../components/Button';
import { t } from '../i18n';
import { formatDateTime } from '../lib/format';
import { openWindow, reportIssue } from '../lib/ipc';
import { closeWindow, Fitted, useEscCloses } from './AuxApp';
import styles from './AboutWindow.module.css';

/** About Gitgel (Gitgel › About Gitgel, SPEC §7): the icon, the version and when it was built,
 * What's New and Report an Issue. */
export function AboutWindow() {
  useEscCloses();
  const built = formatDateTime(new Date(__BUILD_TIME__).getTime() / 1000);
  return (
    <Fitted className={styles.about}>
      <img className={styles.icon} src={appIcon} alt="" width={88} height={88} />
      <h1 className={styles.name}>Gitgel</h1>
      <div className={styles.meta}>
        <span>{t('update.versionLabel', { version })}</span>
        <span>{built}</span>
      </div>
      <div className={styles.buttons}>
        <Button
          size={40}
          autoFocus
          onClick={() => {
            void openWindow('whats-new');
            closeWindow();
          }}
        >
          {t('update.whatsNew')}
        </Button>
        <Button size={40} onClick={() => void reportIssue()}>
          {t('update.reportIssue')}
        </Button>
      </div>
    </Fitted>
  );
}
