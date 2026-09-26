//! Base ref options and per-branch base selection.

use std::path::Path;

use crate::config;
use crate::error::AppError;
use crate::git::{history, refs};
use crate::model::{BaseOptions, Config, DefaultBase, RepoConfig, UpdateReason};
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

/// The base an entry falls back to: the repo's default base, except for the default base branch
/// itself, which is compared with its upstream (unpushed commits).
fn default_for(
    repo: &crate::git::Repo,
    repo_default: Option<(String, String)>,
    branch: Option<&str>,
) -> Option<(String, String)> {
    let base_branch = repo_default
        .as_ref()
        .map(|(name, _)| refs::base_branch_name(repo, name));
    match branch {
        Some(b) if Some(b) == base_branch.as_deref() => {
            refs::upstream_of(repo, b).map(|up| (up, "upstream".to_string()))
        }
        _ => repo_default,
    }
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
    let repo_default = refs::resolve_default_base(&repo, &config.settings.default_base_order);
    let default = default_for(&repo, repo_default.clone(), branch);
    let default_tip = repo_default
        .as_ref()
        .and_then(|(name, _)| refs::resolve_commit(&repo, name));
    let base_tip = entry
        .base
        .as_deref()
        .and_then(|b| refs::resolve_commit(&repo, b));
    let suggested = match (&entry.head_sha, &base_tip) {
        (Some(tip), Some(base)) => {
            history::stack(&repo, branch, tip, base, default_tip.as_deref())?.suggested
        }
        _ => Vec::new(),
    };
    let mut branches: Vec<String> = refs::local_branches(&repo)?
        .into_iter()
        .map(|b| b.name)
        .filter(|name| Some(name.as_str()) != branch)
        .collect();
    branches.sort();

    log::info!(
        "base options {key}: {:.0} ms · {} suggested, {} branches",
        started.elapsed().as_secs_f64() * 1000.0,
        suggested.len(),
        branches.len()
    );
    Ok(BaseOptions {
        current: entry.base,
        suggested,
        default: default.map(|(name, source)| DefaultBase { name, source }),
        branches,
        tags: refs::tags(&repo)?,
    })
}

/// Saves the base for one branch (every place it appears uses it). `None`, or the repo's
/// default, removes the override. The repo is rescanned so open screens update.
pub fn set_branch_base(
    state: &AppState,
    key: &str,
    base: Option<&str>,
) -> Result<Config, AppError> {
    let (repo_id, branch, _) = parse_key(key)?;
    let snapshot = config::snapshot(state);
    let repo_cfg = repo_of(&snapshot, repo_id)?;
    let default = {
        let shared = state.pool.get(Path::new(&repo_cfg.path))?;
        let repo = lock(&shared);
        let repo_default = refs::resolve_default_base(&repo, &snapshot.settings.default_base_order);
        default_for(&repo, repo_default, branch).map(|(n, _)| n)
    };
    let config = config::update(state, |config| {
        match base.map(str::trim).filter(|b| !b.is_empty()) {
            Some(b) if Some(b) != default.as_deref() => {
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
