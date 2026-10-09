import { useState } from 'react';
import { Button } from '../../components/Button';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { plural } from '../../lib/format';
import { addRepos, inspectFolders } from '../../lib/ipc';
import { tildifyHome } from '../../lib/paths';
import type { AppError, FolderCheck } from '../../lib/types';
import { useInvoke } from '../../lib/useInvoke';
import { useData } from '../../state/data';
import { useUi } from '../../state/ui';
import styles from './AddReposSheet.module.css';

/** Flow A2: validates the picked folders and adds their repositories. */
export function AddReposSheet() {
  const paths = useUi((s) => s.addReposSheet);
  if (!paths) return null;
  return <Sheet paths={paths} />;
}

function Sheet({ paths }: { paths: string[] }) {
  const close = () => useUi.getState().setAddReposSheet(null);
  const hasRepos = useData((s) => (s.config?.repos.length ?? 0) > 0);
  const { data: checks, error } = useInvoke(() => inspectFolders(paths), [paths]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<AppError | null>(null);

  const addable = (checks ?? []).filter((c) => c.kind === 'repo' || c.kind === 'resolved').length;

  const add = async () => {
    setAdding(true);
    setAddError(null);
    try {
      await addRepos(paths);
      close();
    } catch (e) {
      setAddError(e as AppError);
      setAdding(false);
    }
  };

  return (
    <Modal aria-label="Add Repositories" width={600} paddingTop={110} onClose={close}>
      <ModalHeader
        title="Add Repositories"
        sub={`${plural(paths.length, 'folder', 'folders')} selected. ${
          hasRepos ? 'Repositories already in Gitgel are skipped.' : 'Worktree folders resolve to their main repository.'
        }`}
      />
      <div className={styles.list}>
        {checks?.map((c, i) => (
          <div key={i} className={styles.row}>
            <span className={`${styles.icon} ${styles[ICONS[c.kind].tone]}`}>{ICONS[c.kind].glyph}</span>
            <span className={styles.text}>
              <span className={styles.path}>{tildifyHome(c.input)}</span>
              <span className={styles.note}>{note(c)}</span>
            </span>
          </div>
        ))}
        {(error ?? addError) && <div className={styles.error}>{(error ?? addError)!.message}</div>}
      </div>
      <ModalFooter ruled={false}>
        <Button size={36} onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={!checks || addable === 0 || adding} onClick={add}>
          Add {plural(addable, 'repository', 'repositories')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

const ICONS: Record<FolderCheck['kind'], { glyph: string; tone: 'ok' | 'warn' | 'bad' }> = {
  repo: { glyph: '✓', tone: 'ok' },
  resolved: { glyph: '↪', tone: 'warn' },
  duplicate: { glyph: '↪', tone: 'warn' },
  not_git: { glyph: '✕', tone: 'bad' },
};

export function note(c: FolderCheck): string {
  const repo = c.repoPath ? tildifyHome(c.repoPath) : '';
  switch (c.kind) {
    case 'repo':
      return c.defaultBase
        ? `Git repository · default base ${c.defaultBase}`
        : 'Git repository · no default base found';
    case 'resolved':
      return c.via === 'worktree'
        ? `Worktree of ${repo} · adds the main repository`
        : `Inside ${repo} · adds the repository root`;
    case 'duplicate':
      if (c.via === 'worktree') {
        return c.duplicateOf === 'config'
          ? `Worktree of ${repo} · already added, skipped`
          : `Worktree of ${repo} · already in this list, skipped`;
      }
      return c.duplicateOf === 'config' ? 'Already added · skipped' : 'Already in this list · skipped';
    case 'not_git':
      return 'Not a git repository · skipped';
  }
}
