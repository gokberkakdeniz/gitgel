import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { plural } from '../lib/format';
import { dropStash, useStashUi } from './actions';

/** Drop (flow P6): confirms dropping `useStashUi.dropping`. */
export function DropStashModal() {
  const st = useStashUi((s) => s.dropping);
  if (!st) return null;
  const close = () => useStashUi.setState({ dropping: null });
  const name = `stash@{${st.index}}`;
  const where = `${st.repoName} / ${st.branch ?? 'detached HEAD'}${st.files !== null ? ` · ${plural(st.files, 'file', 'files')}` : ''}`;
  return (
    <ConfirmModal
      aria-label={`Drop ${name}`}
      title={`Drop ${name}?`}
      width={460}
      onClose={close}
      context={[
        { icon: 'package', text: st.message, title: st.message },
        { icon: 'branch', text: where },
      ]}
      note="Its changes are lost unless they are somewhere else."
    >
      <Button size={36} autoFocus onClick={close}>
        Cancel
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          close();
          void dropStash(st);
        }}
      >
        Drop stash
      </Button>
    </ConfirmModal>
  );
}
