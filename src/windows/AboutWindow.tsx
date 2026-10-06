import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { version } from '../../package.json';
import { Button } from '../components/Button';
import { openWindow, reportIssue } from '../lib/ipc';
import { closeWindow, Fitted, useEscCloses } from './AuxApp';
import styles from './AboutWindow.module.css';

/** About Gitgel (Gitgel › About Gitgel, SPEC §7): the icon, the version and when it was built,
 * What's New and Report an Issue. */
export function AboutWindow() {
  useEscCloses();
  const built = new Date(__BUILD_TIME__).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <Fitted className={styles.about}>
      <img className={styles.icon} src={appIcon} alt="" width={88} height={88} />
      <h1 className={styles.name}>Gitgel</h1>
      <div className={styles.meta}>
        <span>Version {version}</span>
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
          What’s New
        </Button>
        <Button size={40} onClick={() => void reportIssue()}>
          Report an Issue
        </Button>
      </div>
    </Fitted>
  );
}
