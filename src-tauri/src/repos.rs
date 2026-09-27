//! Changing the repository list and the settings. Every change rescans what it affects and
//! updates the watched folders.

use std::path::Path;

use crate::config;
use crate::error::AppError;
use crate::git::inspect;
use crate::model::{Config, DuplicateOf, FolderKind, RepoConfig, Settings, UpdateReason};
use crate::scan;
use crate::state::{lock, AppState};
use crate::timing::Timings;
use crate::watch;

/// Adds the main repository of every `repo` / `resolved` folder; duplicates and non-repos are
/// skipped.
pub fn add_repos(state: &AppState, paths: &[String]) -> Result<Config, AppError> {
    let mut t = Timings::start();
    let mut added = Vec::new();
    let config = t.time("inspect + save", || {
        config::update(state, |config| {
            for check in inspect::inspect_folders(paths, config) {
                if let (FolderKind::Repo | FolderKind::Resolved, Some(path)) =
                    (check.kind, check.repo_path)
                {
                    let id = config::new_id("r");
                    added.push(id.clone());
                    config.repos.push(RepoConfig { id, path });
                }
            }
            Ok(config.clone())
        })
    })?;
    for id in &added {
        t.time("scan", || {
            scan::rescan_repo(state, id, UpdateReason::Rescan, None)
        });
    }
    if !added.is_empty() {
        t.time("watch", || watch::sync_watches(state));
    }
    log::info!(
        "add repos: {t} · {} added of {} folders",
        added.len(),
        paths.len()
    );
    Ok(config)
}

/// Points a repository whose folder moved at its new location. Every entry of it recovers.
pub fn locate_repo(state: &AppState, repo_id: &str, path: &str) -> Result<Config, AppError> {
    let snapshot = config::snapshot(state);
    if !snapshot.repos.iter().any(|r| r.id == repo_id) {
        return Err(AppError::NotFound(format!("repository {repo_id}")));
    }
    // Inspect against the other repos only, so the old entry does not count as a duplicate.
    let mut others = snapshot.clone();
    others.repos.retain(|r| r.id != repo_id);
    let check = inspect::inspect_folders(&[path.to_string()], &others)
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotARepo(path.to_string()))?;
    let root = match (check.kind, check.duplicate_of, check.repo_path) {
        (FolderKind::Repo | FolderKind::Resolved, _, Some(root)) => root,
        (FolderKind::Duplicate, Some(DuplicateOf::Config), Some(root)) => {
            let name = others
                .repos
                .iter()
                .find(|r| Path::new(&r.path) == Path::new(&root))
                .map(|r| scan::repo_name(&r.path))
                .unwrap_or(root);
            return Err(AppError::Forbidden(format!("Already added as {name}")));
        }
        _ => return Err(AppError::NotARepo("Not a git repository".into())),
    };
    let config = config::update(state, |config| {
        if let Some(r) = config.repos.iter_mut().find(|r| r.id == repo_id) {
            r.path = root.clone();
        }
        Ok(config.clone())
    })?;
    state.pool.retain_existing();
    scan::rescan_repo(state, repo_id, UpdateReason::Rescan, None);
    watch::sync_watches(state);
    Ok(config)
}

/// Removes a repository, its saved bases and its project entries. Nothing on disk is touched.
pub fn remove_repo(state: &AppState, repo_id: &str) -> Result<Config, AppError> {
    let prefix = format!("{repo_id}:");
    let mut path = None;
    let config = config::update(state, |config| {
        let before = config.repos.len();
        path = config
            .repos
            .iter()
            .find(|r| r.id == repo_id)
            .map(|r| r.path.clone());
        config.repos.retain(|r| r.id != repo_id);
        if config.repos.len() == before {
            return Err(AppError::NotFound(format!("repository {repo_id}")));
        }
        config.branch_bases.retain(|k, _| !k.starts_with(&prefix));
        for p in &mut config.projects {
            p.entries.retain(|e| e.repo_id != repo_id);
        }
        Ok(config.clone())
    })?;
    lock(&state.last_scan).remove(repo_id);
    lock(&state.layouts).remove(repo_id);
    lock(&state.cache).forget_repo(repo_id);
    if let Some(path) = path {
        state.pool.forget(Path::new(&path));
    }
    watch::sync_watches(state);
    Ok(config)
}

/// Saves the settings, then rescans every repo (the active threshold and default base order
/// change what is listed).
pub fn update_settings(state: &AppState, settings: Settings) -> Result<Config, AppError> {
    let order: Vec<String> = settings
        .default_base_order
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if order.is_empty() {
        return Err(AppError::Forbidden(
            "the default base order is empty".into(),
        ));
    }
    if !(1..=365).contains(&settings.active_days) {
        return Err(AppError::Forbidden(
            "the active threshold must be 1–365 days".into(),
        ));
    }
    let mut rescan = false;
    let config = config::update(state, |config| {
        let next = Settings {
            default_base_order: order,
            zoom: crate::menu::clamp_zoom(settings.zoom),
            ..settings
        };
        // Only the base order and the threshold change what is listed.
        rescan = next.default_base_order != config.settings.default_base_order
            || next.active_days != config.settings.active_days;
        config.settings = next;
        Ok(config.clone())
    })?;
    if rescan {
        // scan_all emits each repo whose result changed.
        scan::scan_all(state);
        watch::sync_watches(state);
    }
    Ok(config)
}
