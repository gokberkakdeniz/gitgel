import { openFolder } from '../lib/ipc';
import type { EntrySummary } from '../lib/types';
import { useData } from '../state/data';
import { TerminalIcon } from './icons';
import { MenuDivider, MenuItem, MenuNote } from './Menu';
import styles from './OpenItems.module.css';

/** The folder the open items open: the entry's worktree, if it is checked out and its repo exists
 * (a gone detached worktree keeps its path but is `branch_deleted`). */
function openableFolder(e: EntrySummary): string | null {
  return e.state === 'repo_missing' || e.state === 'branch_deleted' ? null : e.worktreePath;
}

/** Open in Finder, then Open in <App> for each app, then the terminal; shared by the entry menus.
 * A branch that is not checked out opens its repository folder. Nothing is listed for a missing
 * repo or a deleted branch, and a terminal that is not installed is left out (`EntryMenuNote`
 * says why). Each item shows the app's own icon, grayscale. */
export function OpenItems({ entry, onDone }: { entry: EntrySummary; onDone: () => void }) {
  const apps = useData((s) => s.openApps);
  const config = useData((s) => s.config);
  const worktree = openableFolder(entry);
  // No worktree, but the repo is there: the items open the repository folder.
  const repoPath =
    !worktree && entry.state !== 'repo_missing' && entry.state !== 'branch_deleted'
      ? (config?.repos.find((r) => r.id === entry.repoId)?.path ?? null)
      : null;
  const folder = worktree ?? repoPath;
  if (!folder) return null;
  const open = (app: string) => {
    onDone();
    // The backend logs a failure; nothing is shown.
    openFolder(folder, app).catch((e) => console.error('cannot open folder', e));
  };
  return (
    <>
      {apps
        .filter((a) => a.found)
        .map((a) => (
          <MenuItem
            key={a.id}
            icon={a.icon ? <img src={a.icon} alt="" className={styles.appIcon} /> : <TerminalIcon />}
            onSelect={() => open(a.id)}
          >
            Open in {a.name}
          </MenuItem>
        ))}
    </>
  );
}

/** The one note that closes an entry menu, after a divider: why some of its items are missing.
 * Nothing when all is well. */
export function EntryMenuNote({ entry }: { entry: EntrySummary }) {
  const apps = useData((s) => s.openApps);
  const missingTerminal = apps.find((a) => a.id === 'terminal' && !a.found);
  const note = (() => {
    if (entry.state === 'repo_missing') return 'Repository not found, so there is nothing to open.';
    if (entry.state === 'branch_deleted') return 'The branch was deleted, so there is nothing to open.';
    if (!openableFolder(entry)) return 'Not checked out in a worktree, so some items may be unavailable.';
    if (missingTerminal) return `${missingTerminal.name} is not installed; pick another terminal in Settings.`;
    return null;
  })();
  if (!note) return null;
  return (
    <>
      <MenuDivider />
      <MenuNote>{note}</MenuNote>
    </>
  );
}
