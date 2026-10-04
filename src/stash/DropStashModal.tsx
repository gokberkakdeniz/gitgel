import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { Modal } from '../components/Modal';
import { plural } from '../lib/format';
import { dropStash, useStashUi } from './actions';
import styles from './DropStashModal.module.css';

/** Drop… (flow P6): confirms dropping `useStashUi.dropping`. */
export function DropStashModal() {
  const st = useStashUi((s) => s.dropping);
  if (!st) return null;
  const close = () => useStashUi.setState({ dropping: null });
  const name = `stash@{${st.index}}`;
  const where = `${st.repoName} / ${st.branch ?? 'detached HEAD'}${st.files !== null ? ` · ${plural(st.files, 'file', 'files')}` : ''}`;
  return (
    <Modal aria-label={`Drop ${name}`} width={460} paddingTop={180} onClose={close}>
      <div className={styles.body}>
        <div className={styles.title}>Drop {name}?</div>
        <div className={styles.context}>
          <span className={styles.row} title={st.message}>
            <Icon name="package" size={14} className={styles.icon} />
            <span className={styles.text}>{st.message}</span>
          </span>
          <span className={styles.row}>
            <Icon name="branch" size={14} className={styles.icon} />
            <span className={styles.text}>{where}</span>
          </span>
        </div>
        <p className={styles.note}>Its changes are lost unless they are somewhere else.</p>
        <div className={styles.actions}>
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
        </div>
      </div>
    </Modal>
  );
}
