// Shared with the backend (src-tauri/src/model.rs). Keep field names in sync.

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
export interface Settings {
  defaultBaseOrder: string[];
  activeDays: number;
  diffView: DiffLayout; // review layout, remembered
  ignoreWhitespace: boolean;
}
export interface Config {
  version: 1;
  repos: RepoConfig[];
  branchBases: Record<string, string>; // entryKey -> base ref name
  projects: ProjectConfig[];
  settings: Settings;
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
  files: number | null; // files changed merge-base..tip
  add: number | null;
  del: number | null;
  uncommitted: number | null; // null if not checked out
  lastCommitAt: number | null; // committer time of the tip, unix seconds
  state: EntryState;
  error: string | null; // detail for git_error / base_missing
}

export interface OtherBranch {
  repoId: string;
  repoName: string;
  branch: string;
  lastCommitAt: number;
  merged: boolean;
}
export interface RepoScan {
  repo: RepoConfig;
  name: string;
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  defaultBase: string | null; // e.g. "main"
  defaultBaseSource: string | null; // matching defaultBaseOrder item, e.g. "origin/HEAD"
  active: EntrySummary[]; // active branches + detached worktrees, newest first
  others: OtherBranch[]; // all other local branches except the base branch
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
export type FileKind = 'A' | 'M' | 'R' | 'D' | 'U';
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
    };
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
export interface BaseOptions {
  current: string | null;
  suggested: StackHint[]; // descending by contains, contains > 0
  default: { name: string; source: string } | null;
  branches: string[]; // all local branches except the entry itself
  tags: string[];
}
export interface ProjectView {
  project: ProjectConfig;
  entries: EntrySummary[];
}

// What `invoke` rejects with (AppError in error.rs).
export interface AppError {
  code: string;
  message: string;
}
