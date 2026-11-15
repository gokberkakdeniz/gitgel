import { useEffect } from 'react';
import { version } from '../../package.json';
import { Button } from '../components/Button';
import { ModalFooter, ModalHeader } from '../components/Modal';
import { ReleaseNotes } from '../components/ReleaseNotes';
import { changelog } from '../lib/changelog';
import { t } from '../i18n';
import { closeWindow, revealWindow, useEscCloses } from './AuxApp';
import styles from './WhatsNewWindow.module.css';

/** What's New (Help › What's New, SPEC §7): the bundled CHANGELOG.md, newest first. Opened by
 * itself after an update (`?from=<version last seen>`), the versions newer than that are marked. */
export function WhatsNewWindow() {
  const from = new URLSearchParams(window.location.search).get('from') || undefined;
  useEscCloses();
  useEffect(revealWindow, []);
  return (
    <div className={styles.whatsNew}>
      <ModalHeader
        title={t('update.whatsNew')}
        sub={from ? t('update.whatsNewFrom', { version, from }) : t('update.whatsNewSub', { version })}
      />
      <div role="region" aria-label={t('update.notesAria')} tabIndex={0} className={styles.notes}>
        <ReleaseNotes releases={changelog} seen={from} />
      </div>
      <ModalFooter>
        <Button variant="primary" size={36} autoFocus onClick={closeWindow}>
          {t('update.okBtn')}
        </Button>
      </ModalFooter>
    </div>
  );
}
