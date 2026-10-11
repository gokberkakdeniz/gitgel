import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { t } from '../i18n';
import { openFile, openFolder } from '../lib/ipc';
import type { Config, EntrySummary } from '../lib/types';
import { useData } from '../state/data';
import { CopyIcon, TerminalIcon } from './icons';
import { MenuDivider, MenuItem, MenuNote } from './Menu';
import styles from './OpenItems.module.css';

/** The folder the open items open: the entry's worktree, if it is checked out and its repo exists
 * (a gone detached worktree keeps its path but is `branch_deleted`). */
function openableFolder(e: EntrySummary): string | null {
  return e.state === 'repo_missing' || e.state === 'branch_deleted' ? null : e.worktreePath;
}

/** Copy Branch Name, in the entry menus; none for a detached HEAD. */
export function CopyBranchItem({ entry, onDone }: { entry: EntrySummary; onDone: () => void }) {
  if (entry.branch === null) return null;
  return (
    <MenuItem
      icon={<CopyIcon />}
      onSelect={() => {
        void writeText(entry.branch!);
        onDone();
      }}
    >
      {t('common.copyBranchName')}
    </MenuItem>
  );
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
            {t('open.inApp', { app: a.name })}
          </MenuItem>
        ))}
    </>
  );
}

/** The folder a file row's menu opens files from: the entry's folder (see `OpenItems`). */
export function useEntryFolder(entry: EntrySummary | undefined): string | null {
  return entryFolder(entry, useData((s) => s.config));
}

/** `useEntryFolder` for a caller that has the config already (and may ask for several entries). */
export function entryFolder(entry: EntrySummary | undefined, config: Config | null): string | null {
  if (!entry || entry.state === 'repo_missing' || entry.state === 'branch_deleted') return null;
  return entry.worktreePath ?? config?.repos.find((r) => r.id === entry.repoId)?.path ?? null;
}

/** The repository folder, for rows that belong to a repo only (a stash). */
export function useRepoFolder(repoId: string): string | null {
  return useData((s) => s.config?.repos.find((r) => r.id === repoId)?.path ?? null);
}

/** Open in Finder (the file selected), then Open in <App> for each editor; the file menu's items.
 * No terminal: it has no use for a file. `at` is asked when an editor is picked: where the diff
 * showing this file has its cursor (the editor opens there). */
export function FileOpenItems({
  files,
  at,
  onDone,
}: {
  /** Each file with the folder it is read from. Several picked files (Hi8, D12; in a project
   * review from several worktrees) open one after another; only one opens at `at`. */
  files: { folder: string; path: string }[];
  at: () => { line: number; column: number } | null;
  onDone: () => void;
}) {
  const apps = useData((s) => s.openApps);
  return (
    <>
      {apps
        .filter((a) => a.found && a.id !== 'terminal')
        .map((a) => (
          <MenuItem
            key={a.id}
            icon={a.icon ? <img src={a.icon} alt="" className={styles.appIcon} /> : <TerminalIcon />}
            onSelect={() => {
              onDone();
              const where = a.id === 'finder' || files.length > 1 ? null : at();
              for (const f of files) openFile(f.folder, f.path, a.id, where).catch((e) => console.error('cannot open file', e));
            }}
          >
            {t('open.inApp', { app: a.name })}
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
    if (entry.state === 'repo_missing') return t('review.goneRepo');
    if (entry.state === 'branch_deleted') return t('project.branchDeleted');
    if (!openableFolder(entry)) return t('open.notCheckedOut');
    if (missingTerminal) return t('open.termMissing', { app: missingTerminal.name });
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
