import { useEffect, useRef } from 'react';
import { version } from '../../package.json';
import { changelog, compareVersions } from '../lib/changelog';
import { updateSettings } from '../lib/ipc';
import { useData } from '../state/data';
import { useUi } from '../state/ui';
import { Button } from './Button';
import { Modal, ModalFooter, ModalHeader } from './Modal';
import { ReleaseNotes } from './ReleaseNotes';
import styles from './WhatsNewModal.module.css';

/** What's New (Help › What's New, SPEC §7): the bundled CHANGELOG.md, newest first. */
export function WhatsNewModal() {
  const open = useUi((s) => s.whatsNewOpen);
  if (!open) return null;
  const close = () => useUi.getState().setWhatsNewOpen(false);
  return (
    <Modal aria-label="What’s New" width={520} paddingTop={80} onClose={close}>
      <ModalHeader title="What’s New" sub={`Gitgel ${version}`} />
      <div role="region" aria-label="Release notes" tabIndex={0} className={styles.notes}>
        <ReleaseNotes releases={changelog} />
      </div>
      <ModalFooter>
        <Button variant="primary" size={36} autoFocus onClick={close}>
          OK
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Opens What's New once after an update: when the config's `lastSeenVersion` is older than
 * this build, or missing from a config that has repositories (versions before 0.1.17 did not
 * write it). A fresh install only records the version. Never over another modal; then it waits
 * for the next launch. */
export function useWhatsNewAfterUpdate() {
  const config = useData((s) => s.config);
  const done = useRef(false);
  useEffect(() => {
    if (!config || done.current) return;
    done.current = true;
    const seen = config.settings.lastSeenVersion;
    if (seen && compareVersions(seen, version) >= 0) return;
    if (seen || config.repos.length > 0) {
      if (useUi.getState().modalCount > 0) return;
      useUi.getState().setWhatsNewOpen(true);
    }
    void updateSettings({ ...config.settings, lastSeenVersion: version });
  }, [config]);
}
