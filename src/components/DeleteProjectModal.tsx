import { useState } from 'react';
import { plural } from '../lib/format';
import { deleteProject } from '../lib/ipc';
import { stopAsking } from '../lib/prompts';
import { useData } from '../state/data';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';

/** Delete Project… asks first (flow G) unless Settings › Prompts › "Deleting projects" is off. */
export function askDeleteProject(id: string): void {
  if (useData.getState().config?.settings.prompts.deleteProjects === false) void removeProject(id);
  else useUi.getState().setDeletingProjectId(id);
}

/** Deletes it and leaves its page when that is the one shown. */
async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  const nav = useNav.getState();
  const route = selectRoute(nav);
  if (route.name === 'project' && route.projectId === id) nav.replace({ name: 'branches' });
}

/** Flow G: confirms deleting the project in `ui.deletingProjectId`. */
export function DeleteProjectModal() {
  const id = useUi((s) => s.deletingProjectId);
  const project = useData((s) => s.config?.projects.find((p) => p.id === id));
  const [busy, setBusy] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  if (!id || !project) return null;

  const close = () => {
    setDontAsk(false);
    useUi.getState().setDeletingProjectId(null);
  };
  const n = project.entries.length;
  const confirm = async () => {
    setBusy(true);
    try {
      if (dontAsk) stopAsking('deleteProjects');
      await removeProject(project.id);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal
      aria-label="Delete Project"
      title={`Delete “${project.name}”?`}
      width={440}
      onClose={close}
      text={`Removes the project and its ${plural(n, 'entry', 'entries')}. Nothing on disk is touched.`}
      dontAsk={{ checked: dontAsk, onChange: setDontAsk }}
    >
      <Button size={36} onClick={close}>
        Cancel
      </Button>
      <Button variant="danger" size={36} disabled={busy} onClick={confirm}>
        Delete Project…
      </Button>
    </ConfirmModal>
  );
}
