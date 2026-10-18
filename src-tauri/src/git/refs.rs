//! Local branches, default base, ref verification, tags.

use std::collections::HashMap;

use git2::{BranchType, Oid, Repository};

use crate::error::AppError;
use crate::model::BranchLoss;

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

/// Where a local branch is pushed to and pulled from (W4a).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tracking {
    /// The remote, e.g. `origin`.
    pub remote: String,
    /// The branch's name on the remote.
    pub branch: String,
    /// The remote-tracking branch (`origin/feat/x`); `None` when the remote does not have the
    /// branch (as of the last fetch).
    pub tracking: Option<String>,
    /// The upstream is set in the branch's config (`branch.<name>.remote` / `.merge`).
    pub configured: bool,
}

/// The configured upstream of `branch` when it is on a remote; otherwise the same name on the
/// default remote (`origin`, else the only remote). `None` without a remote.
pub fn tracking(repo: &Repository, branch: &str) -> Option<Tracking> {
    let refname = format!("refs/heads/{branch}");
    let configured = repo
        .branch_upstream_remote(&refname)
        .ok()
        .and_then(|r| r.as_str().ok().map(str::to_string))
        .filter(|r| r != ".")
        .zip(
            repo.branch_upstream_merge(&refname)
                .ok()
                .and_then(|m| m.as_str().ok().map(str::to_string))
                .and_then(|m| m.strip_prefix("refs/heads/").map(str::to_string)),
        );
    if let Some((remote, merge)) = configured {
        let tracking = repo
            .find_branch(branch, BranchType::Local)
            .ok()
            .and_then(|b| b.upstream().ok())
            .and_then(|up| up.name().ok().flatten().map(str::to_string));
        return Some(Tracking {
            remote,
            branch: merge,
            tracking,
            configured: true,
        });
    }
    let remote = default_remote(repo)?;
    let name = format!("{remote}/{branch}");
    let tracking = repo
        .find_reference(&format!("refs/remotes/{name}"))
        .is_ok()
        .then_some(name);
    Some(Tracking {
        remote,
        branch: branch.to_string(),
        tracking,
        configured: false,
    })
}

/// `origin` when it is configured, else the only remote.
fn default_remote(repo: &Repository) -> Option<String> {
    if repo.find_remote("origin").is_ok() {
        return Some("origin".into());
    }
    let remotes = repo.remotes().ok()?;
    let names: Vec<String> = remotes
        .iter()
        .flatten()
        .flatten()
        .map(str::to_string)
        .collect();
    match names.as_slice() {
        [only] => Some(only.clone()),
        _ => None,
    }
}

/// The commits of `branch` that no other ref has (SPEC §15 "Delete branch"): every local branch,
/// tag and remote-tracking branch is hidden from its tip except itself and, for `lost_with_remote`,
/// its remote-tracking branch. The stash does not count: its commits sit on top of a branch.
pub fn branch_loss(repo: &Repository, branch: &str) -> Result<BranchLoss, AppError> {
    let own = format!("refs/heads/{branch}");
    let tip = repo.refname_to_id(&own)?;
    let remote = tracking(repo, branch)
        .and_then(|t| t.tracking)
        .map(|name| format!("refs/remotes/{name}"));
    let count = |keep_remote: bool| -> Result<u32, AppError> {
        let mut walk = repo.revwalk()?;
        walk.push(tip)?;
        for r in repo.references()?.flatten() {
            let Ok(name) = r.name() else { continue };
            if name == own
                || name == "refs/stash"
                || (!keep_remote && Some(name) == remote.as_deref())
            {
                continue;
            }
            if let Ok(commit) = r.peel_to_commit() {
                walk.hide(commit.id())?;
            }
        }
        Ok(walk.flatten().count() as u32)
    };
    Ok(BranchLoss {
        lost: count(true)?,
        lost_with_remote: if remote.is_some() {
            count(false)?
        } else {
            count(true)?
        },
    })
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

/// Tag names by the commit they point to (annotated tags peeled), each list sorted. Tags on
/// anything other than a commit are left out.
pub fn tags_by_commit(repo: &Repository) -> Result<HashMap<Oid, Vec<String>>, AppError> {
    let mut out: HashMap<Oid, Vec<String>> = HashMap::new();
    for r in repo.references_glob("refs/tags/*")? {
        let r = r?;
        let (Ok(name), Ok(commit)) = (r.shorthand(), r.peel_to_commit()) else {
            continue;
        };
        out.entry(commit.id()).or_default().push(name.to_string());
    }
    for names in out.values_mut() {
        names.sort();
    }
    Ok(out)
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

/// A ref's name and the commit it points at.
pub type NamedTip = (String, String);

/// The repo's default base (T13.1): what the order resolved to, and, when that name exists both
/// locally and as a remote-tracking branch, both forms with their tips.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultBase {
    /// The ref the order resolved to (local when it exists), e.g. `master`.
    pub name: String,
    /// The matching order item, e.g. `origin/HEAD`.
    pub source: String,
    /// `(name, tip)` of local `N`.
    pub local: Option<NamedTip>,
    /// `(name, tip)` of its remote-tracking twin, e.g. `origin/master`.
    pub remote: Option<NamedTip>,
}

impl DefaultBase {
    /// Both forms exist: the nearest-default rule decides between them.
    pub fn pair(&self) -> Option<(&NamedTip, &NamedTip)> {
        Some((self.local.as_ref()?, self.remote.as_ref()?))
    }
}

/// The default base with its local and remote forms. The remote twin is local `N`'s configured
/// upstream, else `<remote>/N` for a `<remote>/HEAD` order item, else `origin/N`.
pub fn default_base(repo: &Repository, order: &[String]) -> Option<DefaultBase> {
    let (name, source) = resolve_default_base(repo, order)?;
    let n = base_branch_name(repo, &name);
    let tip = |r: &str| resolve_commit(repo, r).map(|t| (r.to_string(), t));
    let local = repo
        .find_branch(&n, BranchType::Local)
        .ok()
        .and_then(|b| Some((n.clone(), b.get().target()?.to_string())));
    let upstream = repo
        .find_branch(&n, BranchType::Local)
        .ok()
        .and_then(|b| b.upstream().ok())
        .and_then(|u| u.name().ok().flatten().map(str::to_string));
    let remote_ref = |r: &str| {
        repo.find_reference(&format!("refs/remotes/{r}"))
            .is_ok()
            .then(|| r.to_string())
    };
    let remote = upstream
        .or_else(|| {
            source
                .strip_suffix("/HEAD")
                .and_then(|remote| remote_ref(&format!("{remote}/{n}")))
        })
        .or_else(|| remote_ref(&format!("origin/{n}")))
        .and_then(|r| tip(&r));
    Some(DefaultBase {
        name,
        source,
        local,
        remote,
    })
}

/// When the repository was last fetched: the modification time of `FETCH_HEAD` in the common
/// git dir, unix seconds. `None` if it was never fetched.
pub fn fetched_at(repo: &Repository) -> Option<i64> {
    let modified = std::fs::metadata(repo.commondir().join("FETCH_HEAD"))
        .and_then(|m| m.modified())
        .ok()?;
    let secs = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    i64::try_from(secs).ok()
}

/// Remote-tracking branches (`origin/x`) with their tips, without `*/HEAD`, in ref order.
pub fn remote_branch_tips(repo: &Repository) -> Result<Vec<LocalBranch>, AppError> {
    let mut out = Vec::new();
    for branch in repo.branches(Some(BranchType::Remote))? {
        let (branch, _) = branch?;
        let (Ok(Some(name)), Some(tip)) = (branch.name(), branch.get().target()) else {
            continue;
        };
        if name.ends_with("/HEAD") {
            continue;
        }
        out.push(LocalBranch {
            name: name.to_string(),
            tip: tip.to_string(),
            last_commit_at: repo.find_commit(tip)?.time().seconds(),
        });
    }
    Ok(out)
}

/// Remote-tracking branch names (`origin/x`), without `*/HEAD`, sorted.
pub fn remote_branches(repo: &Repository) -> Result<Vec<String>, AppError> {
    let mut out = Vec::new();
    for branch in repo.branches(Some(BranchType::Remote))? {
        let (branch, _) = branch?;
        if branch.get().target().is_none() {
            continue;
        }
        if let Ok(Some(name)) = branch.name() {
            if !name.ends_with("/HEAD") {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
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
    fn branch_loss_counts_commits_on_no_other_ref() {
        let t = TestRepo::new();
        let a = t.commit_on("main", &[("a", Some(b"a"))], "init", 4);
        t.branch_from("feat", a);
        let b = t.commit_on("feat", &[("b", Some(b"b"))], "b", 3);
        t.commit_on("feat", &[("c", Some(b"c"))], "c", 2);
        // Nothing pushed: both commits go.
        let lost = |l, r| BranchLoss {
            lost: l,
            lost_with_remote: r,
        };
        assert_eq!(branch_loss(&t.repo, "feat").unwrap(), lost(2, 2));
        // One pushed: only the other goes, unless the remote branch goes too.
        t.set_remote("origin/feat", b);
        t.set_upstream("feat", "origin/feat");
        assert_eq!(branch_loss(&t.repo, "feat").unwrap(), lost(1, 2));
        // Merged into main: nothing goes.
        t.set_branch("main", t.repo.refname_to_id("refs/heads/feat").unwrap());
        assert_eq!(branch_loss(&t.repo, "feat").unwrap(), lost(0, 0));
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
    fn tracking_is_the_configured_upstream_or_the_same_name_on_origin() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("feature", tip);
        // No remote: nowhere to push.
        assert_eq!(tracking(&t.repo, "feature"), None);
        t.add_origin();
        assert_eq!(
            tracking(&t.repo, "feature"),
            Some(Tracking {
                remote: "origin".into(),
                branch: "feature".into(),
                tracking: None,
                configured: false,
            })
        );
        t.set_remote("origin/feature", tip);
        assert_eq!(
            tracking(&t.repo, "feature").and_then(|t| t.tracking),
            Some("origin/feature".into())
        );
        t.set_remote("origin/other", tip);
        t.set_upstream("feature", "origin/other");
        assert_eq!(
            tracking(&t.repo, "feature"),
            Some(Tracking {
                remote: "origin".into(),
                branch: "other".into(),
                tracking: Some("origin/other".into()),
                configured: true,
            })
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
