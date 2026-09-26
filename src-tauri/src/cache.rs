//! Computed results keyed by (repo, branch tip, base tip). A tip or base that has not moved
//! is never recomputed.

use std::collections::{HashMap, HashSet};

use crate::git::history::CommittedStats;
use crate::model::{CommitInfo, FileChange, StackHint};

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
    /// Whether the tip is an ancestor of the base (for `OtherBranch::merged`).
    merged: HashMap<Key, bool>,
    detail: HashMap<Key, CommittedDetail>,
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

    pub fn merged(&self, repo_id: &str, tip: &str, base: &str) -> Option<bool> {
        self.merged.get(&key(repo_id, tip, base)).copied()
    }

    pub fn put_merged(&mut self, repo_id: &str, tip: &str, base: &str, merged: bool) {
        self.merged.insert(key(repo_id, tip, base), merged);
    }

    pub fn detail(&self, repo_id: &str, tip: &str, base: &str) -> Option<CommittedDetail> {
        self.detail.get(&key(repo_id, tip, base)).cloned()
    }

    pub fn put_detail(&mut self, repo_id: &str, tip: &str, base: &str, detail: CommittedDetail) {
        self.detail.insert(key(repo_id, tip, base), detail);
    }

    /// After a scan of `repo_id`: forgets that repo's entries whose tip no branch has any more.
    pub fn prune(&mut self, repo_id: &str, live_tips: &HashSet<String>) {
        let keep = |k: &Key| k.0 != repo_id || live_tips.contains(&k.1);
        self.committed.retain(|k, _| keep(k));
        self.merged.retain(|k, _| keep(k));
        self.detail.retain(|k, _| keep(k));
        if self.committed.len() + self.merged.len() + self.detail.len() > MAX_ENTRIES {
            self.committed.clear();
            self.merged.clear();
            self.detail.clear();
        }
    }

    /// Drops everything about a repo (removed from the config).
    pub fn forget_repo(&mut self, repo_id: &str) {
        self.prune(repo_id, &HashSet::new());
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
        c.put_merged("r_1", "old", "b", true);
        c.prune("r_1", &HashSet::from(["tip1".to_string()]));
        assert!(c.committed("r_1", "tip1", "b").is_some());
        assert!(c.committed("r_1", "old", "b").is_none());
        assert!(c.committed("r_2", "old", "b").is_some());
        assert_eq!(c.merged("r_1", "old", "b"), None);
    }
}
