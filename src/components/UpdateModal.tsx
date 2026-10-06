import { useState } from 'react';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { newerThan, parseChangelog } from '../lib/changelog';
import { checkForUpdates, installUpdate } from '../lib/ipc';
import type { AppError } from '../lib/types';
import { useData } from '../state/data';
import { useUi } from '../state/ui';
import { Button } from './Button';
import { Modal } from './Modal';
import { ReleaseNotes } from './ReleaseNotes';
import styles from './UpdateModal.module.css';

/** Software Update (Gitgel › Check for Updates…, §12 "Updates"): the app icon over the answer of
 * the check, and the download's progress once Update and Restart is pressed. */
export function UpdateModal() {
  const check = useUi((s) => s.updateCheck);
  const progress = useData((s) => s.updateProgress);
  const [error, setError] = useState<string | null>(null);
  if (!check) return null;

  const installing = progress !== null;
  const close = () => {
    if (installing) return;
    setError(null);
    useUi.getState().setUpdateCheck(null);
  };
  const install = async () => {
    setError(null);
    useData.getState().setUpdateProgress('unknown');
    try {
      await installUpdate(); // the app restarts when it succeeds
    } catch (e) {
      useData.getState().setUpdateProgress(null);
      setError((e as AppError).message ?? String(e));
    }
  };

  // The feed's notes of the versions this update brings (it may skip some).
  const notes =
    check.state === 'available' && check.notes ? newerThan(parseChangelog(check.notes), check.currentVersion) : [];

  let title: string;
  let body: React.ReactNode;
  let buttons: React.ReactNode;
  switch (check.state) {
    case 'checking':
      title = 'Checking for updates…';
      body = <Bar />;
      buttons = (
        <Button size={36} className={styles.button} onClick={close}>
          Cancel
        </Button>
      );
      break;
    case 'upToDate':
      title = 'You’re up to date';
      body = <p className={styles.text}>Gitgel {check.currentVersion} is the newest version.</p>;
      buttons = (
        <Button variant="primary" size={36} className={styles.button} autoFocus onClick={close}>
          OK
        </Button>
      );
      break;
    case 'failed':
      title = 'Cannot check for updates';
      body = <p className={styles.error}>{check.message}</p>;
      buttons = (
        <>
          <Button size={36} className={styles.button} onClick={close}>
            Close
          </Button>
          <Button variant="primary" size={36} className={styles.button} autoFocus onClick={() => void checkForUpdates()}>
            Try Again
          </Button>
        </>
      );
      break;
    case 'available':
      title = 'A new version is available';
      body = (
        <>
          <span className={styles.versions}>
            <span className={styles.from}>{check.currentVersion}</span>
            <span className={styles.arrow}>→</span>
            <span className={styles.to}>{check.version}</span>
          </span>
          {notes.length > 0 && (
            <div role="region" aria-label="Release notes" tabIndex={0} className={styles.notes}>
              <ReleaseNotes releases={notes} compact />
            </div>
          )}
          {installing ? (
            <Bar percent={typeof progress === 'number' ? progress : null} />
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : (
            <p className={styles.text}>Gitgel restarts to finish the update.</p>
          )}
        </>
      );
      buttons = (
        <>
          <Button size={36} className={styles.button} disabled={installing} onClick={close}>
            Later
          </Button>
          <Button
            variant="primary"
            size={36}
            className={styles.button}
            disabled={installing}
            autoFocus
            onClick={() => void install()}
          >
            {installing ? 'Updating…' : error ? 'Try Again' : 'Update and Restart'}
          </Button>
        </>
      );
      break;
  }

  return (
    <Modal aria-label="Software Update" width={notes.length > 0 ? 440 : 360} paddingTop={notes.length > 0 ? 100 : 140} onClose={close}>
      <div className={styles.body}>
        <img className={styles.icon} src={appIcon} alt="" width={88} height={88} />
        <h2 className={styles.title}>{title}</h2>
        {body}
      </div>
      <div className={styles.buttons}>{buttons}</div>
    </Modal>
  );
}

/** The check, or the download: indeterminate until a percent is known. */
function Bar({ percent = null }: { percent?: number | null }) {
  return (
    <div className={styles.progress}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className={styles.track}
      >
        <div
          className={percent === null ? `${styles.fill} ${styles.indeterminate}` : styles.fill}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {percent !== null && <span className={styles.percent}>{percent < 100 ? `Downloading… ${percent}%` : 'Installing…'}</span>}
    </div>
  );
}
