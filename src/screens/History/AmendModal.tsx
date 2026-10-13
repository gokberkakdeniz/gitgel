import { useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { WarningIcon } from '../../components/icons';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { t } from '../../i18n';
import { stopAsking } from '../../lib/prompts';
import styles from './AmendModal.module.css';

/** Amend Will Require Force Push (Hi10; GitHub Desktop's dialog and texts): asked before
 * amending a commit that is on the remote already. */
export function AmendModal({ onClose, onBegin }: { onClose: () => void; onBegin: () => void }) {
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Modal aria-label={t('amend.title')} width={560} paddingTop={160} onClose={onClose}>
      <ModalHeader title={t('amend.title')} onClose={onClose} />
      <div className={styles.body}>
        <WarningIcon size={28} strokeWidth={1.6} className={styles.icon} />
        <div className={styles.text}>
          <p className={styles.lead}>{t('amend.lead')}</p>
          <p className={styles.lead}>{t('amend.text')}</p>
          <Checkbox label={t('settings.dontAsk')} checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        </div>
      </div>
      <ModalFooter>
        <Button size={36} autoFocus onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size={36}
          onClick={() => {
            if (dontAsk) stopAsking('amendPushed');
            onClose();
            onBegin();
          }}
        >
          {t('amend.begin')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
