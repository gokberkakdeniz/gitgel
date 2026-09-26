// Typed wrappers for the backend commands (src-tauri/src/commands.rs).
import { invoke } from '@tauri-apps/api/core';
import type {
  BaseOptions,
  Config,
  EntryRef,
  FileChange,
  FilePair,
  FolderCheck,
  ProjectConfig,
  ProjectView,
  ReviewData,
  ReviewTarget,
  ScanResult,
  Settings,
} from './types';

export const getConfig = () => invoke<Config>('get_config');

export const inspectFolders = (paths: string[]) => invoke<FolderCheck[]>('inspect_folders', { paths });

export const addRepos = (paths: string[]) => invoke<Config>('add_repos', { paths });

export const getScan = () => invoke<ScanResult>('get_scan');

/** `force` also rereads every working tree (the refresh button). */
export const rescanAll = (force: boolean) => invoke<ScanResult>('rescan_all', { force });

export const getReview = (target: ReviewTarget) => invoke<ReviewData>('get_review', { target });

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
