import { useEffect } from 'react';
import { version } from '../../package.json';
import { Button } from '../components/Button';
import { ModalFooter, ModalHeader } from '../components/Modal';
import { ReleaseNotes } from '../components/ReleaseNotes';
import { changelog } from '../lib/changelog';
import { closeWindow, revealWindow, useEscCloses } from './AuxApp';
import styles from './WhatsNewWindow.module.css';

/** What's New (Help › What's New, SPEC §7): the bundled CHANGELOG.md, newest first. */
export function WhatsNewWindow() {
  useEscCloses();
  useEffect(revealWindow, []);
  return (
    <div className={styles.whatsNew}>
      <ModalHeader title="What’s New" sub={`Gitgel ${version}`} />
      <div role="region" aria-label="Release notes" tabIndex={0} className={styles.notes}>
        <ReleaseNotes releases={changelog} />
      </div>
      <ModalFooter>
        <Button variant="primary" size={36} autoFocus onClick={closeWindow}>
          OK
        </Button>
      </ModalFooter>
    </div>
  );
}
