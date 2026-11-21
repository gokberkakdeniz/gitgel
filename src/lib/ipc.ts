// Typed wrappers for the backend commands (src-tauri/src/commands.rs).
import { invoke } from '@tauri-apps/api/core';
import type {
  AiStatus,
  Blame,
  BaseOptions,
  BranchLoss,
  CheckoutProblem,
  CheckoutTarget,
  CommitChanges,
  RangeChanges,
  CommitFiles,
  CommitProvider,
  Config,
  DiscardFiles,
  EntryRef,
  FileChange,
  FilePair,
  FolderCheck,
  HistoryPage,
  IgnoreFiles,
  IndexChanges,
  Note,
  Notes,
  NewBranchCheckout,
  NewBranchProblem,
  NewTagProblem,
  OpenApp,
  ProjectConfig,
  ProjectView,
  ReviewData,
  ReviewTarget,
  RemoteInfo,
  ScanResult,
  RunContext,
  ScriptConfig,
  ScriptRun,
  StashPush,
  StashChanges,
  StageFiles,
  StageLines,
  Settings,
  EditorOption,
  TerminalOption,
  UpdateCheck,
  UpdateInfo,
} from './types';
import type { ThemeFile } from '../themes/types';

export const getConfig = () => invoke<Config>('get_config');

/** Every branch's notes (SPEC §5 Review "Notes"). */
export const getNotes = () => invoke<Notes>('get_notes');

/** Replaces a branch's notes; an empty list drops them. */
export const setNotes = (key: string, list: Note[]) => invoke<void>('set_notes', { key, list });

/** The noted files as they are now (null: missing, binary, too large): from the worktree, else at `rev`. */
export const getNoteFiles = (repoId: string, worktreePath: string | null, rev: string, paths: string[]) =>
  invoke<(string | null)[]>('get_note_files', { repoId, worktreePath, rev, paths });

export const inspectFolders = (paths: string[]) => invoke<FolderCheck[]>('inspect_folders', { paths });

export const addRepos = (paths: string[]) => invoke<Config>('add_repos', { paths });

/** Pins a repo to the top of Branches, or unpins it. */
export const setRepoPinned = (repoId: string, pinned: boolean) => invoke<Config>('set_repo_pinned', { repoId, pinned });

export const getScan = () => invoke<ScanResult>('get_scan');

/** `force` also rereads every working tree (the refresh button). */
export const rescanAll = (force: boolean) => invoke<ScanResult>('rescan_all', { force });

export const getReview = (target: ReviewTarget) => invoke<ReviewData>('get_review', { target });

export const getCommitChanges = (repoId: string, sha: string) =>
  invoke<CommitChanges>('get_commit_changes', { repoId, sha });

/** Review's picked rows taken together (Hi12): `oldest`'s parent ↔ `newest`, or ↔ the working tree. */
export const getRangeChanges = (repoId: string, oldest: string, newest: string | null, worktreePath: string | null) =>
  invoke<RangeChanges>('get_range_changes', { repoId, oldest, newest, worktreePath });

export const getStashChanges = (repoId: string, sha: string) =>
  invoke<StashChanges>('get_stash_changes', { repoId, sha });

/** Up to `limit` commits of `rev`, newest first (SPEC §16); `base` splits off the base line. */
export const getHistory = (repoId: string, rev: string, base: string | null, query: string, limit: number) =>
  invoke<HistoryPage>('get_history', { repoId, rev, base, query, limit });

/** Who last changed each line of `path` at `rev`; with `content`, of that text against `rev`. */
export const getBlame = (repoId: string, rev: string, path: string, content: string | null) =>
  invoke<Blame>('get_blame', { repoId, rev, path, content });

export const readFilePair = (repoId: string, worktreePath: string | null, change: FileChange) =>
  invoke<FilePair>('read_file_pair', { repoId, worktreePath, change });

/** The repository remote's web page and host kind; null with no remote or a local path. */
export const getRemoteUrl = (repoId: string) => invoke<RemoteInfo | null>('get_remote_url', { repoId });

export const createProject = (name: string, entries: EntryRef[]) =>
  invoke<ProjectConfig>('create_project', { name, entries });

export const renameProject = (projectId: string, name: string) => invoke<Config>('rename_project', { projectId, name });

export const deleteProject = (projectId: string) => invoke<Config>('delete_project', { projectId });

export const addEntries = (projectId: string, entries: EntryRef[]) =>
  invoke<Config>('add_entries', { projectId, entries });

export const removeEntries = (projectId: string, keys: string[]) =>
  invoke<Config>('remove_entries', { projectId, keys });

export const getProjectView = (projectId: string) => invoke<ProjectView>('get_project_view', { projectId });

export const getBaseOptions = (repoId: string, key: string) => invoke<BaseOptions>('get_base_options', { repoId, key });

export const setBranchBase = (key: string, base: string | null) => invoke<Config>('set_branch_base', { key, base });

export const verifyRef = (repoId: string, rev: string) => invoke<string | null>('verify_ref', { repoId, rev });

export const commitExists = (repoId: string, sha: string) => invoke<boolean>('commit_exists', { repoId, sha });

export const repointEntry = (projectId: string, key: string, branch: string) =>
  invoke<Config>('repoint_entry', { projectId, key, branch });

export const locateRepo = (repoId: string, path: string) => invoke<Config>('locate_repo', { repoId, path });

export const removeRepo = (repoId: string) => invoke<Config>('remove_repo', { repoId });

export const updateSettings = (settings: Settings) => invoke<Config>('update_settings', { settings });

/** Installed apps for the open items, in menu order. */
export const getOpenApps = () => invoke<OpenApp[]>('get_open_apps');

/** The custom theme files of `<config folder>/themes`, unparsed (src/themes checks them). */
export const getCustomThemes = () => invoke<ThemeFile[]>('get_custom_themes');

/** The known editors with their install state, for the Settings dropdown. */
export const getEditorOptions = () => invoke<EditorOption[]>('get_editor_options');

/** Terminal, iTerm2 and WezTerm with their install state, for the Settings dropdown. */
export const getTerminalOptions = () => invoke<TerminalOption[]>('get_terminal_options');

/** Opens a file (a path inside `folder`) in one of `getOpenApps`; Finder shows it selected, an
 * editor goes to `at` when given. */
export const openFile = (folder: string, file: string, app: string, at?: { line: number; column: number } | null) =>
  invoke<null>('open_file', { folder, file, app, line: at?.line ?? null, column: at?.column ?? null });
/** Opens a worktree folder in one of `getOpenApps` (Finder included). */
export const openFolder = (path: string, app: string) => invoke<null>('open_folder', { path, app });

/** The update found by the last check, if any. */
export const getUpdate = () => invoke<UpdateInfo | null>('get_update');

/** Downloads and installs that update, then the app restarts; rejects if it fails. */
export const installUpdate = () => invoke<void>('install_update');

/** Checks now (the Software Update window's Try Again); the answer arrives as `update-check`. */
export const checkForUpdates = () => invoke<void>('check_for_updates');
/** Opens a remote (commit or file page) link in the browser. */
export const openRemoteLink = (url: string) => invoke<void>('open_remote_link', { url });
export const reportIssue = () => invoke<void>('report_issue');
export const getUpdateCheck = () => invoke<UpdateCheck | null>('get_update_check');
/** About Gitgel, Software Update or What's New, in a window of its own (`windows.rs`). `from`:
 * What's New after an update, the version last seen (its newer versions are marked). */
export const openWindow = (label: 'about' | 'update' | 'whats-new', from?: string) =>
  invoke<void>('open_window', { label, from: from ?? null });
/** This window has drawn: show it (every window starts hidden, so it never flashes white). */
export const revealWindow = () => invoke<void>('reveal_window');

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

export interface StashRef {
  index: number;
  sha: string;
}

/** Git actions (SPEC §15 "Writing stashes"): runs like a script's. */
export const stashPush = (entries: StashPush[], message: string) =>
  invoke<ScriptRun>('stash_push', { entries, message });

/** Applies (or pops) each `stash@{index}` (still `sha`) of one repository in one run. */
export const stashApply = (repoId: string, stashes: StashRef[], worktreePath: string, pop: boolean) =>
  invoke<ScriptRun>('stash_apply', { repoId, stashes, worktreePath, pop });

/** Drops each `stash@{index}` (still `sha`) of one repository in one run. */
export const stashDrop = (repoId: string, stashes: StashRef[]) => invoke<ScriptRun>('stash_drop', { repoId, stashes });

/** Sync (W4a): git actions too, one branch (or repository) each. */
export const gitFetch = (repoId: string) => invoke<ScriptRun>('git_fetch', { repoId });
export const gitPull = (entry: EntryRef, rebase: boolean) => invoke<ScriptRun>('git_pull', { entry, rebase });
export const gitRebaseOnBase = (entry: EntryRef) => invoke<ScriptRun>('git_rebase_on_base', { entry });
export const gitPush = (entry: EntryRef, force = false) => invoke<ScriptRun>('git_push', { entry, force });
/** Undo Commit: `git reset --soft` of the entry's newest commit `sha`. */
export const gitUndoCommit = (entry: EntryRef, sha: string) => invoke<ScriptRun>('git_undo_commit', { entry, sha });
/** Revert Changes: `git revert <sha>` in the entry's worktree. */
export const gitRevert = (entry: EntryRef, sha: string) => invoke<ScriptRun>('git_revert', { entry, sha });
/** Squash: consecutive commits of the entry's branch (newest first) become one with this message. */
export const gitSquash = (entry: EntryRef, shas: string[], summary: string, description: string) =>
  invoke<ScriptRun>('git_squash', { entry, shas, summary, description });
/** Cherry-Pick to: `git cherry-pick <sha>` in one of the repository's worktrees. */
export const gitCherryPick = (repoId: string, sha: string, worktreePath: string) =>
  invoke<ScriptRun>('git_cherry_pick', { repoId, sha, worktreePath });
/** Reorder: the entry's newest commits in this order (newest first; all of them from HEAD down
 * to the oldest one that moves). */
export const gitReorder = (entry: EntryRef, order: string[]) => invoke<ScriptRun>('git_reorder', { entry, order });
/** Reword: a commit of the entry's branch gets this message. */
export const gitReword = (entry: EntryRef, sha: string, summary: string, description: string) =>
  invoke<ScriptRun>('git_reword', { entry, sha, summary, description });
/** Reset to Commit: the branch back to `sha` (`tip`: its newest commit as shown); the commits'
 * changes stay staged, or with `hard` go, the uncommitted ones too. */
export const gitReset = (entry: EntryRef, sha: string, tip: string, hard: boolean) =>
  invoke<ScriptRun>('git_reset', { entry, sha, tip, hard });
/** Create Tag: `git tag <name> <sha>`, annotated when `message` is not empty. */
export const gitCreateTag = (entry: EntryRef, sha: string, name: string, message: string, push: boolean) =>
  invoke<ScriptRun>('git_create_tag', { entry, sha, name, message, push });
/** Push Tag: the tag to the repository's remote (`origin`, or the only one). */
export const gitPushTag = (entry: EntryRef, name: string) => invoke<ScriptRun>('git_push_tag', { entry, name });
/** Delete Tag: `git tag -d <name>`, with `remote` on the remote too. */
export const gitDeleteTag = (entry: EntryRef, name: string, remote: boolean) =>
  invoke<ScriptRun>('git_delete_tag', { entry, name, remote });
/** Delete Tag's remote (`origin`, or the only one); null without one. */
export const getTagRemote = (repoId: string) => invoke<string | null>('get_tag_remote', { repoId });
/** Create Tag's check as the name is typed. */
export const checkNewTag = (repoId: string, name: string) =>
  invoke<NewTagProblem | null>('check_new_tag', { repoId, name });
/** Continue or abort the operation stopped in the entry's worktree. */
export const gitOperation = (entry: EntryRef, abort: boolean) => invoke<ScriptRun>('git_operation', { entry, abort });

/** Delete Branch: `git branch -D` of a branch whose tip is still `sha`, after switching its
 * checkout to the base or removing its worktree (its changes stashed with `stash`); with
 * `remote`, its branch on the remote first. */
/** Delete Branch's note: the branch's commits on no other branch, tag or remote-tracking branch. */
export const getBranchLoss = (repoId: string, branch: string) =>
  invoke<BranchLoss>('get_branch_loss', { repoId, branch });
export const gitDeleteBranch = (repoId: string, branch: string, sha: string, remote: boolean, stash: boolean) =>
  invoke<ScriptRun>('git_delete_branch', { repoId, branch, sha, remote, stash });

/** New Branch: `branch` from `base`, with no upstream, checked out as `checkout` says. */
export const gitCreateBranch = (repoId: string, branch: string, base: string, checkout: NewBranchCheckout) =>
  invoke<ScriptRun>('git_create_branch', { repoId, branch, base, checkout });
/** New Branch's checks as the dialog is filled in. */
export const checkNewBranch = (repoId: string, branch: string, base: string, checkout: NewBranchCheckout) =>
  invoke<NewBranchProblem | null>('check_new_branch', { repoId, branch, base, checkout });

/** Checkout Branch: a local branch checked out nowhere, or with `remote` a remote branch as a
 * local one tracking it, checked out where `target` says. */
export const gitCheckoutBranch = (repoId: string, branch: string, remote: boolean, target: CheckoutTarget) =>
  invoke<ScriptRun>('git_checkout_branch', { repoId, branch, remote, target });
/** Checkout Branch's checks as the dialog is filled in. */
export const checkCheckout = (repoId: string, branch: string, remote: boolean, target: CheckoutTarget) =>
  invoke<CheckoutProblem | null>('check_checkout', { repoId, branch, remote, target });
/** Checkout Commit: the commit as a detached HEAD, checked out where `target` says. */
export const gitCheckoutCommit = (repoId: string, sha: string, target: CheckoutTarget) =>
  invoke<ScriptRun>('git_checkout_commit', { repoId, sha, target });
/** Checkout Commit's checks as the dialog is filled in. */
export const checkCheckoutCommit = (repoId: string, sha: string, target: CheckoutTarget) =>
  invoke<CheckoutProblem | null>('check_checkout_commit', { repoId, sha, target });

/** Commit (W1a): the checked files of the entry's worktree, with the message. */
export const gitCommit = (entry: EntryRef, files: CommitFiles) => invoke<ScriptRun>('git_commit', { entry, files });

/** Generate message (SPEC §15): an agent CLI writes a commit message for the checked files
 * (and `amend`'s changes, the HEAD commit being amended; or, with `squash`, those consecutive
 * commits' changes as one, newest first), as a run; the answer arrives as `generate-finished`. */
export const generateMessageStart = (
  entry: EntryRef,
  include: string[],
  provider: CommitProvider,
  amend: string | null,
  squash: string[] | null = null,
) => invoke<ScriptRun>('generate_message_start', { entry, include, provider, amend, squash });

/** Whether each agent CLI is installed (Settings › AI, the commit menu). */
export const getAiStatus = () => invoke<AiStatus[]>('get_ai_status');

/** The provider's prompt sent without one of its own (the edit modal prefills it). */
export const getDefaultPrompt = (provider: CommitProvider) => invoke<string>('get_default_prompt', { provider });

/** Discard (Hi8, D12): the files go back to HEAD, a copy of each to the Trash first. */
export const gitDiscard = (entries: DiscardFiles[]) => invoke<ScriptRun>('git_discard', { entries });

/** Add to .gitignore: a `/<path>` line per untracked file in the worktree's `.gitignore`. */
export const gitIgnore = (files: IgnoreFiles) => invoke<ScriptRun>('git_ignore', { files });

/** The entry's uncommitted changes as git's index splits them: Review's Staged and Unstaged. */
export const getIndexChanges = (entry: EntryRef) => invoke<IndexChanges>('get_index_changes', { entry });

/** Stage / Unstage (Review's sections): whole files into the index or out of it. */
export const gitStage = (entry: EntryRef, files: StageFiles) => invoke<ScriptRun>('git_stage', { entry, files });

/** Stage / Unstage of picked lines (the diff's menu): one file's new staged version. */
export const gitStageLines = (entry: EntryRef, lines: StageLines) =>
  invoke<ScriptRun>('git_stage_lines', { entry, lines });

/** Typed text for a running script. */
export const writeScriptInput = (runId: string, data: string) => invoke<null>('write_script_input', { runId, data });

/** SIGINT, then SIGKILL after 3 s. */
export const stopScript = (runId: string) => invoke<null>('stop_script', { runId });
/** Saves an SSH key's passphrase in the Keychain (SPEC §15 "SSH passphrase"). */
export const rememberSshKey = (key: string, passphrase: string) =>
  invoke<void>('remember_ssh_key', { key, passphrase });

/** A run with its output so far (`buffered`). */
export const getScriptRun = (runId: string) => invoke<ScriptRun>('get_script_run', { runId });

/** The output panel's terminal size, for the run's pty. */
export const resizeScript = (runId: string, cols: number, rows: number) =>
  invoke<null>('resize_script', { runId, cols, rows });
