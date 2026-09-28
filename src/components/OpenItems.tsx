import { openFolder } from '../lib/ipc';
import type { EntrySummary } from '../lib/types';
import { useData } from '../state/data';
import { TerminalIcon } from './icons';
import { MenuItem } from './Menu';
import styles from './OpenItems.module.css';

/** The folder the open items open: the entry's worktree, if it is checked out and its repo exists
 * (a gone detached worktree keeps its path but is `branch_deleted`). */
export function openableFolder(e: EntrySummary): string | null {
  return e.state === 'repo_missing' || e.state === 'branch_deleted' ? null : e.worktreePath;
}

/** Open in Finder, then Open in <App> for each installed app; shared by the entry menus. Each
 * item shows the app's own icon, grayscale. */
export function OpenItems({ path, onDone }: { path: string; onDone: () => void }) {
  const apps = useData((s) => s.openApps);
  const open = (app: string) => {
    onDone();
    // The backend logs a failure; nothing is shown.
    openFolder(path, app).catch((e) => console.error('cannot open folder', e));
  };
  return (
    <>
      {apps.map((a) => (
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
