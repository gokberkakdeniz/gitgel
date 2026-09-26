//! Local branches, default base, ref verification, tags.

use git2::{BranchType, Oid, Repository};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalBranch {
    pub name: String,
    pub tip: String,
    /// Committer time of the tip, unix seconds.
    pub last_commit_at: i64,
}

/// All local branches that point at a commit (symbolic refs are skipped).
pub fn local_branches(repo: &Repository) -> Result<Vec<LocalBranch>, AppError> {
    let mut out = Vec::new();
    for branch in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch?;
        let (Ok(Some(name)), Some(tip)) = (branch.name(), branch.get().target()) else {
            continue;
        };
        out.push(LocalBranch {
            name: name.to_string(),
            tip: tip.to_string(),
            last_commit_at: repo.find_commit(tip)?.time().seconds(),
        });
    }
    Ok(out)
}

/// Full SHA of the commit `rev` resolves to, or `None` if it does not resolve.
pub fn resolve_commit(repo: &Repository, rev: &str) -> Option<String> {
    repo.revparse_single(rev)
        .and_then(|o| o.peel_to_commit())
        .map(|c| c.id().to_string())
        .ok()
}

/// The remote branch `branch` is compared with to find unpushed commits: its configured
/// upstream (e.g. `origin/master`), or else `origin/<branch>` when that exists.
pub fn upstream_of(repo: &Repository, branch: &str) -> Option<String> {
    if let Ok(local) = repo.find_branch(branch, BranchType::Local) {
        if let Ok(upstream) = local.upstream() {
            if let Ok(Some(name)) = upstream.name() {
                return Some(name.to_string());
            }
        }
    }
    let fallback = format!("origin/{branch}");
    repo.find_reference(&format!("refs/remotes/{fallback}"))
        .is_ok()
        .then_some(fallback)
}

/// Tag names, sorted.
pub fn tags(repo: &Repository) -> Result<Vec<String>, AppError> {
    let mut tags: Vec<String> = repo
        .tag_names(None)?
        .iter()
        .flatten()
        .flatten()
        .map(str::to_string)
        .collect();
    tags.sort();
    Ok(tags)
}

pub fn commit_time(repo: &Repository, sha: &str) -> Result<i64, AppError> {
    Ok(repo.find_commit(Oid::from_str(sha)?)?.time().seconds())
}

/// Name of the local branch a base ref stands for: `main` for `main`, and for a remote ref such
/// as `origin/main` with no local branch of that name, `main`.
pub fn base_branch_name(repo: &Repository, base: &str) -> String {
    if repo.find_branch(base, BranchType::Local).is_ok() {
        return base.to_string();
    }
    match base.split_once('/') {
        Some((_, rest)) if repo.find_reference(&format!("refs/remotes/{base}")).is_ok() => {
            rest.to_string()
        }
        _ => base.to_string(),
    }
}

/// First item of `order` that exists in `repo`, as `(base name, matching order item)`.
///
/// `<remote>/HEAD` items follow the remote's symbolic HEAD (`origin/HEAD` -> `origin/main`) and
/// prefer the local branch of the same name (`main`) when there is one. Other items are local
/// branch names or any revision that resolves to a commit.
pub fn resolve_default_base(repo: &Repository, order: &[String]) -> Option<(String, String)> {
    order
        .iter()
        .find_map(|item| resolve_item(repo, item).map(|name| (name, item.clone())))
}

fn resolve_item(repo: &Repository, item: &str) -> Option<String> {
    if let Some(remote) = item.strip_suffix("/HEAD") {
        let head = repo
            .find_reference(&format!("refs/remotes/{remote}/HEAD"))
            .ok()?;
        let target = head.symbolic_target().ok()??;
        let short = target.strip_prefix("refs/remotes/")?;
        let branch = short.strip_prefix(remote)?.strip_prefix('/')?;
        return Some(if repo.find_branch(branch, BranchType::Local).is_ok() {
            branch.to_string()
        } else {
            short.to_string()
        });
    }
    let exists = repo.find_branch(item, BranchType::Local).is_ok()
        || repo
            .revparse_single(item)
            .and_then(|o| o.peel_to_commit())
            .is_ok();
    exists.then(|| item.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    fn order(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn lists_local_branches_with_tips_and_dates() {
        let t = TestRepo::new();
        let a = t.commit_on("main", &[("a", Some(b"a"))], "init", 3);
        t.branch_from("feat/x", a);
        let b = t.commit_on("feat/x", &[("b", Some(b"b"))], "b", 1);
        let mut branches = local_branches(&t.repo).unwrap();
        branches.sort_by(|x, y| x.name.cmp(&y.name));
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "feat/x");
        assert_eq!(branches[0].tip, b.to_string());
        assert!(branches[0].last_commit_at > branches[1].last_commit_at);
        assert_eq!(resolve_commit(&t.repo, "feat/x~1"), Some(a.to_string()));
        assert_eq!(resolve_commit(&t.repo, "nope"), None);
    }

    #[test]
    fn upstream_is_the_tracked_branch_or_origin_of_the_same_name() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        assert_eq!(upstream_of(&t.repo, "main"), None);
        t.set_origin_head("main");
        assert_eq!(upstream_of(&t.repo, "main").as_deref(), Some("origin/main"));
        t.branch_from("feature", tip);
        t.set_upstream("feature", "origin/main");
        assert_eq!(
            upstream_of(&t.repo, "feature").as_deref(),
            Some("origin/main")
        );
    }

    #[test]
    fn base_branch_name_strips_the_remote() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.set_origin_head("main");
        assert_eq!(base_branch_name(&t.repo, "main"), "main");
        assert_eq!(base_branch_name(&t.repo, "origin/main"), "main");
        assert_eq!(base_branch_name(&t.repo, "v1.0"), "v1.0");
    }

    #[test]
    fn origin_head_prefers_the_local_branch() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.set_origin_head("main");
        assert_eq!(
            resolve_default_base(&t.repo, &order(&["origin/HEAD", "main", "master"])),
            Some(("main".into(), "origin/HEAD".into()))
        );
    }

    #[test]
    fn origin_head_without_local_branch_uses_the_remote_ref() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.set_origin_head("main");
        let tip = t.repo.revparse_single("main").unwrap().id();
        t.branch_from("trunk", tip);
        t.point_head("trunk");
        t.delete_branch("main");
        assert_eq!(
            resolve_default_base(&t.repo, &order(&["origin/HEAD"])),
            Some(("origin/main".into(), "origin/HEAD".into()))
        );
    }

    #[test]
    fn falls_back_through_the_order() {
        let t = TestRepo::new();
        let oid = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("master", oid);
        // No origin: origin/HEAD is skipped.
        assert_eq!(
            resolve_default_base(&t.repo, &order(&["origin/HEAD", "master", "main"])),
            Some(("master".into(), "master".into()))
        );
        assert_eq!(
            resolve_default_base(&t.repo, &order(&["trunk", "develop"])),
            None
        );
        // Any revision that resolves to a commit counts.
        assert_eq!(
            resolve_default_base(&t.repo, &order(&["nope", "main~0"])),
            Some(("main~0".into(), "main~0".into()))
        );
    }
}
