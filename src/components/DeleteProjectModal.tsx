import { useState } from 'react';
import { deleteProject } from '../lib/ipc';
import { useData } from '../state/data';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
import { Button } from './Button';
import styles from './DeleteProjectModal.module.css';
import { Modal } from './Modal';

/** Flow G: confirms deleting the project in `ui.deletingProjectId`. */
export function DeleteProjectModal() {
  const id = useUi((s) => s.deletingProjectId);
  const project = useData((s) => s.config?.projects.find((p) => p.id === id));
  const [busy, setBusy] = useState(false);
  if (!id || !project) return null;

  const close = () => useUi.getState().setDeletingProjectId(null);
  const n = project.entries.length;
  const confirm = async () => {
    setBusy(true);
    try {
      await deleteProject(project.id);
      const nav = useNav.getState();
      const route = selectRoute(nav);
      if (route.name === 'project' && route.projectId === project.id) nav.replace({ name: 'branches' });
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal aria-label="Delete project" width={440} paddingTop={180} onClose={close}>
      <div className={styles.body}>
        <div className={styles.title}>Delete “{project.name}”?</div>
        <p className={styles.text}>
          Removes the project and its {n === 1 ? '1 entry' : `${n} entries`}. Nothing on disk is
          touched.
        </p>
        <div className={styles.actions}>
          <Button size={36} onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" size={36} disabled={busy} onClick={confirm}>
            Delete project
          </Button>
        </div>
      </div>
    </Modal>
  );
}
