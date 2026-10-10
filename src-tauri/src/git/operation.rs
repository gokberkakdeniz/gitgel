//! An operation git left half done in a worktree (SPEC §15 "Operations in progress"): a rebase,
//! merge, cherry-pick or revert that stopped, usually on conflicts. Read from the worktree's git
//! dir, so it does not matter whether Gitgel, a terminal or an editor started it.

use std::path::Path;

use git2::{Repository, RepositoryState};

use crate::model::OperationKind;

/// What `.git` says about the operation in progress.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InProgress {
    pub kind: OperationKind,
    /// Rebase: the branch being rebased (`head-name`); `None` for a detached HEAD.
    pub branch: Option<String>,
    /// Rebase: the commit it rebases on.
    pub onto: Option<String>,
    /// Merge: what is merged in, from `MERGE_MSG` (`origin/feat`), else `MERGE_HEAD`'s short SHA.
    /// Cherry-pick, revert: the commit's short SHA.
    pub other: Option<String>,
    /// Rebase: the commit it stopped at (1-based) and how many there are.
    pub step: Option<u32>,
    pub total: Option<u32>,
}

/// The operation in progress in a worktree (`wt_repo` opened at the worktree), if any.
pub fn read(wt_repo: &Repository) -> Option<InProgress> {
    let dir = wt_repo.path();
    let kind = match wt_repo.state() {
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge
        | RepositoryState::ApplyMailboxOrRebase => OperationKind::Rebase,
        RepositoryState::Merge => OperationKind::Merge,
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => {
            OperationKind::CherryPick
        }
        RepositoryState::Revert | RepositoryState::RevertSequence => OperationKind::Revert,
        _ => return None,
    };
    let mut op = InProgress {
        kind,
        branch: None,
        onto: None,
        other: None,
        step: None,
        total: None,
    };
    match kind {
        OperationKind::Rebase => {
            // `rebase-merge` (the default and -i), `rebase-apply` (the old apply backend).
            let (sub, step, total) = if dir.join("rebase-merge").is_dir() {
                ("rebase-merge", "msgnum", "end")
            } else {
                ("rebase-apply", "next", "last")
            };
            let file = |name: &str| text(&dir.join(sub).join(name));
            op.branch =
                file("head-name").and_then(|h| h.strip_prefix("refs/heads/").map(str::to_string));
            op.onto = file("onto");
            op.step = file(step).and_then(|s| s.parse().ok());
            op.total = file(total).and_then(|s| s.parse().ok());
        }
        OperationKind::Merge => {
            op.other = text(&dir.join("MERGE_MSG"))
                .as_deref()
                .and_then(merged_name)
                .or_else(|| text(&dir.join("MERGE_HEAD")).map(|s| short(&s)));
        }
        OperationKind::CherryPick => {
            op.other = text(&dir.join("CHERRY_PICK_HEAD")).map(|s| short(&s))
        }
        OperationKind::Revert => op.other = text(&dir.join("REVERT_HEAD")).map(|s| short(&s)),
    }
    Some(op)
}

/// The quoted name in a merge message's first line: `Merge branch 'feat' of github.com:o/r` →
/// `feat`, `Merge remote-tracking branch 'origin/feat'` → `origin/feat`.
fn merged_name(msg: &str) -> Option<String> {
    let line = msg.lines().next()?;
    let (_, rest) = line.split_once('\'')?;
    let (name, _) = rest.split_once('\'')?;
    (!name.is_empty()).then(|| name.to_string())
}

/// A branch or remote-tracking branch whose tip is `sha`, `prefer`red names first; else the short
/// SHA. Names `onto` for the banner: "Rebasing feat on main".
pub fn name_of(repo: &Repository, sha: &str, prefer: &[&str]) -> String {
    let at = |name: &str| {
        repo.revparse_single(name)
            .ok()
            .and_then(|o| o.peel_to_commit().ok())
            .is_some_and(|c| c.id().to_string() == sha)
    };
    if let Some(p) = prefer.iter().find(|p| at(p)) {
        return (*p).to_string();
    }
    let found = repo.references().ok().and_then(|refs| {
        refs.flatten()
            .filter(|r| r.is_branch() || r.is_remote())
            .filter(|r| r.target().is_some_and(|t| t.to_string() == sha))
            .filter_map(|r| r.shorthand().ok().map(str::to_string))
            .filter(|n| !n.ends_with("/HEAD"))
            .min_by_key(|n| (n.len(), n.clone()))
    });
    found.unwrap_or_else(|| short(sha))
}

/// Paths of `paths` (relative to `worktree`) whose file still has a line git's conflict markers
/// start (`<<<<<<< `, `>>>>>>> `). A file that is gone or unreadable counts as resolved.
pub fn with_markers(worktree: &Path, paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| {
            std::fs::read(worktree.join(p)).is_ok_and(|bytes| {
                bytes.split(|&b| b == b'\n').any(|line| {
                    line.starts_with(b"<<<<<<< ")
                        || line.starts_with(b">>>>>>> ")
                        || line == b"<<<<<<<"
                        || line == b">>>>>>>"
                })
            })
        })
        .cloned()
        .collect()
}

/// Paths with conflicts (unmerged in the index) in a worktree. Read only.
pub fn unmerged(wt_repo: &Repository) -> Result<Vec<String>, git2::Error> {
    let mut index = wt_repo.index()?;
    index.read(false)?;
    let mut out = Vec::new();
    for c in index.conflicts()? {
        let c = c?;
        let entry = c.our.or(c.their).or(c.ancestor);
        if let Some(path) = entry.and_then(|e| String::from_utf8(e.path).ok()) {
            if !out.contains(&path) {
                out.push(path);
            }
        }
    }
    Ok(out)
}

fn text(path: &Path) -> Option<String> {
    let s = std::fs::read_to_string(path).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn reads_a_stopped_rebase_in_a_worktree() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a\n"))], "init", 3);
        t.branch_from("feat", base);
        t.commit_on("feat", &[("a", Some(b"feat\n"))], "feat", 2);
        let main = t.commit_on("main", &[("a", Some(b"main\n"))], "main", 1);
        let wt = t.add_worktree("feat", "feat");
        t.fake_rebase(&wt, Some("feat"), main, 2, 4);
        let wt_repo = Repository::open(&wt).unwrap();
        let op = read(&wt_repo).unwrap();
        assert_eq!(op.kind, OperationKind::Rebase);
        assert_eq!(op.branch.as_deref(), Some("feat"));
        assert_eq!(op.onto, Some(main.to_string()));
        assert_eq!((op.step, op.total), (Some(2), Some(4)));
        assert_eq!(name_of(&t.repo, &main.to_string(), &[]), "main");
        assert_eq!(
            name_of(&t.repo, &base.to_string(), &[]),
            short(&base.to_string())
        );
        // Nothing in progress in the main worktree.
        assert_eq!(read(&t.repo), None);
    }

    #[test]
    fn reads_a_merge_and_its_name() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a\n"))], "init", 1);
        t.checkout_main();
        let git = t.repo.path().to_path_buf();
        std::fs::write(git.join("MERGE_HEAD"), format!("{tip}\n")).unwrap();
        std::fs::write(
            git.join("MERGE_MSG"),
            "Merge branch 'feat' of github.com:o/r\n\n# Conflicts:\n",
        )
        .unwrap();
        let op = read(&t.repo).unwrap();
        assert_eq!(op.kind, OperationKind::Merge);
        assert_eq!(op.other.as_deref(), Some("feat"));
        assert_eq!(op.branch, None);
    }

    #[test]
    fn merged_names() {
        assert_eq!(
            merged_name("Merge remote-tracking branch 'origin/x'").as_deref(),
            Some("origin/x")
        );
        assert_eq!(
            merged_name("Merge commit 'abc1234'").as_deref(),
            Some("abc1234")
        );
        assert_eq!(merged_name("Merge stuff"), None);
    }

    #[test]
    fn finds_files_that_keep_their_markers() {
        let t = TestRepo::new();
        t.write_file(
            t.path(),
            "a",
            b"x\n<<<<<<< HEAD\ny\n=======\nz\n>>>>>>> 1234 (m)\n",
        );
        t.write_file(t.path(), "b", b"resolved\n");
        let paths = vec!["a".to_string(), "b".to_string(), "gone".to_string()];
        assert_eq!(with_markers(t.path(), &paths), ["a"]);
    }
}
