//! The nearest default (T13.1): when the default base exists both locally and as a
//! remote-tracking branch (`master`, `origin/master`), a branch without a stored base uses
//! whichever shares the most history with it. See docs/SPEC.md §10 "Nearest default".

use std::sync::Mutex;

use crate::cache::Cache;
use crate::error::AppError;
use crate::git::history::{self, MbOrder};
use crate::git::refs::{self, DefaultBase};
use crate::git::Repo;
use crate::state::lock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Local,
    Remote,
}

/// What the rule found for one branch tip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NearestDefault {
    /// Commits the tip has on top of each candidate; `None`: no common ancestor.
    pub local_ahead: Option<u32>,
    pub remote_ahead: Option<u32>,
    /// `None`: neither shares history with the tip.
    pub pick: Option<Side>,
}

/// The rule, over what git found: each candidate's ahead count (`None`: unrelated), how their
/// merge-bases relate (used only when both are related), and which one the default order
/// resolved to (local when it exists).
pub fn pick_default(
    local: Option<u32>,
    remote: Option<u32>,
    order: MbOrder,
    configured: Side,
) -> Option<Side> {
    match (local, remote) {
        (None, None) => None,
        (Some(_), None) => Some(Side::Local),
        (None, Some(_)) => Some(Side::Remote),
        (Some(l), Some(r)) => Some(match order {
            MbOrder::Same => configured,
            MbOrder::RemoteNewer => Side::Remote,
            MbOrder::LocalNewer => Side::Local,
            MbOrder::Diverged if l < r => Side::Local,
            MbOrder::Diverged if r < l => Side::Remote,
            MbOrder::Diverged => configured,
        }),
    }
}

/// The rule for `tip` against both forms of `def`, cached by (repo, tip, local tip, remote tip).
/// `None` when the default has only one form.
pub fn nearest_default(
    cache: &Mutex<Cache>,
    repo: &Repo,
    repo_id: &str,
    def: &DefaultBase,
    tip: &str,
) -> Result<Option<NearestDefault>, AppError> {
    let Some(((_, local), (_, remote))) = def.pair() else {
        return Ok(None);
    };
    if let Some(hit) = lock(cache).nearest(repo_id, tip, local, remote) {
        return Ok(Some(hit));
    }
    let local_ahead = history::ahead_of(repo, tip, local)?;
    let remote_ahead = if local == remote {
        local_ahead
    } else {
        history::ahead_of(repo, tip, remote)?
    };
    let order = if local == remote || local_ahead.is_none() || remote_ahead.is_none() {
        MbOrder::Same
    } else {
        history::merge_base_order(repo, tip, local, remote)?
    };
    let configured = if def.local.as_ref().is_some_and(|(n, _)| *n == def.name) {
        Side::Local
    } else {
        Side::Remote
    };
    let found = NearestDefault {
        local_ahead,
        remote_ahead,
        pick: pick_default(local_ahead, remote_ahead, order, configured),
    };
    lock(cache).put_nearest(repo_id, tip, local, remote, found);
    Ok(Some(found))
}

/// The ref the rule picks for `tip`: the nearer form, or the configured default when the default
/// has one form, when both are equal, or when neither shares history (then the entry shows
/// "base missing").
pub fn default_ref(
    cache: &Mutex<Cache>,
    repo: &Repo,
    repo_id: &str,
    def: &DefaultBase,
    tip: Option<&str>,
) -> String {
    let (Some(tip), Some((local, remote))) = (tip, def.pair()) else {
        return def.name.clone();
    };
    match nearest_default(cache, repo, repo_id, def, tip) {
        Ok(Some(NearestDefault {
            pick: Some(side), ..
        })) => match side {
            Side::Local => local.0.clone(),
            Side::Remote => remote.0.clone(),
        },
        Ok(_) => def.name.clone(),
        Err(e) => {
            log::warn!("nearest default of {tip} failed: {e}");
            def.name.clone()
        }
    }
}

/// Tip of the default an entry at `tip` uses (the nearer form when there are two); the stacked
/// check asks whether a candidate is merged into it.
pub fn default_tip_for(
    cache: &Mutex<Cache>,
    repo: &Repo,
    repo_id: &str,
    order: &[String],
    tip: Option<&str>,
) -> Option<String> {
    let def = refs::default_base(repo, order)?;
    refs::resolve_commit(repo, &default_ref(cache, repo, repo_id, &def, tip))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;
    use MbOrder::*;
    use Side::*;

    fn order() -> Vec<String> {
        vec!["origin/HEAD".into(), "main".into()]
    }

    /// `main` with one commit, `origin/main` and `origin/HEAD` pointing at it.
    fn repo_with_origin() -> (TestRepo, git2::Oid) {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 5);
        t.set_origin_head("main");
        (t, base)
    }

    fn check(t: &TestRepo, tip: git2::Oid) -> (String, NearestDefault) {
        let cache = Mutex::new(Cache::default());
        let def = refs::default_base(&t.repo, &order()).unwrap();
        let tip = tip.to_string();
        let found = nearest_default(&cache, &t.repo, "r", &def, &tip)
            .unwrap()
            .unwrap();
        (default_ref(&cache, &t.repo, "r", &def, Some(&tip)), found)
    }

    #[test]
    fn local_behind_origin_uses_origin() {
        let (t, base) = repo_with_origin();
        // origin/main moved on; the branch starts from there.
        t.branch_from("upstream", base);
        let newer = t.commit_on("upstream", &[("b.txt", Some(b"b\n"))], "upstream work", 4);
        t.set_remote("origin/main", newer);
        t.branch_from("feat", newer);
        let tip = t.commit_on("feat", &[("c.txt", Some(b"c\n"))], "feature", 1);
        let (base, found) = check(&t, tip);
        assert_eq!(base, "origin/main");
        assert_eq!((found.local_ahead, found.remote_ahead), (Some(2), Some(1)));
    }

    #[test]
    fn local_ahead_with_unpushed_commits_uses_local() {
        let (t, _) = repo_with_origin();
        let unpushed = t.commit_on("main", &[("b.txt", Some(b"b\n"))], "unpushed", 4);
        t.branch_from("feat", unpushed);
        let tip = t.commit_on("feat", &[("c.txt", Some(b"c\n"))], "feature", 1);
        let (base, found) = check(&t, tip);
        assert_eq!(base, "main");
        assert_eq!((found.local_ahead, found.remote_ahead), (Some(1), Some(2)));
    }

    #[test]
    fn unrelated_origin_falls_back_to_local() {
        let (t, _) = repo_with_origin();
        let orphan = t.commit_on("orphan", &[("x.txt", Some(b"x\n"))], "rewritten", 3);
        t.set_remote("origin/main", orphan);
        t.branch_from(
            "feat",
            t.repo
                .find_branch("main", git2::BranchType::Local)
                .unwrap()
                .get()
                .target()
                .unwrap(),
        );
        let tip = t.commit_on("feat", &[("c.txt", Some(b"c\n"))], "feature", 1);
        let (base, found) = check(&t, tip);
        assert_eq!(base, "main");
        assert_eq!((found.local_ahead, found.remote_ahead), (Some(1), None));
    }

    #[test]
    fn one_form_only_keeps_the_resolved_default() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 5);
        let def = refs::default_base(&t.repo, &order()).unwrap();
        assert_eq!((def.name.as_str(), def.remote.is_none()), ("main", true));
        let cache = Mutex::new(Cache::default());
        assert_eq!(default_ref(&cache, &t.repo, "r", &def, None), "main");
    }

    #[test]
    fn one_candidate_related() {
        assert_eq!(pick_default(Some(4), None, Same, Local), Some(Local));
        assert_eq!(pick_default(None, Some(4), Same, Local), Some(Remote));
    }

    #[test]
    fn both_unrelated_is_none() {
        assert_eq!(pick_default(None, None, Same, Local), None);
    }

    #[test]
    fn equal_merge_bases_keep_the_configured_default() {
        assert_eq!(pick_default(Some(3), Some(3), Same, Local), Some(Local));
        assert_eq!(pick_default(Some(3), Some(3), Same, Remote), Some(Remote));
    }

    #[test]
    fn the_newer_merge_base_wins_whatever_the_counts() {
        assert_eq!(
            pick_default(Some(31), Some(4), RemoteNewer, Local),
            Some(Remote)
        );
        assert_eq!(
            pick_default(Some(2), Some(9), LocalNewer, Remote),
            Some(Local)
        );
        // Counts do not override ancestry.
        assert_eq!(
            pick_default(Some(2), Some(9), RemoteNewer, Local),
            Some(Remote)
        );
    }

    #[test]
    fn diverged_takes_fewer_commits_ahead_then_the_configured_default() {
        assert_eq!(
            pick_default(Some(3), Some(7), Diverged, Remote),
            Some(Local)
        );
        assert_eq!(
            pick_default(Some(7), Some(3), Diverged, Local),
            Some(Remote)
        );
        assert_eq!(pick_default(Some(5), Some(5), Diverged, Local), Some(Local));
        assert_eq!(
            pick_default(Some(5), Some(5), Diverged, Remote),
            Some(Remote)
        );
    }
}
