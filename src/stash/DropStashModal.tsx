import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { cnt } from '../lib/format';
import { t } from '../i18n';
import { stopAsking } from '../lib/prompts';
import { dropStash, useStashUi } from './actions';

/** Drop (flow P6): confirms dropping `useStashUi.dropping`. */
export function DropStashModal() {
  const st = useStashUi((s) => s.dropping);
  const [dontAsk, setDontAsk] = useState(false);
  if (!st) return null;
  const close = () => {
    setDontAsk(false);
    useStashUi.setState({ dropping: null });
  };
  const name = `stash@{${st.index}}`;
  const where = `${st.repoName} / ${st.branch ?? t('branches.detachedHead')}${st.files !== null ? ` · ${t('branches.fileCount', { ...cnt(st.files) })}` : ''}`;
  return (
    <ConfirmModal
      aria-label={t('stash.dropTitle')}
      title={t('stash.dropTitle')}
      width={460}
      onClose={close}
      context={[
        { icon: 'package', text: `${name} · ${st.message}`, title: st.message },
        { icon: 'branch', text: where },
      ]}
      note={t('stash.dropNote')}
      dontAsk={{ checked: dontAsk, onChange: setDontAsk }}
    >
      <Button size={36} autoFocus onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          if (dontAsk) stopAsking('discardStash');
          close();
          void dropStash(st);
        }}
      >
        {t('stash.dropBtn')}
      </Button>
    </ConfirmModal>
  );
}
