import { useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { t } from '../../i18n';
import { getTagRemote } from '../../lib/ipc';
import { useInvoke } from '../../lib/useInvoke';

/** Confirm Delete Tag (SPEC §16 "Delete Tag"): names the tag; with a remote, an option deletes it
 * there too (off: a tag that was pushed comes back with the next fetch). */
export function DeleteTagModal({
  repoId,
  repoName,
  tag,
  onClose,
  onDelete,
}: {
  repoId: string;
  repoName: string;
  tag: string;
  onClose: () => void;
  onDelete: (remote: boolean) => void;
}) {
  const { data: on } = useInvoke(() => getTagRemote(repoId), [repoId]);
  const [remote, setRemote] = useState(false);
  return (
    <ConfirmModal
      aria-label={t('tag.deleteTitle')}
      title={t('tag.deleteTitle')}
      width={460}
      onClose={onClose}
      context={[{ icon: 'tag', text: `${repoName} / ${tag}` }]}
      options={
        on ? [{ label: t('tag.deleteRemote', { remote: on }), checked: remote, onChange: setRemote }] : undefined
      }
    >
      <Button size={36} autoFocus onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size={36}
        onClick={() => {
          onClose();
          onDelete(remote && !!on);
        }}
      >
        {t('tag.deleteBtn')}
      </Button>
    </ConfirmModal>
  );
}
