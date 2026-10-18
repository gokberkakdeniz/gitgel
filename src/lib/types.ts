// Shared with the backend (src-tauri/src/model.rs). Keep field names in sync.

import type { IconName } from '../components/icons';

// ---- Config (stored on disk) ----

export interface RepoConfig {
  id: string; // "r_" + 8 hex
  path: string;
}
export interface LastKnownTip {
  sha: string;
  seenAt: string; // ISO 8601 UTC
}
export interface EntryConfig {
  repoId: string;
  branch: string | null; // null => detached HEAD worktree entry
  worktreePath: string | null; // only set on detached entries
  lastKnownTip: LastKnownTip | null;
}
export interface ProjectConfig {
  id: string; // "p_" + 8 hex
  name: string;
  createdAt: string; // ISO 8601 UTC
  entries: EntryConfig[];
}
export type DiffLayout = 'split' | 'unified';
export type DiffContext = 'changes' | 'whole';
export type Appearance = 'system' | 'light' | 'dark';
export type CommitRows = 'two-line' | 'one-line';
export type HistoryLayout = 'tree' | 'columns';
export type Language = 'system' | 'en' | 'tr';
export type NumberFormat = 'plain-dot' | 'plain-comma' | 'group-comma-dot' | 'group-dot-comma' | 'group-space-dot' | 'group-space-comma';
export interface Settings {
  newBranchCheckout: 'worktree' | 'main' | 'none'; // the row New Branch opens with
  defaultBaseOrder: string[];
  activeDays: number;
  diffView: DiffLayout; // review layout, remembered
  ignoreWhitespace: boolean;
  diffContext: DiffContext; // changes only (folded) or the whole file
  diffContextLines: number; // lines kept around each change: 3, 5 or 10
  zoom: number; // View › Font Size, percent
  language: Language; // Settings › General › Language
  dateFormat: string; // Settings › Appearance › Formatting › Date Format pattern
  timeFormat: string; // Settings › Appearance › Formatting › Time Format pattern
  numberFormat: NumberFormat; // Settings › Appearance › Formatting › Number Format
  preferAbsoluteDates: boolean; // Settings › Appearance › Formatting › Prefer absolute dates
  diffTabSize: number; // Settings › Appearance › Diff › Tab size
  commitRows: CommitRows; // Settings › Appearance › History › Commit rows
  historyLayout: HistoryLayout; // Settings › Appearance › History › Layout
  appearance: Appearance; // Settings › Appearance
  sidebarVisible: boolean; // the main sidebar is shown; remembered
  terminal: TerminalChoice; // Settings › Behaviour › Terminal, for "Open in …"
  terminalCommand: string; // the Other terminal: a command (`%` = folder), an app name, a .app path or a bundle id; empty = Automatic
  checkUpdates: boolean; // Settings › Behaviour › Check for Updates
  lastSeenVersion: string; // the version whose What's New was shown; '' before any
  prompts: Prompts; // Settings › Prompts
  ai: AiSettings; // Settings › AI
}
/** Settings › Prompts (M6): "Show a Confirmation Dialog Before…" each of these. */
export interface Prompts {
  removeRepositories: boolean;
  discardChanges: boolean; // off after "Do not show this message again" in Confirm Discard Changes
  discardStash: boolean;
  deleteProjects: boolean;
  abortOperation: boolean; // Abort of a rebase, merge, cherry-pick or revert (T3)
  amendPushed: boolean; // Amend of a commit already on the remote (Hi10)
}
export type TerminalChoice = 'auto' | 'terminal' | 'iterm' | 'wezterm' | 'other';
export interface Config {
  version: 1;
  repos: RepoConfig[];
  branchBases: Record<string, string>; // entryKey -> base ref name
  projects: ProjectConfig[];
  settings: Settings;
  scripts: ScriptConfig[]; // the user's scripts, in menu order (SPEC §14)
  pinnedRepos: string[]; // repo ids pinned to the top of Branches, in pin order
}

// ---- Scripts (SPEC §14) ----

export type ScriptInputType = 'text' | 'textarea' | 'checkbox' | 'select' | 'branch';
export interface ScriptInput {
  id: string; // A–Z, 0–9, _; env GITGEL_INPUT_<ID>
  label: string;
  type: ScriptInputType;
  default: string; // checkbox: '1' or ''
  options: string[]; // select only
  required: boolean;
  when: string; // CEL; '' = always shown
}
export type ScriptFolder = 'worktree' | 'repo';
export type ScriptMenu = 'branches' | 'project';
export interface ScriptConfig {
  id: string; // "s_" + 8 hex; '' for a new script and in an exported file
  name: string; // {branch}, {base}, {repo} are filled in on the menu
  icon: IconName;
  command: string;
  inputs: ScriptInput[];
  runsIn: ScriptFolder;
  showIn: ScriptMenu[];
  when: string; // CEL; '' = always shown
  openOutput: boolean; // "Open the output panel automatically"
  askFirst: boolean; // "Ask before running"
  disabled: boolean; // turned off in Settings › Scripts: in no menu
}
/** One run of a script (scripts/run.rs). */
export interface ScriptRun {
  runId: string;
  scriptId: string;
  name: string; // filled-in name
  icon: string;
  entryKey: string;
  repoLabel: string; // "web-app / session-token-refresh"
  repoId: string;
  folder: string;
  command: string; // the shell command as it runs, shown in the output panel
  commandVars: { name: string; value: string }[]; // the $VARs it names with their values, for hover
  status: 'running' | 'exited' | 'failed'; // failed: could not start
  exitCode: number | null;
  signal: string | null; // e.g. "SIGINT" after Stop
  stopped: boolean; // Stop was asked for
  startedAt: string;
  endedAt: string | null;
  lastLine: string;
  buffered?: string; // getScriptRun only: the output so far (≤ 2 MB)
  bufferedEnd?: number; // getScriptRun only: bytes so far; a chunk whose `end` is not past it is in `buffered`
}
/** Payload of `script-output`. */
export interface ScriptOutputChunk {
  runId: string;
  data: string;
  end: number; // bytes of output so far, this chunk included
}
/** What a menu knows about the branch besides the entry. */
export interface RunContext {
  base: string | null;
  project: string | null;
}
export interface EntryRef {
  repoId: string;
  branch: string | null;
  worktreePath: string | null;
}

// ---- Scan and summaries ----

export type EntryState =
  | 'ok'
  | 'merged'
  | 'detached'
  | 'base_missing'
  | 'branch_deleted'
  | 'repo_missing'
  | 'git_error';

export interface EntrySummary {
  key: string; // entryKey
  repoId: string;
  repoName: string; // basename of the repo folder
  branch: string | null;
  worktreePath: string | null; // where it is checked out; null if not checked out
  headSha: string | null; // current tip; null if deleted or the repo is missing
  shortSha: string | null;
  base: string | null; // effective base ref (custom or repo default)
  baseIsCustom: boolean;
  ahead: number | null;
  behind: number | null; // base commits the branch does not have
  files: number | null; // files changed merge-base..tip
  add: number | null;
  del: number | null;
  uncommitted: number | null; // null if not checked out
  conflicts: number; // uncommitted files with merge conflicts
  lastCommitAt: number | null; // committer time of the tip, unix seconds
  changedAt: number | null; // newest uncommitted file mtime, only when newer than lastCommitAt
  state: EntryState;
  error: string | null; // detail for git_error / base_missing
  upstream: Upstream | null; // where it is pushed to; null when detached, deleted or without a remote
  operation: Operation | null; // a rebase, merge, cherry-pick or revert stopped in its worktree
}
export type OperationKind = 'rebase' | 'merge' | 'cherry_pick' | 'revert';
/** An operation git left half done in an entry's worktree (SPEC §15 "Operations in progress"). */
export interface Operation {
  kind: OperationKind;
  onto: string | null; // rebase: what it rebases on (a branch at that commit, else the short SHA)
  other: string | null; // merge: what is merged in ("main", "origin/feat")
  commit: string | null; // short SHA of the commit it stopped at (rebase) or applies (cherry-pick, revert)
  subject: string | null; // that commit's subject
  step: number | null; // rebase: the commit it stopped at (1-based) of `total`
  total: number | null;
  unresolved: string[]; // conflicted files that still have git's markers: Continue waits for none
}
/** What deleting a branch loses: its commits on no other branch, tag or remote-tracking branch. */
export interface BranchLoss {
  lost: number; // its own remote-tracking branch kept
  lostWithRemote: number; // its remote branch deleted too
}
/** What stops New Branch (`check_new_branch`). */
export type NewBranchProblem = 'badName' | 'exists' | 'badFolder' | 'folderNotEmpty' | 'mainBusy' | 'cannotBring';
/** Where New Branch checks the branch out: a new linked worktree, the repository folder (its
 * uncommitted changes brought along, or stashed first) or nowhere. */
export type NewBranchCheckout = { kind: 'worktree'; folder: string } | { kind: 'main'; bring: boolean } | { kind: 'none' };
/** What stops Checkout Branch (`check_checkout`). */
export type CheckoutProblem = 'unavailable' | 'exists' | 'noWorktree' | 'busy' | 'cannotBring' | 'badFolder' | 'folderNotEmpty';
/** Where Checkout Branch checks the branch out: one of the repo's worktrees, which switches to it
 * (its uncommitted changes brought along, or stashed first), or a new linked worktree. */
export type CheckoutTarget = { kind: 'existing'; folder: string; bring: boolean } | { kind: 'new'; folder: string };
/** A branch against its remote, as of the last fetch (W4a). */
export interface Upstream {
  remote: string; // e.g. "origin"
  name: string | null; // the remote-tracking branch ("origin/feat"); null: not on the remote
  ahead: number; // commits the remote lacks (on top of `name`, else on top of the base)
  behind: number; // commits of `name` the branch lacks
  mergeBase: string | null; // newest commit shared with `name` (Review's upstream line)
}

export interface OtherBranch {
  repoId: string;
  repoName: string;
  branch: string;
  lastCommitAt: number;
  merged: boolean;
}
/** A remote-tracking branch no local branch tracks or shares a name with. */
export interface RemoteBranch {
  name: string; // e.g. "origin/feat/x"
  lastCommitAt: number;
}
export interface RepoScan {
  repo: RepoConfig;
  name: string;
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  defaultBase: string | null; // e.g. "main"
  defaultBaseSource: string | null; // matching defaultBaseOrder item, e.g. "origin/HEAD"
  baseBranch: string | null; // local name of the base branch, always in `active` (first row of its band)
  active: EntrySummary[]; // active branches + detached worktrees, newest first
  others: OtherBranch[]; // all other local branches except the base branch
  remotes: RemoteBranch[]; // remote-tracking branches with no local twin, newest first
  stashes: StashInfo[]; // the stash stack, newest first (one per repo, shared by its worktrees)
}
/** One entry of Stash Changes (P4, `stash_push`). */
export interface StashPush extends EntryRef {
  paths: string[] | null; // the files picked (a rename's old path too); null: all of them
  untracked: boolean; // --include-untracked
}
/** One entry of a Discard (Hi8, D12, `git_discard`). */
export interface DiscardFiles extends EntryRef {
  paths: string[]; // relative to the worktree (a rename's old path too)
  keepIndex: string[]; // of `paths`, the ones whose unstaged part alone goes (back to the index)
}
/** A worktree's uncommitted changes as git's index splits them (History's sections, `get_index_changes`). */
export interface IndexChanges {
  staged: FileChange[]; // HEAD ↔ index
  unstaged: FileChange[]; // index ↔ working tree, untracked included
}
/** What a Stage changes in the index (`git_stage`): whole files, relative to the worktree. */
export interface StageFiles {
  stage: string[];
  unstage: string[];
}
/** What a Commit holds (W1a, `git_commit`). */
export interface CommitFiles {
  summary: string;
  description: string;
  noVerify: boolean; // skip the commit hooks (Commit Without Hooks)
  amend?: string | null; // Amend (Hi10): the newest commit's SHA, which `--amend` replaces
}
/** An agent CLI that writes a commit message (SPEC §15 "Generate message"). */
export type CommitProvider = 'opencode' | 'claude' | 'cursor' | 'antigravity' | 'codex' | 'foundation';
/** One provider's switch, model, effort and prompt; empty is the default. */
export interface AiProviderSettings {
  enabled: boolean; // off hides the provider from the commit menu
  model: string | null;
  effort: string | null; // free text: the names are the model provider's own
  prompt: string | null; // unset sends the built-in default; needs {patch}
}
/** Settings › AI (SPEC §5). */
export interface AiSettings {
  enabled: boolean; // the commit form's generate control shows
  order: string[]; // menu order: provider ids, as the Settings list has them; the default is the topmost switched-on one
  opencode: AiProviderSettings;
  claude: AiProviderSettings;
  cursor: AiProviderSettings;
  antigravity: AiProviderSettings;
  codex: AiProviderSettings;
  foundation: AiProviderSettings;
}
/** One agent CLI: whether it is installed (`get_ai_status`). */
export interface AiStatus {
  id: CommitProvider;
  installed: boolean;
}
/** What a generation's run reports through `generate-finished`: the form's two fields, or why
 * there are none (`cancelled`: stopped, stays quiet). */
export interface GenerateFinished {
  runId: string;
  summary: string | null;
  description: string | null;
  error: string | null;
  cancelled: boolean;
}
/** One stash@{n} (flow P). */
export interface StashInfo {
  index: number; // n in stash@{n}; 0 is the newest
  sha: string;
  message: string; // the text after "On <branch>: ", or the whole "WIP on …" line
  branch: string | null; // the branch it was taken on; null on a detached HEAD
  branchExists: boolean;
  base: string; // the commit it was taken on (its first parent)
  files: number | null; // null when its changes could not be read
  createdAt: number; // unix seconds
}
export interface ScanResult {
  repos: RepoScan[];
  scannedAt: number;
}

// Payload of the `repo-updated` event.
export interface RepoUpdated {
  repoId: string;
  scan: RepoScan; // full current state; replaces the stored record
  reason: 'refs' | 'worktree' | 'rescan';
  worktreePath: string | null; // the changed worktree when reason is 'worktree'
}

// ---- Review ----

export type DiffMode = 'committed' | 'uncommitted' | 'all';
export type FileKind = 'A' | 'M' | 'R' | 'D' | 'U' | 'C'; // C: merge conflict (unmerged)
export interface FileChange {
  path: string;
  oldPath: string | null; // R only
  kind: FileKind;
  add: number | null; // null if binary
  del: number | null;
  binary: boolean;
  oldOid: string | null; // null => left side empty (added / untracked)
  newOid: string | null; // null => right side read from disk (worktree); empty for D
}
export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: number;
  fromBranch: string | null; // the other branch this commit belongs to, if any
}
export interface StackHint {
  branch: string;
  contains: number;
  total: number;
}
export interface ReviewGroup {
  entry: EntrySummary;
  mergeBase: string | null;
  files: Record<DiffMode, FileChange[]>; // all three modes at once; the toggle is instant
  commits: CommitInfo[];
  stackHint: StackHint | null;
}
// One commit's own changes against its first parent (flow D7).
/** What a stash holds, against the commit it was taken on; untracked files are U. */
export interface StashChanges {
  sha: string;
  base: string;
  files: FileChange[];
}
/** One commit of a history page (SPEC §16). */
export interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  body: string; // the message after the subject, trimmed; '' when none
  author: string;
  authorEmail: string;
  committedAt: number; // committer time, unix seconds
  parents: number; // > 1: a merge commit
  inBase: boolean; // reachable from the base asked for (below the base line)
}
export interface HistoryPage {
  rev: string;
  tip: string | null; // null => the rev does not resolve
  commits: HistoryCommit[]; // newest first, at most `limit`
  more: boolean; // more commits (or matches) past `limit`
  ahead: number | null; // commits not in the base; null without a base
  fetchedAt: number | null; // FETCH_HEAD's modification time; null if never fetched
  upstream: Upstream | null; // when rev is a local branch: where it is pushed to (W4a)
}
export interface CommitChanges {
  sha: string;
  parent: string | null; // null => root commit, compared with an empty tree
  files: FileChange[];
}
/** Several commits taken together (History's selection, Hi12). */
export interface RangeChanges {
  parent: string | null; // null => root commit, compared with an empty tree
  files: FileChange[];
}
/** A repository remote's web page (`get_remote_url`): `origin` if there is one. The host
 * decides the URL shape: GitLab (`/-/commit`, `/-/blob`), Bitbucket (`/commits`, `/src`),
 * anything else (Gitea, Forgejo, self-hosted) GitHub-style (`/commit`, `/blob`). */
export interface RemoteInfo {
  base: string;
  kind: 'github' | 'gitlab' | 'bitbucket' | 'other';
}
export interface ReviewData {
  groups: ReviewGroup[]; // reviewable entries, in project order
  notInReview: EntrySummary[]; // project scope only
  totalEntries: number;
}
export type ReviewTarget =
  | { kind: 'project'; projectId: string }
  | {
      kind: 'branch';
      repoId: string;
      branch: string | null;
      worktreePath: string | null;
      tipOverride: string | null;
    }
  | { kind: 'stashes'; repoId: string }; // a repo's stash stack (flow P3)
export interface FilePair {
  original: string;
  modified: string;
  binary: boolean;
  tooLarge: boolean;
}

// ---- Other ----

export type FolderKind = 'repo' | 'resolved' | 'duplicate' | 'not_git';
export interface FolderCheck {
  input: string; // the path the user picked
  kind: FolderKind;
  repoPath: string | null; // resolved main repository root
  via: 'worktree' | 'subdir' | null; // how resolved/duplicate inputs were resolved
  duplicateOf: 'config' | 'batch' | null;
  defaultBase: string | null;
}
export interface BaseCandidate {
  name: string; // "master" or "origin/master"
  remote: boolean;
  ahead: number | null; // the entry's commits on top of it; null if unrelated
  sameAs: string | null; // the other candidate's name when both are one commit
  unrelated: boolean; // no common ancestor with the entry's tip
  auto: boolean; // the one the nearest-default rule picked
}
export interface BaseOptions {
  current: string | null;
  suggested: StackHint[]; // descending by contains, contains > 0
  defaults: { source: string; candidates: BaseCandidate[] } | null; // local first
  branches: string[]; // all local branches except the entry itself
  remotes: string[]; // remote-tracking, same-name first
  tags: string[];
}
export interface ProjectView {
  project: ProjectConfig;
  entries: EntrySummary[];
}

/** An installed app the entry menus can open a worktree folder in. */
export interface OpenApp {
  id: string; // "vscode"
  name: string; // "VS Code"
  icon: string | null; // PNG data URL of the app's icon
  found: boolean; // false only for a terminal that is not installed
}

/** A terminal the Settings dropdown can choose: whether it is installed. */
export interface TerminalOption {
  choice: TerminalChoice; // "terminal" | "iterm" | "wezterm"
  name: string; // "Terminal"
  found: boolean;
}

// A newer version found by the update check (updates.rs); `update-available` carries it or null.
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null; // the feed's CHANGELOG.md sections, newest first
}

/** Payload of `update-check` (Gitgel › Check for Updates…), shown by the Software Update window. */
export type UpdateCheck =
  | { state: 'checking'; currentVersion: string }
  | { state: 'upToDate'; currentVersion: string }
  | { state: 'available'; version: string; currentVersion: string; notes: string | null }
  | { state: 'failed'; currentVersion: string; message: string };

// What `invoke` rejects with (AppError in error.rs).
export interface AppError {
  code: string;
  message: string;
}
