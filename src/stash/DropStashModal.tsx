import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmModal, type ConfirmContext } from '../components/ConfirmModal';
import { cnt } from '../lib/format';
import { t } from '../i18n';
import { stopAsking } from '../lib/prompts';
import type { ReviewStash } from '../screens/Review/stashes';
import { dropStashes, useStashUi } from './actions';

/** The most stashes named in the box; the rest are counted. */
const SHOWN = 5;

/** The box of the confirmation: the stash and where it was taken, or the stashes and their repo. */
export function dropContext(list: ReviewStash[]): ConfirmContext[] {
  const row = (st: ReviewStash): ConfirmContext => ({
    icon: 'package',
    text: `stash@{${st.index}} · ${st.message}`,
    title: st.message,
  });
  const [st] = list;
  if (list.length === 1) {
    const files = st.files !== null ? ` · ${t('branches.fileCount', { ...cnt(st.files) })}` : '';
    return [row(st), { icon: 'branch', text: `${st.repoName} / ${st.branch ?? t('branches.detachedHead')}${files}` }];
  }
  // Stashes of several repositories (a project review) name theirs.
  const repos = new Set(list.map((x) => x.repoId)).size;
  const named = (x: ReviewStash): ConfirmContext =>
    repos > 1 ? { ...row(x), text: `${x.repoName} · ${row(x).text}` } : row(x);
  const rows = list.slice(0, list.length > SHOWN ? SHOWN - 1 : SHOWN).map(named);
  if (list.length > rows.length) {
    rows.push({ icon: 'package', text: t('stash.more', { ...cnt(list.length - rows.length) }) });
  }
  const count = t('branches.subStashes', { ...cnt(list.length) });
  return [...rows, { icon: 'branch', text: repos > 1 ? count : `${st.repoName} · ${count}` }];
}

/** Drop (flow P6): confirms dropping `useStashUi.dropping`. */
export function DropStashModal() {
  const list = useStashUi((s) => s.dropping);
  const [dontAsk, setDontAsk] = useState(false);
  if (!list || list.length === 0) return null;
  const close = () => {
    setDontAsk(false);
    useStashUi.setState({ dropping: null });
  };
  const many = list.length > 1;
  const title = t(many ? 'stash.dropTitleN' : 'stash.dropTitle');
  return (
    <ConfirmModal
      aria-label={title}
      title={title}
      width={460}
      onClose={close}
      context={dropContext(list)}
      note={t(many ? 'stash.dropNoteN' : 'stash.dropNote')}
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
          void dropStashes(list);
        }}
      >
        {many ? t('stash.dropBtnN', { ...cnt(list.length) }) : t('stash.dropBtn')}
      </Button>
    </ConfirmModal>
  );
}
