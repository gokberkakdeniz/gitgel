import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { version } from '../../package.json';
import { reportIssue } from '../lib/ipc';
import { useUi } from '../state/ui';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { Modal } from './Modal';
import styles from './AboutModal.module.css';

/** About Gitgel (Gitgel › About Gitgel, SPEC §7): the icon, the version and when it was built,
 * What's New and Report an Issue. */
export function AboutModal() {
  const open = useUi((s) => s.aboutOpen);
  if (!open) return null;
  const close = () => useUi.getState().setAboutOpen(false);
  const built = new Date(__BUILD_TIME__).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <Modal aria-label="About Gitgel" width={340} paddingTop={140} closeOnScrim onClose={close}>
      <div className={styles.about}>
        <IconButton aria-label="Close" className={styles.close} onClick={close}>
          <CloseIcon size={13} />
        </IconButton>
        <img className={styles.icon} src={appIcon} alt="" width={88} height={88} />
        <h2 className={styles.name}>Gitgel</h2>
        <div className={styles.meta}>
          <span>Version {version}</span>
          <span>{built}</span>
        </div>
        <div className={styles.buttons}>
          <Button
            size={40}
            autoFocus
            onClick={() => {
              close();
              useUi.getState().setWhatsNewOpen(true);
            }}
          >
            What’s New
          </Button>
          <Button size={40} onClick={() => void reportIssue()}>
            Report an Issue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
