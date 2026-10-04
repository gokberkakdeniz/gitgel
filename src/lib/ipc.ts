// Typed wrappers for the backend commands (src-tauri/src/commands.rs).
import { invoke } from '@tauri-apps/api/core';
import type {
  BaseOptions,
  CommitChanges,
  Config,
  EntryRef,
  FileChange,
  FilePair,
  FolderCheck,
  OpenApp,
  ProjectConfig,
  ProjectView,
  ReviewData,
  ReviewTarget,
  ScanResult,
  RunContext,
  ScriptConfig,
  ScriptRun,
  Settings,
  TerminalOption,
  UpdateInfo,
} from './types';

export const getConfig = () => invoke<Config>('get_config');

export const inspectFolders = (paths: string[]) => invoke<FolderCheck[]>('inspect_folders', { paths });

export const addRepos = (paths: string[]) => invoke<Config>('add_repos', { paths });

export const getScan = () => invoke<ScanResult>('get_scan');

/** `force` also rereads every working tree (the refresh button). */
export const rescanAll = (force: boolean) => invoke<ScanResult>('rescan_all', { force });

export const getReview = (target: ReviewTarget) => invoke<ReviewData>('get_review', { target });

export const getCommitChanges = (repoId: string, sha: string) =>
  invoke<CommitChanges>('get_commit_changes', { repoId, sha });

export const readFilePair = (repoId: string, worktreePath: string | null, change: FileChange) =>
  invoke<FilePair>('read_file_pair', { repoId, worktreePath, change });

export const createProject = (name: string, entries: EntryRef[]) =>
  invoke<ProjectConfig>('create_project', { name, entries });

export const renameProject = (projectId: string, name: string) =>
  invoke<Config>('rename_project', { projectId, name });

export const deleteProject = (projectId: string) => invoke<Config>('delete_project', { projectId });

export const addEntries = (projectId: string, entries: EntryRef[]) =>
  invoke<Config>('add_entries', { projectId, entries });

export const removeEntries = (projectId: string, keys: string[]) =>
  invoke<Config>('remove_entries', { projectId, keys });

export const getProjectView = (projectId: string) =>
  invoke<ProjectView>('get_project_view', { projectId });

export const getBaseOptions = (repoId: string, key: string) =>
  invoke<BaseOptions>('get_base_options', { repoId, key });

export const setBranchBase = (key: string, base: string | null) =>
  invoke<Config>('set_branch_base', { key, base });

export const verifyRef = (repoId: string, rev: string) => invoke<string | null>('verify_ref', { repoId, rev });

export const commitExists = (repoId: string, sha: string) => invoke<boolean>('commit_exists', { repoId, sha });

export const repointEntry = (projectId: string, key: string, branch: string) =>
  invoke<Config>('repoint_entry', { projectId, key, branch });

export const locateRepo = (repoId: string, path: string) => invoke<Config>('locate_repo', { repoId, path });

export const removeRepo = (repoId: string) => invoke<Config>('remove_repo', { repoId });

export const updateSettings = (settings: Settings) => invoke<Config>('update_settings', { settings });

/** Installed apps for the open items, in menu order. */
export const getOpenApps = () => invoke<OpenApp[]>('get_open_apps');

/** Terminal, iTerm2 and WezTerm with their install state, for the Settings dropdown. */
export const getTerminalOptions = () => invoke<TerminalOption[]>('get_terminal_options');

/** Opens a worktree folder in one of `getOpenApps` (Finder included). */
export const openFolder = (path: string, app: string) => invoke<null>('open_folder', { path, app });

/** The update found by the last check, if any. */
export const getUpdate = () => invoke<UpdateInfo | null>('get_update');

/** Downloads and installs that update, then the app restarts; rejects if it fails. */
export const installUpdate = () => invoke<void>('install_update');

// ---- Scripts (SPEC §14) ----

/** Adds a script (empty `id`) or replaces the one with that id. */
export const saveScript = (script: ScriptConfig) => invoke<Config>('save_script', { script });

export const deleteScript = (scriptId: string) => invoke<Config>('delete_script', { scriptId });

/** `ids` lists every script once, in the new order. */
export const reorderScripts = (ids: string[]) => invoke<Config>('reorder_scripts', { ids });

export const exportScripts = (path: string) => invoke<null>('export_scripts', { path });

/** An exported file's scripts, for the import preview (ids empty). */
export const readScriptsFile = (path: string) => invoke<ScriptConfig[]>('read_scripts_file', { path });

/** `replace`: names whose existing script is replaced; other clashes are kept as "<name> (2)". */
export const importScripts = (scripts: ScriptConfig[], replace: string[]) =>
  invoke<Config>('import_scripts', { scripts, replace });

/** Starts a script; `inputs` holds only the inputs the dialog showed. */
export const runScript = (script: ScriptConfig, entry: EntryRef, inputs: Record<string, string>, context: RunContext) =>
  invoke<ScriptRun>('run_script', { script, entry, inputs, context });

/** Typed text for a running script. */
export const writeScriptInput = (runId: string, data: string) => invoke<null>('write_script_input', { runId, data });

/** SIGINT, then SIGKILL after 3 s. */
export const stopScript = (runId: string) => invoke<null>('stop_script', { runId });

/** A run with its output so far (`buffered`). */
export const getScriptRun = (runId: string) => invoke<ScriptRun>('get_script_run', { runId });

/** The output panel's terminal size, for the run's pty. */
export const resizeScript = (runId: string, cols: number, rows: number) =>
  invoke<null>('resize_script', { runId, cols, rows });
