//! Computed results keyed by (repo, branch tip, base tip). A tip or base that has not moved
//! is never recomputed.

use std::collections::{HashMap, HashSet};

use crate::git::history::{CommittedStats, MergedState};
use crate::model::{CommitChanges, CommitInfo, FileChange, StackHint};
use crate::nearest::NearestDefault;

/// What a worktree's working tree holds, valid while its HEAD stays `head` and the watcher
/// reports no change in it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkdirState {
    pub head: String,
    pub count: Option<u32>,
    /// HEAD ↔ working tree.
    pub uncommitted: Option<Vec<FileChange>>,
    /// Merge-base ↔ working tree, per merge-base.
    pub all: HashMap<String, Vec<FileChange>>,
}

/// The committed file list and commit list of a branch against a base (review screen), with
/// its stacked-branch candidates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedDetail {
    pub files: Vec<FileChange>,
    /// `fromBranch` filled from the stack candidates.
    pub commits: Vec<CommitInfo>,
    pub suggested: Vec<StackHint>,
}

type Key = (String, String, String);

/// Past this many entries the cache is dropped instead of pruned.
const MAX_ENTRIES: usize = 5000;

#[derive(Default)]
pub struct Cache {
    committed: HashMap<Key, CommittedStats>,
    /// Per repository: which other branches are merged into the default base.
    /// Per (repo, default base name): the default can have a local and a remote form (T13.1).
    merged: HashMap<(String, String), MergedState>,
    detail: HashMap<Key, CommittedDetail>,
    /// Per worktree folder (canonical).
    workdirs: HashMap<std::path::PathBuf, WorkdirState>,
    /// Per (repo, commit): a commit never changes, so these are kept until the repo is removed.
    commits: HashMap<(String, String), CommitChanges>,
    /// The nearest-default pick per (repo, tip, local default tip, remote default tip).
    nearest: HashMap<(String, String, String, String), NearestDefault>,
}

fn key(repo_id: &str, tip: &str, base: &str) -> Key {
    (repo_id.to_string(), tip.to_string(), base.to_string())
}

impl Cache {
    pub fn committed(&self, repo_id: &str, tip: &str, base: &str) -> Option<CommittedStats> {
        self.committed.get(&key(repo_id, tip, base)).cloned()
    }

    pub fn put_committed(&mut self, repo_id: &str, tip: &str, base: &str, stats: CommittedStats) {
        self.committed.insert(key(repo_id, tip, base), stats);
    }

    pub fn merged(&self, repo_id: &str, base: &str) -> Option<MergedState> {
        self.merged
            .get(&(repo_id.to_string(), base.to_string()))
            .cloned()
    }

    pub fn put_merged(&mut self, repo_id: &str, base: &str, state: MergedState) {
        self.merged
            .insert((repo_id.to_string(), base.to_string()), state);
    }

    pub fn detail(&self, repo_id: &str, tip: &str, base: &str) -> Option<CommittedDetail> {
        self.detail.get(&key(repo_id, tip, base)).cloned()
    }

    pub fn put_detail(&mut self, repo_id: &str, tip: &str, base: &str, detail: CommittedDetail) {
        self.detail.insert(key(repo_id, tip, base), detail);
    }

    /// The cached state of a worktree whose HEAD is still `head`.
    pub fn workdir(&self, path: &std::path::Path, head: &str) -> Option<WorkdirState> {
        self.workdirs.get(path).filter(|w| w.head == head).cloned()
    }

    /// Updates a worktree's state for `head` (starting afresh if HEAD moved).
    pub fn update_workdir(
        &mut self,
        path: &std::path::Path,
        head: &str,
        f: impl FnOnce(&mut WorkdirState),
    ) {
        let w = self.workdirs.entry(path.to_path_buf()).or_default();
        if w.head != head {
            *w = WorkdirState {
                head: head.to_string(),
                ..WorkdirState::default()
            };
        }
        f(w);
    }

    pub fn nearest(
        &self,
        repo_id: &str,
        tip: &str,
        local: &str,
        remote: &str,
    ) -> Option<NearestDefault> {
        let k = (
            repo_id.to_string(),
            tip.to_string(),
            local.to_string(),
            remote.to_string(),
        );
        self.nearest.get(&k).copied()
    }

    pub fn put_nearest(
        &mut self,
        repo_id: &str,
        tip: &str,
        local: &str,
        remote: &str,
        v: NearestDefault,
    ) {
        let k = (
            repo_id.to_string(),
            tip.to_string(),
            local.to_string(),
            remote.to_string(),
        );
        self.nearest.insert(k, v);
    }

    pub fn commit(&self, repo_id: &str, sha: &str) -> Option<CommitChanges> {
        self.commits
            .get(&(repo_id.to_string(), sha.to_string()))
            .cloned()
    }

    pub fn put_commit(&mut self, repo_id: &str, changes: CommitChanges) {
        self.commits
            .insert((repo_id.to_string(), changes.sha.clone()), changes);
    }

    /// Something in the worktree changed (file-watch event).
    pub fn invalidate_workdir(&mut self, path: &std::path::Path) {
        self.workdirs.remove(path);
    }

    /// The refresh button: read every working tree again.
    pub fn invalidate_workdirs(&mut self) {
        self.workdirs.clear();
    }

    /// After a scan of `repo_id`: forgets that repo's entries whose tip no branch has any more.
    pub fn prune(&mut self, repo_id: &str, live_tips: &HashSet<String>) {
        let keep = |k: &Key| k.0 != repo_id || live_tips.contains(&k.1);
        self.committed.retain(|k, _| keep(k));
        if live_tips.is_empty() {
            self.merged.retain(|k, _| k.0 != repo_id);
        }
        self.detail.retain(|k, _| keep(k));
        self.nearest
            .retain(|k, _| k.0 != repo_id || live_tips.contains(&k.1));
        if self.committed.len() + self.detail.len() > MAX_ENTRIES {
            self.committed.clear();
            self.merged.clear();
            self.detail.clear();
            self.nearest.clear();
        }
    }

    /// Drops everything about a repo (removed from the config).
    pub fn forget_repo(&mut self, repo_id: &str) {
        self.prune(repo_id, &HashSet::new());
        self.commits.retain(|k, _| k.0 != repo_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats() -> CommittedStats {
        CommittedStats {
            merge_base: Some("m".into()),
            ahead: 1,
            files: 1,
            add: 1,
            del: 0,
            squash_merged: false,
        }
    }

    #[test]
    fn prune_keeps_live_tips_and_other_repos() {
        let mut c = Cache::default();
        c.put_committed("r_1", "tip1", "b", stats());
        c.put_committed("r_1", "old", "b", stats());
        c.put_committed("r_2", "old", "b", stats());

        c.prune("r_1", &HashSet::from(["tip1".to_string()]));
        assert!(c.committed("r_1", "tip1", "b").is_some());
        assert!(c.committed("r_1", "old", "b").is_none());
        assert!(c.committed("r_2", "old", "b").is_some());
        c.put_merged("r_1", "main", MergedState::default());
        c.forget_repo("r_1");
        assert_eq!(c.merged("r_1", "main"), None);
    }
}
