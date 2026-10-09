import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { Button } from '../components/Button';
import { ReleaseNotes } from '../components/ReleaseNotes';
import { newerThan, parseChangelog } from '../lib/changelog';
import { checkForUpdates, getUpdateCheck, installUpdate } from '../lib/ipc';
import type { AppError, UpdateCheck } from '../lib/types';
import { closeWindow, Fitted, useEscCloses } from './AuxApp';
import styles from './UpdateWindow.module.css';

/** Software Update (Gitgel › Check for Updates…, §12 "Updates"): the app icon over the answer of
 * the check, and the download's progress once Update and Restart is pressed. It follows the
 * backend's `update-check`, starting from the last one sent (`get_update_check`). */
export function UpdateWindow() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  // null: not installing; 'unknown' until the size is known.
  const [progress, setProgress] = useState<number | 'unknown' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const unlisten = [
      listen<UpdateCheck>('update-check', (e) => setCheck(e.payload)),
      listen<number | null>('update-progress', (e) => setProgress(e.payload ?? 'unknown')),
    ];
    void getUpdateCheck().then((c) => c && setCheck((now) => now ?? c));
    return () => unlisten.forEach((u) => void u.then((fn) => fn()));
  }, []);
  const installing = progress !== null;
  useEscCloses(!installing);
  // Closing mid-install would leave nothing to show how it went.
  useEffect(() => {
    if (!installing) return;
    const unlisten = getCurrentWindow().onCloseRequested((e) => e.preventDefault());
    return () => void unlisten.then((fn) => fn());
  }, [installing]);
  if (!check) return null;

  const close = () => {
    if (!installing) closeWindow();
  };
  const install = async () => {
    setError(null);
    setProgress('unknown');
    try {
      await installUpdate(); // the app restarts when it succeeds
    } catch (e) {
      setProgress(null);
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
      title = 'Checking for Updates…';
      body = <Bar />;
      buttons = (
        <Button size={36} className={styles.button} onClick={close}>
          Cancel
        </Button>
      );
      break;
    case 'upToDate':
      title = 'You’re Up to Date';
      body = <p className={styles.text}>Gitgel {check.currentVersion} is the newest version.</p>;
      buttons = (
        <Button variant="primary" size={36} className={styles.button} autoFocus onClick={close}>
          OK
        </Button>
      );
      break;
    case 'failed':
      title = 'Cannot Check for Updates';
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
      title = 'A New Version Is Available';
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
    <Fitted width={notes.length > 0 ? 440 : 360}>
      <div className={styles.body}>
        <img className={styles.icon} src={appIcon} alt="" width={88} height={88} />
        <h1 className={styles.title}>{title}</h1>
        {body}
      </div>
      <div className={styles.buttons}>{buttons}</div>
    </Fitted>
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
