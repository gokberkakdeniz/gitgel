import { openFolder } from '../lib/ipc';
import type { EntrySummary } from '../lib/types';
import { useData } from '../state/data';
import { TerminalIcon } from './icons';
import { MenuItem, MenuNote } from './Menu';
import styles from './OpenItems.module.css';

/** The folder the open items open: the entry's worktree, if it is checked out and its repo exists
 * (a gone detached worktree keeps its path but is `branch_deleted`). */
function openableFolder(e: EntrySummary): string | null {
  return e.state === 'repo_missing' || e.state === 'branch_deleted' ? null : e.worktreePath;
}

/** Open in Finder, then Open in <App> for each app, then the terminal; shared by the entry menus.
 * The items are always listed. A branch that is not checked out still opens its repository
 * folder, with a note; only a missing repo or a deleted branch has nothing to open, and a
 * terminal that is not installed disables only its own item. Each item shows the app's own
 * icon, grayscale. */
export function OpenItems({ entry, onDone }: { entry: EntrySummary; onDone: () => void }) {
  const apps = useData((s) => s.openApps);
  const config = useData((s) => s.config);
  const worktree = openableFolder(entry);
  // No worktree, but the repo is there: the buttons stay enabled and open the repository folder.
  const repoPath =
    !worktree && entry.state !== 'repo_missing' && entry.state !== 'branch_deleted'
      ? (config?.repos.find((r) => r.id === entry.repoId)?.path ?? null)
      : null;
  const folder = worktree ?? repoPath;
  const missingTerminal = apps.find((a) => a.id === 'terminal' && !a.found);
  const note = (() => {
    if (entry.state === 'repo_missing') return 'Repository not found, so there is nothing to open.';
    if (entry.state === 'branch_deleted') return 'The branch was deleted, so there is nothing to open.';
    if (!worktree) return 'Not checked out in a worktree, so this opens the repository folder.';
    if (missingTerminal) return `${missingTerminal.name} is not installed; pick another terminal in Settings.`;
    return null;
  })();
  const open = (app: string) => {
    if (!folder) return;
    onDone();
    // The backend logs a failure; nothing is shown.
    openFolder(folder, app).catch((e) => console.error('cannot open folder', e));
  };
  return (
    <>
      {apps.map((a) => (
        <MenuItem
          key={a.id}
          icon={a.icon ? <img src={a.icon} alt="" className={styles.appIcon} /> : <TerminalIcon />}
          disabled={!folder || !a.found}
          onSelect={() => open(a.id)}
        >
          Open in {a.name}
        </MenuItem>
      ))}
      {note && <MenuNote>{note}</MenuNote>}
    </>
  );
}
