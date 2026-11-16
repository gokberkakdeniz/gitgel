//! A branch's history for the History screen (§16): pages, search, the refs it can show.

use std::path::Path;

use crate::config;
use crate::error::AppError;
use crate::git::{blame, history, refs};
use crate::model::{Blame, HistoryPage, RepoConfig};
use crate::state::{lock, AppState};
use crate::timing::Timings;

/// The longest page asked for at once (the list grows 200 at a time).
const MAX_LIMIT: usize = 20_000;

/// Up to `limit` commits of `rev`, newest first. `base`: the entry's base, which splits the list
/// at the base line. `query`: words that must all match (search), or `path:<file>` for the
/// commits that changed that file (its history).
pub fn get_history(
    state: &AppState,
    repo_id: &str,
    rev: &str,
    base: Option<&str>,
    query: &str,
    limit: usize,
) -> Result<HistoryPage, AppError> {
    let repo_cfg = repo_of(state, repo_id)?;
    let path = file_query(query);
    let terms: Vec<String> = history::search_words(if path.is_some() { "" } else { query })
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
            ahead: None,
            fetched_at,
            upstream: None,
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
            path,
            limit.clamp(1, MAX_LIMIT),
        )
    })?;
    // A local branch syncs with its remote; without it there, its commits on top of the base
    // are what the remote lacks.
    let upstream = refs::resolve_commit(&repo, &format!("refs/heads/{rev}")).and_then(|_| {
        let ahead = split.as_ref().map(|s| s.ahead.len() as u32);
        crate::scan::branch_upstream(&repo, &repo_cfg.path, rev, &tip, ahead)
    });
    log::info!(
        "history {rev} in {}: {t} · {} commits{}",
        repo_cfg.path,
        walked.commits.len(),
        if path.is_some() {
            " (file)"
        } else if terms.is_empty() {
            ""
        } else {
            " (search)"
        }
    );
    Ok(HistoryPage {
        rev: rev.to_string(),
        tip: Some(tip),
        commits: walked.commits,
        more: walked.more,
        ahead: split.map(|s| s.ahead.len() as u32),
        fetched_at,
        upstream,
    })
}

/// Who last changed each line of `path` as `rev` has it (§5 "Blame"); with `content`, of that
/// text against `rev`.
pub fn get_blame(
    state: &AppState,
    repo_id: &str,
    rev: &str,
    path: &str,
    content: Option<&str>,
) -> Result<Blame, AppError> {
    let repo_cfg = repo_of(state, repo_id)?;
    let folder = Path::new(&repo_cfg.path);
    let commit = {
        let shared = state.pool.get(folder)?;
        let repo = lock(&shared);
        refs::resolve_commit(&repo, rev)
    };
    let Some(commit) = commit else {
        return Ok(Blame::default());
    };
    let started = std::time::Instant::now();
    let found = blame::blame(folder, &commit, path, content)?;
    log::info!(
        "blame {path} at {}: {:.1} ms · {} hunks",
        &commit[..7],
        started.elapsed().as_secs_f64() * 1000.0,
        found.hunks.len()
    );
    Ok(found)
}

/// The file of a `path:<file>` query (the whole rest of it, spaces included).
fn file_query(query: &str) -> Option<&str> {
    let path = query.trim().strip_prefix("path:")?.trim().trim_matches('/');
    (!path.is_empty()).then_some(path)
}

fn repo_of(state: &AppState, repo_id: &str) -> Result<RepoConfig, AppError> {
    config::snapshot(state)
        .repos
        .into_iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))
}
