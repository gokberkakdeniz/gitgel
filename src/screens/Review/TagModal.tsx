import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { t } from '../../i18n';
import { checkNewTag } from '../../lib/ipc';
import type { NewTagProblem } from '../../lib/types';
import styles from './TagModal.module.css';

const PROBLEM: Record<NewTagProblem, string> = {
  badName: 'tag.badName',
  exists: 'tag.exists',
};

/** Create a Tag (SPEC §16 "Create Tag"): the tag's name and an optional message (with one the tag
 * is annotated, without it lightweight), then Create Tag. The name is checked as it is typed. */
export function TagModal({
  repoId,
  sub,
  onClose,
  onCreate,
}: {
  repoId: string;
  /** `<repo> / <short SHA>`. */
  sub: string;
  onClose: () => void;
  onCreate: (name: string, message: string) => void;
}) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState<NewTagProblem | null>(null);
  const [checking, setChecking] = useState(false);
  const tag = name.trim();

  // Checked as it is typed, 150 ms after the last change.
  useEffect(() => {
    if (!tag) {
      setProblem(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    let live = true;
    const timer = setTimeout(() => {
      checkNewTag(repoId, tag)
        .then((p) => live && setProblem(p))
        .catch(() => live && setProblem(null))
        .finally(() => live && setChecking(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repoId, tag]);

  const ok = !!tag && !problem && !checking;
  const create = () => {
    if (!ok) return;
    onClose();
    onCreate(tag, message.trim());
  };
  return (
    <Modal aria-label={t('tag.title')} width={480} paddingTop={110} onClose={onClose}>
      <div
        onKeyDown={(e) => {
          // Listed in lib/shortcuts.ts: ↵ in the name, ⌘↵ anywhere.
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          if (e.metaKey || (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            create();
          }
        }}
      >
        <ModalHeader title={t('tag.title')} sub={sub} subMono onClose={onClose} />
        <div className={styles.body}>
          <Input
            size={36}
            mono
            autoFocus
            spellCheck={false}
            autoComplete="off"
            invalid={!!problem}
            aria-label={t('tag.name')}
            placeholder={t('tag.name')}
            value={name}
            onChange={setName}
          />
          <textarea
            rows={3}
            aria-label={t('tag.message')}
            placeholder={t('tag.message')}
            className={styles.area}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {problem && <span className={styles.error}>{t(PROBLEM[problem], { tag })}</span>}
        </div>
        <ModalFooter>
          <Button size={36} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size={36} kbd="↵" disabled={!ok} onClick={create}>
            {t('tag.button')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
