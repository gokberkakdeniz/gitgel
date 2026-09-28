//! Base ref options and per-branch base selection.

use std::path::Path;

use crate::config;
use crate::error::AppError;
use crate::git::{history, refs};
use crate::model::{
    BaseCandidate, BaseOptions, Config, DefaultCandidates, RepoConfig, UpdateReason,
};
use crate::nearest::{self, Side};
use crate::scan;
use crate::state::{lock, AppState};

/// An entry key split into `(repo id, branch, detached worktree path)`.
fn parse_key(key: &str) -> Result<(&str, Option<&str>, Option<&str>), AppError> {
    let (repo_id, rest) = key
        .split_once(':')
        .ok_or_else(|| AppError::NotFound(format!("entry {key}")))?;
    Ok(match rest.strip_prefix('@') {
        Some(path) => (repo_id, None, Some(path)),
        None => (repo_id, Some(rest), None),
    })
}

fn repo_of<'a>(config: &'a Config, repo_id: &str) -> Result<&'a RepoConfig, AppError> {
    config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))
}

/// Everything the base menu lists for one entry.
pub fn base_options(state: &AppState, repo_id: &str, key: &str) -> Result<BaseOptions, AppError> {
    let started = std::time::Instant::now();
    let config = config::snapshot(state);
    let (_, branch, worktree) = parse_key(key)?;
    let repo_cfg = repo_of(&config, repo_id)?;
    let entry = scan::summarize_one(
        &state.pool,
        &state.cache,
        repo_cfg,
        &config,
        branch,
        worktree,
        None,
    );

    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let order = &config.settings.default_base_order;
    let tip = entry.head_sha.as_deref();
    let default_tip = nearest::default_tip_for(&state.cache, &repo, repo_id, order, tip);
    let base_tip = entry
        .base
        .as_deref()
        .and_then(|b| refs::resolve_commit(&repo, b));
    let suggested = match (tip, &base_tip) {
        (Some(tip), Some(base)) => {
            history::stack(&repo, branch, tip, base, default_tip.as_deref())?.suggested
        }
        _ => Vec::new(),
    };
    let defaults = default_candidates(state, &repo, repo_id, order, branch, tip)?;
    let mut branches: Vec<String> = refs::local_branches(&repo)?
        .into_iter()
        .map(|b| b.name)
        .filter(|name| Some(name.as_str()) != branch)
        .collect();
    branches.sort();
    let in_defaults = |name: &str| {
        defaults
            .as_ref()
            .is_some_and(|d| d.candidates.iter().any(|c| c.name == name))
    };
    let mut remotes: Vec<String> = refs::remote_branches(&repo)?
        .into_iter()
        .filter(|r| !in_defaults(r))
        .collect();
    // The remote branch with the entry's own name first.
    if let Some(b) = branch {
        if let Some(i) = remotes
            .iter()
            .position(|r| r.split_once('/').is_some_and(|(_, rest)| rest == b))
        {
            let same = remotes.remove(i);
            remotes.insert(0, same);
        }
    }

    log::info!(
        "base options {key}: {:.0} ms · {} suggested, {} branches, {} remotes",
        started.elapsed().as_secs_f64() * 1000.0,
        suggested.len(),
        branches.len(),
        remotes.len()
    );
    Ok(BaseOptions {
        current: entry.base,
        suggested,
        defaults,
        branches,
        remotes,
        tags: refs::tags(&repo)?,
    })
}

/// The Default section: the base branch's upstream for the base branch itself; otherwise the
/// default base, in both forms when it has a local and a remote one (T13.1).
fn default_candidates(
    state: &AppState,
    repo: &crate::git::Repo,
    repo_id: &str,
    order: &[String],
    branch: Option<&str>,
    tip: Option<&str>,
) -> Result<Option<DefaultCandidates>, AppError> {
    let Some(def) = refs::default_base(repo, order) else {
        return Ok(None);
    };
    let is_remote = |name: &str| repo.find_reference(&format!("refs/remotes/{name}")).is_ok();
    let single = |name: String, source: String| -> Result<DefaultCandidates, AppError> {
        let ahead = match (tip, refs::resolve_commit(repo, &name)) {
            (Some(tip), Some(base)) => history::ahead_of(repo, tip, &base)?,
            _ => None,
        };
        Ok(DefaultCandidates {
            source,
            candidates: vec![BaseCandidate {
                remote: is_remote(&name),
                unrelated: tip.is_some() && ahead.is_none(),
                auto: tip.is_none() || ahead.is_some(),
                name,
                ahead,
                same_as: None,
            }],
        })
    };
    if branch.is_some()
        && branch.map(str::to_string) == Some(refs::base_branch_name(repo, &def.name))
    {
        let b = branch.unwrap_or_default();
        return refs::upstream_of(repo, b)
            .map(|up| single(up, "upstream".to_string()))
            .transpose();
    }
    let Some(((local, local_tip), (remote, remote_tip))) = def.pair() else {
        return single(def.name.clone(), def.source.clone()).map(Some);
    };
    let found = match tip {
        Some(tip) => nearest::nearest_default(&state.cache, repo, repo_id, &def, tip)?,
        None => None,
    };
    let same = local_tip == remote_tip;
    let candidate = |name: &str, other: &str, ahead: Option<u32>, side: Side| BaseCandidate {
        name: name.to_string(),
        remote: side == Side::Remote,
        ahead,
        same_as: same.then(|| other.to_string()),
        unrelated: tip.is_some() && ahead.is_none(),
        auto: found.is_some_and(|f| f.pick == Some(side)),
    };
    Ok(Some(DefaultCandidates {
        source: def.source.clone(),
        candidates: vec![
            candidate(
                local,
                remote,
                found.and_then(|f| f.local_ahead),
                Side::Local,
            ),
            candidate(
                remote,
                local,
                found.and_then(|f| f.remote_ahead),
                Side::Remote,
            ),
        ],
    }))
}

/// Saves the base for one branch (every place it appears uses it); picking a Default row stores
/// it too. `None` ("Use automatic default") removes it. The repo is rescanned so open screens
/// update.
pub fn set_branch_base(
    state: &AppState,
    key: &str,
    base: Option<&str>,
) -> Result<Config, AppError> {
    let (repo_id, _, _) = parse_key(key)?;
    let snapshot = config::snapshot(state);
    repo_of(&snapshot, repo_id)?;
    let config = config::update(state, |config| {
        match base.map(str::trim).filter(|b| !b.is_empty()) {
            Some(b) => {
                config.branch_bases.insert(key.to_string(), b.to_string());
            }
            _ => {
                config.branch_bases.remove(key);
            }
        }
        Ok(config.clone())
    })?;
    scan::rescan_repo(state, repo_id, UpdateReason::Rescan, None);
    Ok(config)
}

/// Whether the commit still exists in the repo (a deleted branch's last known tip).
pub fn commit_exists(state: &AppState, repo_id: &str, sha: &str) -> Result<bool, AppError> {
    Ok(verify_ref(state, repo_id, &format!("{sha}^{{commit}}"))?.is_some())
}

/// Full SHA of the commit `rev` names in the repo, if any.
pub fn verify_ref(state: &AppState, repo_id: &str, rev: &str) -> Result<Option<String>, AppError> {
    let config = config::snapshot(state);
    let repo_cfg = repo_of(&config, repo_id)?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    Ok(refs::resolve_commit(&repo, rev))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_split_into_branch_or_worktree() {
        assert_eq!(
            parse_key("r_1:feat/x").unwrap(),
            ("r_1", Some("feat/x"), None)
        );
        assert_eq!(
            parse_key("r_1:@/wt/a:b").unwrap(),
            ("r_1", None, Some("/wt/a:b"))
        );
        assert!(parse_key("nokey").is_err());
    }
}
