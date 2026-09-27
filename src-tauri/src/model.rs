//! Serialized types shared with the frontend (`src/lib/types.ts`). Field names match the
//! TypeScript side through serde's camelCase renaming.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Key of a project entry and of `Config::branch_bases`.
pub fn entry_key(repo_id: &str, branch: Option<&str>, worktree_path: Option<&str>) -> String {
    match branch {
        Some(branch) => format!("{repo_id}:{branch}"),
        None => format!("{repo_id}:@{}", worktree_path.unwrap_or_default()),
    }
}

// ---- Config (stored on disk) ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastKnownTip {
    pub sha: String,
    /// ISO 8601 UTC.
    pub seen_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryConfig {
    pub repo_id: String,
    /// `None` for a detached HEAD worktree entry.
    pub branch: Option<String>,
    /// Set only on detached entries.
    pub worktree_path: Option<String>,
    pub last_known_tip: Option<LastKnownTip>,
}

impl EntryConfig {
    pub fn key(&self) -> String {
        entry_key(
            &self.repo_id,
            self.branch.as_deref(),
            self.worktree_path.as_deref(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    /// ISO 8601 UTC.
    pub created_at: String,
    pub entries: Vec<EntryConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub default_base_order: Vec<String>,
    pub active_days: u32,
    /// Review layout; configs from before it load as `split`.
    pub diff_view: DiffLayout,
    pub ignore_whitespace: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            default_base_order: vec!["origin/HEAD".into(), "main".into(), "master".into()],
            active_days: 14,
            diff_view: DiffLayout::Split,
            ignore_whitespace: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLayout {
    #[default]
    Split,
    Unified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub repos: Vec<RepoConfig>,
    /// entryKey -> base ref name.
    pub branch_bases: BTreeMap<String, String>,
    pub projects: Vec<ProjectConfig>,
    pub settings: Settings,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            version: 1,
            repos: Vec::new(),
            branch_bases: BTreeMap::new(),
            projects: Vec::new(),
            settings: Settings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRef {
    pub repo_id: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
}

// ---- Scan and summaries ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryState {
    Ok,
    Merged,
    Detached,
    BaseMissing,
    BranchDeleted,
    RepoMissing,
    GitError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub key: String,
    pub repo_id: String,
    /// Basename of the repo folder.
    pub repo_name: String,
    pub branch: Option<String>,
    /// Folder it is checked out in; `None` if not checked out.
    pub worktree_path: Option<String>,
    /// Current tip; `None` if deleted or the repo is missing.
    pub head_sha: Option<String>,
    pub short_sha: Option<String>,
    /// Effective base ref name (custom or the repo default).
    pub base: Option<String>,
    pub base_is_custom: bool,
    pub ahead: Option<u32>,
    /// Files changed between merge-base and tip.
    pub files: Option<u32>,
    pub add: Option<u32>,
    pub del: Option<u32>,
    /// `None` if not checked out.
    pub uncommitted: Option<u32>,
    /// Committer time of the tip commit, unix seconds.
    pub last_commit_at: Option<i64>,
    pub state: EntryState,
    /// Detail for `git_error` / `base_missing`.
    pub error: Option<String>,
}

/// Lightweight record for the palette's "Older" group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherBranch {
    pub repo_id: String,
    pub repo_name: String,
    pub branch: String,
    pub last_commit_at: i64,
    pub merged: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepoStatus {
    Ok,
    Missing,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoScan {
    pub repo: RepoConfig,
    pub name: String,
    pub status: RepoStatus,
    pub error: Option<String>,
    /// e.g. "main".
    pub default_base: Option<String>,
    /// The `defaultBaseOrder` item that matched, e.g. "origin/HEAD".
    pub default_base_source: Option<String>,
    /// Active branches and detached worktrees, newest first.
    pub active: Vec<EntrySummary>,
    /// All remaining local branches except the base branch.
    pub others: Vec<OtherBranch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub repos: Vec<RepoScan>,
    pub scanned_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateReason {
    Refs,
    Worktree,
    Rescan,
}

/// Payload of the `repo-updated` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoUpdated {
    pub repo_id: String,
    /// Full current state of the repo; replaces the stored record.
    pub scan: RepoScan,
    pub reason: UpdateReason,
    /// The changed worktree when `reason` is `worktree`.
    pub worktree_path: Option<String>,
}

// ---- Review ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffMode {
    Committed,
    Uncommitted,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileKind {
    A,
    M,
    R,
    D,
    U,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Only for R (and copies reported as A).
    pub old_path: Option<String>,
    pub kind: FileKind,
    /// `None` for binary files.
    pub add: Option<u32>,
    pub del: Option<u32>,
    pub binary: bool,
    /// `None`: the left side is empty (added / untracked).
    pub old_oid: Option<String>,
    /// `None`: the right side is read from disk (worktree), or empty for D.
    pub new_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub committed_at: i64,
    /// Name of the other branch this commit belongs to, if any.
    pub from_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackHint {
    pub branch: String,
    pub contains: u32,
    pub total: u32,
}

/// `Record<DiffMode, FileChange[]>` on the TypeScript side.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesByMode {
    pub committed: Vec<FileChange>,
    pub uncommitted: Vec<FileChange>,
    pub all: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGroup {
    pub entry: EntrySummary,
    pub merge_base: Option<String>,
    pub files: FilesByMode,
    pub commits: Vec<CommitInfo>,
    pub stack_hint: Option<StackHint>,
}

/// One commit's own changes, against its first parent (flow D7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChanges {
    pub sha: String,
    /// First parent; `None` for a root commit (compared with an empty tree).
    pub parent: Option<String>,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewData {
    /// Reviewable entries, in project order.
    pub groups: Vec<ReviewGroup>,
    /// Project scope only.
    pub not_in_review: Vec<EntrySummary>,
    pub total_entries: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReviewTarget {
    Project {
        project_id: String,
    },
    Branch {
        repo_id: String,
        branch: Option<String>,
        worktree_path: Option<String>,
        tip_override: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePair {
    pub original: String,
    pub modified: String,
    pub binary: bool,
    pub too_large: bool,
}

// ---- Other ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderKind {
    Repo,
    Resolved,
    Duplicate,
    NotGit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedVia {
    Worktree,
    Subdir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateOf {
    Config,
    Batch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCheck {
    /// The path the user picked.
    pub input: String,
    pub kind: FolderKind,
    /// Resolved main repository root.
    pub repo_path: Option<String>,
    /// How `resolved` / `duplicate` inputs were resolved.
    pub via: Option<ResolvedVia>,
    pub duplicate_of: Option<DuplicateOf>,
    pub default_base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBase {
    pub name: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOptions {
    pub current: Option<String>,
    /// Descending by `contains`, only `contains > 0`.
    pub suggested: Vec<StackHint>,
    pub default: Option<DefaultBase>,
    /// All local branches except the entry itself.
    pub branches: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub project: ProjectConfig,
    pub entries: Vec<EntrySummary>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn entry_key_for_branch() {
        assert_eq!(entry_key("r_1", Some("feat/x"), None), "r_1:feat/x");
        // A branch entry ignores the worktree path.
        assert_eq!(entry_key("r_1", Some("main"), Some("/wt")), "r_1:main");
    }

    #[test]
    fn entry_key_for_detached() {
        assert_eq!(
            entry_key("r_1", None, Some("/Users/me/wt/d")),
            "r_1:@/Users/me/wt/d"
        );
    }

    #[test]
    fn review_target_uses_kind_tag_and_camel_case_fields() {
        let t: ReviewTarget = serde_json::from_value(json!({
            "kind": "branch", "repoId": "r_1", "branch": "main",
            "worktreePath": null, "tipOverride": null
        }))
        .unwrap();
        assert_eq!(
            t,
            ReviewTarget::Branch {
                repo_id: "r_1".into(),
                branch: Some("main".into()),
                worktree_path: None,
                tip_override: None,
            }
        );
        let p = serde_json::to_value(ReviewTarget::Project {
            project_id: "p_1".into(),
        })
        .unwrap();
        assert_eq!(p, json!({ "kind": "project", "projectId": "p_1" }));
    }

    #[test]
    fn enums_use_frontend_spelling() {
        assert_eq!(
            serde_json::to_value(EntryState::BaseMissing).unwrap(),
            json!("base_missing")
        );
        assert_eq!(serde_json::to_value(FileKind::U).unwrap(), json!("U"));
        assert_eq!(
            serde_json::to_value(FolderKind::NotGit).unwrap(),
            json!("not_git")
        );
    }
}
