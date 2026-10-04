//! A branch's history for the History screen (§16): pages, search, the refs it can show.

use std::path::Path;

use crate::config;
use crate::error::AppError;
use crate::git::{history, refs};
use crate::model::{HistoryPage, HistoryRefs, RepoConfig};
use crate::state::{lock, AppState};
use crate::timing::Timings;

/// The longest page asked for at once (the list grows 200 at a time).
const MAX_LIMIT: usize = 20_000;

/// Up to `limit` commits of `rev`, newest first. `base`: the entry's base, which splits the list
/// at the base line. `query`: words that must all match (search).
pub fn get_history(
    state: &AppState,
    repo_id: &str,
    rev: &str,
    base: Option<&str>,
    query: &str,
    limit: usize,
) -> Result<HistoryPage, AppError> {
    let repo_cfg = repo_of(state, repo_id)?;
    let terms: Vec<String> = history::search_words(query)
        .split(' ')
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();
    let mut t = Timings::start();
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let fetched_at = refs::fetched_at(&repo);
    let Some(tip) = refs::resolve_commit(&repo, rev) else {
        return Ok(HistoryPage {
            rev: rev.to_string(),
            tip: None,
            commits: Vec::new(),
            more: false,
            total: None,
            ahead: None,
            merge_base: None,
            fetched_at,
        });
    };
    let split = match base.and_then(|b| refs::resolve_commit(&repo, b)) {
        Some(base_tip) => Some(t.time("base", || history::base_split(&repo, &tip, &base_tip))?),
        None => None,
    };
    let walked = t.time("walk", || {
        history::walk(
            &repo,
            &tip,
            split.as_ref().map(|s| &s.ahead),
            &terms,
            limit.clamp(1, MAX_LIMIT),
        )
    })?;
    let total = if terms.is_empty() {
        let cached = lock(&state.cache).commit_count(repo_id, &tip);
        match cached {
            Some(n) => Some(n),
            None => {
                let n = t.time("count", || history::commit_count(&repo, &tip))?;
                lock(&state.cache).put_commit_count(repo_id, &tip, n);
                Some(n)
            }
        }
    } else {
        None
    };
    log::info!(
        "history {rev} in {}: {t} · {} commits{}",
        repo_cfg.path,
        walked.commits.len(),
        if terms.is_empty() { "" } else { " (search)" }
    );
    Ok(HistoryPage {
        rev: rev.to_string(),
        tip: Some(tip),
        commits: walked.commits,
        more: walked.more,
        total,
        ahead: split.as_ref().map(|s| s.ahead.len() as u32),
        merge_base: split.and_then(|s| s.merge_base),
        fetched_at,
    })
}

/// Local and remote-tracking branches, for History's branch button.
pub fn get_history_refs(state: &AppState, repo_id: &str) -> Result<HistoryRefs, AppError> {
    let repo_cfg = repo_of(state, repo_id)?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let mut branches: Vec<String> = refs::local_branches(&repo)?
        .into_iter()
        .map(|b| b.name)
        .collect();
    branches.sort();
    Ok(HistoryRefs {
        branches,
        remotes: refs::remote_branches(&repo)?,
    })
}

fn repo_of(state: &AppState, repo_id: &str) -> Result<RepoConfig, AppError> {
    config::snapshot(state)
        .repos
        .into_iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))
}
