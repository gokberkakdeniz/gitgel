import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { WarningIcon } from '../components/icons';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { stopAsking } from '../lib/prompts';
import { discardNow, fileCount, listsFiles, useDiscardUi } from './discard';
import styles from './DiscardModal.module.css';

/** Confirm Discard Changes (Hi8, D12; GitHub Desktop's dialog and texts). */
export function DiscardModal() {
  const req = useDiscardUi((s) => s.asking);
  const [dontAsk, setDontAsk] = useState(false);
  if (!req) return null;
  const close = () => {
    setDontAsk(false);
    useDiscardUi.setState({ asking: null });
  };
  const n = fileCount(req);
  const list = listsFiles(req);
  // Files of several entries are listed under their repo and branch.
  const grouped = req.targets.length > 1;
  const confirm = () => {
    if (dontAsk) stopAsking('discardChanges');
    close();
    void discardNow(req);
  };
  const title = req.all ? 'Confirm Discard All Changes' : 'Confirm Discard Changes';
  return (
    <Modal aria-label={title} width={480} paddingTop={160} onClose={close}>
      <ModalHeader title={title} onClose={close} />
      <div className={styles.body}>
        <WarningIcon size={28} strokeWidth={1.6} className={styles.icon} />
        <div className={styles.text}>
          <p className={styles.lead}>
            {list
              ? 'Are you sure you want to discard all changes to:'
              : `Are you sure you want to discard all ${n} changed files?`}
          </p>
          {list && (
            <div className={grouped ? `${styles.files} ${styles.groups}` : styles.files}>
              {req.targets.map((t) => (
                <div key={`${t.entry.repoId}:${t.branch}`} className={styles.files}>
                  {grouped && (
                    <span className={styles.entry}>
                      <span className={styles.repo}>{t.repoName}</span>
                      <span className={styles.branch}>{t.branch}</span>
                    </span>
                  )}
                  {t.files.map((f) => (
                    <span key={f.path} className={styles.path} title={f.path}>
                      {f.path}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className={styles.note}>Changes can be restored by retrieving them from the Trash.</p>
          {list && (
            <Checkbox
              label="Do not show this message again"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
            />
          )}
        </div>
      </div>
      <ModalFooter>
        <Button size={36} autoFocus onClick={close}>
          Cancel
        </Button>
        <Button variant="danger" size={36} onClick={confirm}>
          {req.all ? 'Discard All Changes' : 'Discard Changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
