//! Local branches, default base, ref verification, tags.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

use git2::{BranchType, Direction, Oid, Remote, Repository};

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
    if let Some(name) = tracking(repo, branch)
        .filter(|t| t.own_ref.is_some())
        .and_then(|t| t.tracking)
    {
        return Some(name);
    }
    origin_fallback(repo, branch)
}

/// The remote-tracking ref Gitgel keeps for an upstream set to a URL instead of a remote's name
/// (`gh pr checkout` of a fork's branch writes one), which git gives none: `refs/remotes/<owner>/
/// <branch>`, the owner read from the URL (`git@github.com:owner/repo.git`). `None` when
/// `remote` is not a URL or a remote has the owner's name.
fn own_ref(repo: &Repository, remote: &str, branch: &str) -> Option<(String, String)> {
    if !remote.contains([':', '/']) || repo.find_remote(remote).is_ok() {
        return None;
    }
    let mut parts = remote.rsplit(['/', ':']).filter(|p| !p.is_empty());
    let last = parts.next()?;
    let owner = parts
        .next()
        .unwrap_or_else(|| last.trim_end_matches(".git"));
    let refname = format!("refs/remotes/{owner}/{branch}");
    (git2::Reference::is_valid_name(&refname) && repo.find_remote(owner).is_err())
        .then(|| (owner.to_string(), refname))
}

/// The local branches whose upstream is a URL, with the ref Gitgel keeps for each ([`own_ref`]):
/// `git fetch --all` does not reach them.
pub fn url_tracked(repo: &Repository) -> Vec<Tracking> {
    let mut out = Vec::new();
    let Ok(cfg) = repo.config().and_then(|mut c| c.snapshot()) else {
        return out;
    };
    let Ok(mut entries) = cfg.entries(Some(r"^branch\..*\.remote$")) else {
        return out;
    };
    while let Some(Ok(entry)) = entries.next() {
        let (Ok(name), Ok(value)) = (entry.name(), entry.value()) else {
            continue;
        };
        let Some(branch) = name
            .strip_prefix("branch.")
            .and_then(|n| n.strip_suffix(".remote"))
        else {
            continue;
        };
        if !value.contains([':', '/']) || repo.find_branch(branch, BranchType::Local).is_err() {
            continue;
        }
        out.extend(tracking(repo, branch).filter(|t| t.own_ref.is_some()));
    }
    out
}

fn origin_fallback(repo: &Repository, branch: &str) -> Option<String> {
    let fallback = format!("origin/{branch}");
    repo.find_reference(&format!("refs/remotes/{fallback}"))
        .is_ok()
        .then_some(fallback)
}

/// [`upstream_of`] for many branches at once, as `branch -> upstream`. The configuration is read
/// once and each remote looked up once: libgit2 does both on every `upstream()` call, which
/// takes seconds over a repository's thousand-odd branches.
pub fn upstreams<'a>(
    repo: &Repository,
    branches: impl IntoIterator<Item = &'a String>,
) -> HashMap<String, String> {
    let mut remote: HashMap<String, String> = HashMap::new();
    let mut merge: HashMap<String, String> = HashMap::new();
    if let Ok(cfg) = repo.config().and_then(|mut c| c.snapshot()) {
        if let Ok(mut entries) = cfg.entries(Some(r"^branch\..*\.(remote|merge)$")) {
            while let Some(Ok(entry)) = entries.next() {
                let (Ok(name), Ok(value)) = (entry.name(), entry.value()) else {
                    continue;
                };
                let Some(rest) = name.strip_prefix("branch.") else {
                    continue;
                };
                if let Some(b) = rest.strip_suffix(".remote") {
                    remote.insert(b.to_string(), value.to_string());
                } else if let Some(b) = rest.strip_suffix(".merge") {
                    merge.insert(b.to_string(), value.to_string());
                }
            }
        }
    }
    let mut found: HashMap<String, Option<Remote>> = HashMap::new();
    let mut out = HashMap::new();
    for branch in branches {
        let configured = remote
            .get(branch)
            .zip(merge.get(branch))
            .and_then(|(r, m)| {
                let refname = if r == "." {
                    m.clone()
                } else {
                    let rem = found
                        .entry(r.clone())
                        .or_insert_with(|| repo.find_remote(r).ok())
                        .as_ref();
                    match rem {
                        Some(rem) => {
                            let spec = rem
                                .refspecs()
                                .find(|s| s.direction() == Direction::Fetch && s.src_matches(m))?;
                            spec.transform(m).ok()?.as_str().ok()?.to_string()
                        }
                        None => own_ref(repo, r, m.strip_prefix("refs/heads/")?)?.1,
                    }
                };
                repo.find_reference(&refname).ok()?;
                refname
                    .strip_prefix("refs/remotes/")
                    .or_else(|| refname.strip_prefix("refs/heads/"))
                    .map(str::to_string)
            });
        if let Some(up) = configured.or_else(|| origin_fallback(repo, branch)) {
            out.insert(branch.clone(), up);
        }
    }
    out
}

/// Where a local branch is pushed to and pulled from (W4a).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tracking {
    /// The remote as git takes it: its name (`origin`), or the URL the upstream is set to.
    pub remote: String,
    /// The remote's name as shown: `remote`, or a URL's owner.
    pub name: String,
    /// The branch's name on the remote.
    pub branch: String,
    /// The remote-tracking branch (`origin/feat/x`); `None` when the remote does not have the
    /// branch (as of the last fetch).
    pub tracking: Option<String>,
    /// The upstream is set in the branch's config (`branch.<name>.remote` / `.merge`).
    pub configured: bool,
    /// The remote-tracking ref Gitgel updates itself, for a URL ([`own_ref`]).
    pub own_ref: Option<String>,
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
        if let Some((name, own)) = own_ref(repo, &remote, &merge) {
            let tracking = repo
                .find_reference(&own)
                .is_ok()
                .then(|| format!("{name}/{merge}"));
            return Some(Tracking {
                remote,
                name,
                branch: merge,
                tracking,
                configured: true,
                own_ref: Some(own),
            });
        }
        let tracking = repo
            .find_branch(branch, BranchType::Local)
            .ok()
            .and_then(|b| b.upstream().ok())
            .and_then(|up| up.name().ok().flatten().map(str::to_string));
        return Some(Tracking {
            name: remote.clone(),
            remote,
            branch: merge,
            tracking,
            configured: true,
            own_ref: None,
        });
    }
    let remote = default_remote(repo)?;
    let name = format!("{remote}/{branch}");
    let tracking = repo
        .find_reference(&format!("refs/remotes/{name}"))
        .is_ok()
        .then_some(name);
    Some(Tracking {
        name: remote.clone(),
        remote,
        branch: branch.to_string(),
        tracking,
        configured: false,
        own_ref: None,
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

/// Tag names by the commit they point to (annotated tags peeled), each list newest first by
/// when the tag was made: an annotated tag's own date, a lightweight one's ref file's (a packed
/// lightweight tag has none; those come last, by name). Tags on anything other than a commit are
/// left out.
pub fn tags_by_commit(repo: &Repository) -> Result<HashMap<Oid, Vec<String>>, AppError> {
    let mut out: HashMap<Oid, Vec<(Option<i64>, String)>> = HashMap::new();
    for r in repo.references_glob("refs/tags/*")? {
        let r = r?;
        let (Ok(name), Ok(commit)) = (r.shorthand(), r.peel_to_commit()) else {
            continue;
        };
        out.entry(commit.id())
            .or_default()
            .push((tag_made_at(repo, &r), name.to_string()));
    }
    Ok(out
        .into_iter()
        .map(|(oid, mut tags)| {
            tags.sort_by(|a, b| match (a.0, b.0) {
                (Some(x), Some(y)) => y.cmp(&x).then_with(|| a.1.cmp(&b.1)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.1.cmp(&b.1),
            });
            (oid, tags.into_iter().map(|(_, name)| name).collect())
        })
        .collect())
}

/// When a tag was made, in milliseconds: the tagger's date of an annotated tag, else the
/// modification time of its loose ref file (git keeps no date for a lightweight tag).
fn tag_made_at(repo: &Repository, r: &git2::Reference) -> Option<i64> {
    if let Ok(tag) = r.peel_to_tag() {
        if let Some(tagger) = tag.tagger() {
            return Some(tagger.when().seconds() * 1000);
        }
    }
    let file = repo.commondir().join(r.name().ok()?);
    let made = std::fs::metadata(file).ok()?.modified().ok()?;
    let since = made.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}

/// A fingerprint of every tag's name and target: it changes when a tag is added, moved or
/// deleted.
pub fn tags_fingerprint(repo: &Repository) -> Result<u64, AppError> {
    let mut tags: Vec<(String, Option<Oid>)> = Vec::new();
    for r in repo.references_glob("refs/tags/*")? {
        let r = r?;
        tags.push((
            String::from_utf8_lossy(r.name_bytes()).into_owned(),
            r.target(),
        ));
    }
    tags.sort();
    let mut hasher = DefaultHasher::new();
    tags.hash(&mut hasher);
    Ok(hasher.finish())
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
    fn upstreams_match_upstream_of() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.set_origin_head("main");
        for b in ["feature", "local", "plain"] {
            t.branch_from(b, tip);
        }
        t.set_upstream("feature", "origin/main");
        t.set_upstream("local", "main");
        let names: Vec<String> = local_branches(&t.repo)
            .unwrap()
            .into_iter()
            .map(|b| b.name)
            .collect();
        let all = upstreams(&t.repo, &names);
        assert_eq!(all.get("feature").map(String::as_str), Some("origin/main"));
        assert_eq!(all.get("local").map(String::as_str), Some("main"));
        for b in &names {
            assert_eq!(all.get(b).cloned(), upstream_of(&t.repo, b), "{b}");
        }
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
                name: "origin".into(),
                branch: "feature".into(),
                tracking: None,
                configured: false,
                own_ref: None,
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
                name: "origin".into(),
                branch: "other".into(),
                tracking: Some("origin/other".into()),
                configured: true,
                own_ref: None,
            })
        );
    }

    #[test]
    fn an_upstream_set_to_a_url_tracks_a_ref_named_after_its_owner() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("feat/x", tip);
        t.add_origin();
        let url = "git@github.com:someone/repo.git";
        t.set_upstream_url("feat/x", url);
        let expect = |tracking: Option<&str>| {
            Some(Tracking {
                remote: url.into(),
                name: "someone".into(),
                branch: "feat/x".into(),
                tracking: tracking.map(str::to_string),
                configured: true,
                own_ref: Some("refs/remotes/someone/feat/x".into()),
            })
        };
        // Not fetched or pushed from Gitgel yet.
        assert_eq!(tracking(&t.repo, "feat/x"), expect(None));
        assert_eq!(upstream_of(&t.repo, "feat/x"), None);
        t.set_remote("someone/feat/x", tip);
        assert_eq!(tracking(&t.repo, "feat/x"), expect(Some("someone/feat/x")));
        assert_eq!(
            upstream_of(&t.repo, "feat/x").as_deref(),
            Some("someone/feat/x")
        );
        let name = "feat/x".to_string();
        assert_eq!(
            upstreams(&t.repo, [&name])
                .get("feat/x")
                .map(String::as_str),
            Some("someone/feat/x")
        );
        assert_eq!(
            url_tracked(&t.repo),
            vec![expect(Some("someone/feat/x")).unwrap()]
        );
        // A remote of the owner's name keeps its refs to itself.
        t.add_remote("someone");
        assert_eq!(tracking(&t.repo, "feat/x").and_then(|t| t.own_ref), None);
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

    #[test]
    fn tags_by_commit_lists_the_newest_tag_first() {
        let t = TestRepo::new();
        let a = t.commit_on("main", &[("a", Some(b"a"))], "a", 1);
        let file = |name: &str| t.repo.commondir().join("refs/tags").join(name);
        let at = |name: &str, secs: u64| {
            let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
            std::fs::File::options()
                .write(true)
                .open(file(name))
                .unwrap()
                .set_modified(when)
                .unwrap();
        };
        t.tag("b", a);
        t.tag("a", a);
        t.tag("c", a);
        at("b", 100);
        at("a", 200);
        at("c", 300);
        assert_eq!(tags_by_commit(&t.repo).unwrap()[&a], ["c", "a", "b"]);
        // An annotated tag goes by its own date (now), whatever its file says.
        t.tag_annotated("z", a);
        at("z", 1);
        assert_eq!(tags_by_commit(&t.repo).unwrap()[&a], ["z", "c", "a", "b"]);
    }

    #[test]
    fn tags_fingerprint_changes_when_a_tag_is_added_or_moved() {
        let t = TestRepo::new();
        let a = t.commit_on("main", &[("a", Some(b"a"))], "a", 2);
        let b = t.commit_on("main", &[("b", Some(b"b"))], "b", 1);
        let fp = || tags_fingerprint(&t.repo).unwrap();
        let none = fp();
        t.tag("v1", a);
        let added = fp();
        assert_ne!(added, none);
        assert_eq!(fp(), added);
        t.tag("v1", b);
        assert_ne!(fp(), added);
        assert_ne!(fp(), none);
    }
}
