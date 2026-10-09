import { useState } from 'react';
import { plural } from '../lib/format';
import { deleteProject } from '../lib/ipc';
import { useData } from '../state/data';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';

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
    <ConfirmModal
      aria-label="Delete project"
      title={`Delete “${project.name}”?`}
      width={440}
      onClose={close}
      text={`Removes the project and its ${plural(n, 'entry', 'entries')}. Nothing on disk is touched.`}
    >
      <Button size={36} onClick={close}>
        Cancel
      </Button>
      <Button variant="danger" size={36} disabled={busy} onClick={confirm}>
        Delete project
      </Button>
    </ConfirmModal>
  );
}
