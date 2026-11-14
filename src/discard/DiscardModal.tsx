import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { WarningIcon } from '../components/icons';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { t } from '../i18n';
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
  const title = req.all ? t('discard.confirmAll') : t('discard.confirm');
  return (
    <Modal aria-label={title} width={480} paddingTop={160} onClose={close}>
      <ModalHeader title={title} onClose={close} />
      <div className={styles.body}>
        <WarningIcon size={28} strokeWidth={1.6} className={styles.icon} />
        <div className={styles.text}>
          <p className={styles.lead}>{list ? t('discard.leadList') : t('discard.leadCount', { n: String(n) })}</p>
          {list && (
            <div className={grouped ? `${styles.files} ${styles.groups}` : styles.files}>
              {req.targets.map((g) => (
                <div key={`${g.entry.repoId}:${g.branch}`} className={styles.files}>
                  {grouped && (
                    <span className={styles.entry}>
                      <span className={styles.repo}>{g.repoName}</span>
                      <span className={styles.branch}>{g.branch}</span>
                    </span>
                  )}
                  {g.files.map((f) => (
                    <span key={f.path} className={styles.path} title={f.path}>
                      {f.path}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className={styles.note}>{t('discard.trashNote')}</p>
          {list && (
            <Checkbox label={t('settings.dontAsk')} checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          )}
        </div>
      </div>
      <ModalFooter>
        <Button size={36} autoFocus onClick={close}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" size={36} onClick={confirm}>
          {req.all ? t('discard.btnAll') : t('discard.btnOne')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
