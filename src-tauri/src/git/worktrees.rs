//! Main and linked worktrees.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppError;
use crate::git::operation;
use crate::git::pool::RepoPool;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    /// Canonical folder.
    pub path: PathBuf,
    /// Linked worktree name (`.git/worktrees/<name>`); `None` for the main worktree.
    pub name: Option<String>,
    /// HEAD's commit (during a rebase, the commit it stopped at, not the branch's tip).
    pub head: String,
    /// `None`: detached HEAD, unless a rebase of a branch stopped there (that branch).
    pub branch: Option<String>,
}

/// The main worktree (unless bare) and every valid linked worktree whose HEAD points at a commit.
/// Prunable worktrees (folder gone) and unborn HEADs are skipped. Linked worktrees are opened
/// through the pool, so call this with only the main repository locked.
pub fn list_worktrees(pool: &RepoPool, repo: &Repository) -> Result<Vec<WorktreeInfo>, AppError> {
    let mut out = Vec::new();
    if let Some(workdir) = repo.workdir() {
        if let Some((head, branch)) = head_of(repo)? {
            out.push(WorktreeInfo {
                path: canonical(workdir),
                name: None,
                head,
                branch,
            });
        }
    }
    // `worktrees()` lists linked worktrees only.
    for name in repo.worktrees()?.iter().flatten().flatten() {
        let Ok(wt) = repo.find_worktree(name) else {
            continue;
        };
        if wt.validate().is_err() || !wt.path().exists() {
            continue;
        }
        let path = canonical(wt.path());
        let info = pool.get(&path).and_then(|shared| {
            let wt_repo = shared.lock().unwrap_or_else(|e| e.into_inner());
            head_of(&wt_repo)
        });
        match info {
            Ok(Some((head, branch))) => out.push(WorktreeInfo {
                path,
                name: Some(name.to_string()),
                head,
                branch,
            }),
            Ok(None) => {}
            Err(e) => log::warn!("skipping worktree {}: {e}", path.display()),
        }
    }
    Ok(out)
}

/// `(tip, branch name)` of HEAD; `None` while HEAD is unborn.
fn head_of(repo: &Repository) -> Result<Option<(String, Option<String>)>, AppError> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(None),
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let Some(tip) = head.target() else {
        return Ok(None);
    };
    let branch = if repo.head_detached()? {
        // A stopped rebase detaches HEAD; the worktree still belongs to the branch it rebases.
        operation::read(repo).and_then(|op| op.branch)
    } else {
        head.name()
            .ok()
            .and_then(|n| n.strip_prefix("refs/heads/"))
            .map(str::to_string)
    };
    Ok(Some((tip.to_string(), branch)))
}

/// Tip of HEAD; `None` while unborn.
pub fn head_sha(repo: &Repository) -> Result<Option<String>, AppError> {
    Ok(head_of(repo)?.map(|(tip, _)| tip))
}

/// Paths whose staged state differs from HEAD (both sides of a rename), and the worktree's index
/// file. Read only: the index is reread from disk, never written. A stash of picked files uses
/// them (SPEC §15): git keeps every staged change in a stash, picked or not.
pub fn staged(wt_repo: &Repository) -> Result<(Vec<String>, PathBuf), AppError> {
    let mut index = wt_repo.index()?;
    index.read(false)?;
    let head = match wt_repo.head() {
        Ok(h) => Some(h.peel_to_tree()?),
        Err(_) => None,
    };
    let diff = wt_repo.diff_tree_to_index(head.as_ref(), Some(&index), None)?;
    let mut paths = Vec::new();
    for d in diff.deltas() {
        for f in [d.old_file(), d.new_file()] {
            if let Some(p) = f.path().and_then(|p| p.to_str()) {
                if !paths.iter().any(|x| x == p) {
                    paths.push(p.to_string());
                }
            }
        }
    }
    Ok((paths, wt_repo.path().join("index")))
}

/// For each path (relative to the worktree): whether git knows it, in the index or in HEAD.
/// A discard puts these back with `git restore` and removes the others (untracked) with `git
/// clean`. Read only, as `staged`.
pub fn tracked(wt_repo: &Repository, paths: &[String]) -> Result<Vec<bool>, AppError> {
    let mut index = wt_repo.index()?;
    index.read(false)?;
    let head = match wt_repo.head() {
        Ok(h) => Some(h.peel_to_tree()?),
        Err(_) => None,
    };
    Ok(paths
        .iter()
        .map(|p| {
            index.get_path(Path::new(p), 0).is_some()
                // An unmerged path has only its conflict stages in the index.
                || (1..=3).any(|stage| index.get_path(Path::new(p), stage).is_some())
                || head
                    .as_ref()
                    .is_some_and(|t| t.get_path(Path::new(p)).is_ok())
        })
        .collect())
}

/// Canonical common git dir (`<repo>/.git` for a normal repository).
pub fn git_dir(repo: &Repository) -> PathBuf {
    canonical(repo.commondir())
}

/// Whether `rel` (relative to the worktree) is ignored, checking from the top-most ancestor
/// down: inside an ignored folder everything is ignored. `cache` holds earlier answers for the
/// same worktree (keyed by relative path).
pub fn is_ignored(wt_repo: &Repository, rel: &Path, cache: &mut HashMap<PathBuf, bool>) -> bool {
    let mut prefix = PathBuf::new();
    let components: Vec<_> = rel.components().collect();
    for (i, part) in components.iter().enumerate() {
        prefix.push(part);
        if let Some(&ignored) = cache.get(&prefix) {
            if ignored {
                return true;
            }
            continue;
        }
        let is_dir = i + 1 < components.len();
        // A trailing slash lets folder patterns such as `build/` match.
        let query = if is_dir {
            format!("{}/", prefix.to_string_lossy())
        } else {
            prefix.to_string_lossy().into_owned()
        };
        let ignored = wt_repo.is_path_ignored(&query).unwrap_or(false);
        cache.insert(prefix.clone(), ignored);
        if ignored {
            return true;
        }
    }
    false
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn staged_lists_only_what_the_index_changes() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a")), ("c", Some(b"c"))], "init", 1);
        t.checkout_main();
        t.write_file(t.path(), "a", b"unstaged");
        t.write_file(t.path(), "b", b"new");
        t.stage(t.path(), "b");
        t.write_file(t.path(), "c", b"staged");
        t.stage(t.path(), "c");
        let (paths, index) = staged(&t.repo).unwrap();
        let mut paths = paths;
        paths.sort();
        assert_eq!(paths, ["b", "c"]);
        assert!(index.ends_with("index") && index.exists());
    }

    #[test]
    fn tracked_knows_the_index_and_head() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 1);
        t.checkout_main();
        t.write_file(t.path(), "b", b"staged new");
        t.stage(t.path(), "b");
        t.write_file(t.path(), "u", b"untracked");
        std::fs::remove_file(t.path().join("a")).unwrap();
        let paths = ["a", "b", "u"].map(String::from);
        assert_eq!(tracked(&t.repo, &paths).unwrap(), [true, true, false]);
    }

    #[test]
    fn lists_main_linked_and_detached_worktrees() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a"))], "init", 2);
        t.checkout_main();
        t.branch_from("feature", base);
        let tip = t.commit_on("feature", &[("b", Some(b"b"))], "b", 1);
        let wt = t.add_worktree("feature", "feature");
        let detached = t.add_detached_worktree("old", base);
        t.branch_from("gone", base);
        let gone = t.add_worktree("gone", "gone");
        std::fs::remove_dir_all(&gone).unwrap();

        let pool = RepoPool::default();
        let list = list_worktrees(&pool, &t.repo).unwrap();
        assert_eq!(list.len(), 3, "{list:?}");
        assert_eq!(list[0].path, t.path());
        assert_eq!(list[0].name, None);
        assert_eq!(list[0].branch.as_deref(), Some("main"));

        let f = list.iter().find(|w| w.path == wt).unwrap();
        assert_eq!(f.name.as_deref(), Some("feature"));
        assert_eq!(
            (f.branch.as_deref(), f.head.as_str()),
            (Some("feature"), tip.to_string().as_str())
        );

        let d = list.iter().find(|w| w.path == detached).unwrap();
        assert_eq!(
            (d.branch.as_deref(), d.head.as_str()),
            (None, base.to_string().as_str())
        );

        assert_eq!(git_dir(&t.repo), t.path().join(".git"));
    }

    #[test]
    fn unborn_main_worktree_is_skipped() {
        let t = TestRepo::new();
        let pool = RepoPool::default();
        assert!(list_worktrees(&pool, &t.repo).unwrap().is_empty());
    }

    #[test]
    fn ignored_folders_cover_their_contents() {
        let t = TestRepo::new();
        t.write_file(t.path(), ".gitignore", b"build/\nnode_modules/\n*.log\n");
        let mut cache = HashMap::new();
        assert!(is_ignored(&t.repo, Path::new("build/a/b.txt"), &mut cache));
        assert!(is_ignored(
            &t.repo,
            Path::new("node_modules/x/index.js"),
            &mut cache
        ));
        assert!(is_ignored(&t.repo, Path::new("src/debug.log"), &mut cache));
        assert!(!is_ignored(&t.repo, Path::new("src/a.ts"), &mut cache));
        assert!(!is_ignored(&t.repo, Path::new("src/build.ts"), &mut cache));
        // The folder answer is reused.
        assert_eq!(cache.get(Path::new("build")), Some(&true));
    }
}
