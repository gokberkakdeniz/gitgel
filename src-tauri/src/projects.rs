//! Project and entry commands. Names are display-only but unique (case-insensitive, trimmed).

use std::collections::HashSet;

use chrono::SecondsFormat;

use crate::config;
use crate::error::AppError;
use crate::model::{Config, EntryConfig, EntryRef, LastKnownTip, ProjectConfig, ProjectView};
use crate::scan;
use crate::state::AppState;

pub fn create_project(
    state: &AppState,
    name: &str,
    entries: &[EntryRef],
) -> Result<ProjectConfig, AppError> {
    let entries = with_tips(state, entries)?;
    config::update(state, |config| {
        let name = valid_name(config, name, None)?;
        let mut project = ProjectConfig {
            id: config::new_id("p"),
            name,
            created_at: now(),
            entries: Vec::new(),
        };
        add_new(&mut project, entries);
        config.projects.push(project.clone());
        Ok(project)
    })
}

pub fn rename_project(state: &AppState, project_id: &str, name: &str) -> Result<Config, AppError> {
    config::update(state, |config| {
        let name = valid_name(config, name, Some(project_id))?;
        find_mut(config, project_id)?.name = name;
        Ok(config.clone())
    })
}

pub fn delete_project(state: &AppState, project_id: &str) -> Result<Config, AppError> {
    config::update(state, |config| {
        let before = config.projects.len();
        config.projects.retain(|p| p.id != project_id);
        if config.projects.len() == before {
            return Err(not_found(project_id));
        }
        Ok(config.clone())
    })
}

pub fn add_entries(
    state: &AppState,
    project_id: &str,
    entries: &[EntryRef],
) -> Result<Config, AppError> {
    let entries = with_tips(state, entries)?;
    config::update(state, |config| {
        add_new(find_mut(config, project_id)?, entries);
        Ok(config.clone())
    })
}

pub fn remove_entries(
    state: &AppState,
    project_id: &str,
    keys: &[String],
) -> Result<Config, AppError> {
    config::update(state, |config| {
        find_mut(config, project_id)?
            .entries
            .retain(|e| !keys.contains(&e.key()));
        Ok(config.clone())
    })
}

/// Remembers the tip of each entry that still exists, so a deleted branch can still be shown
/// later. Saves (once) only when a tip moved or was last seen over an hour ago.
pub fn remember_tips(state: &AppState, project_id: &str, seen: &[(String, String)]) {
    let config = config::snapshot(state);
    let Some(project) = config.projects.iter().find(|p| p.id == project_id) else {
        return;
    };
    let now_ts = chrono::Utc::now();
    let stale = |e: &EntryConfig, tip: &str| match &e.last_known_tip {
        None => true,
        Some(t) if t.sha != tip => true,
        Some(t) => chrono::DateTime::parse_from_rfc3339(&t.seen_at)
            .map(|at| now_ts.signed_duration_since(at) > chrono::Duration::hours(1))
            .unwrap_or(true),
    };
    let tip_of = |key: &str| seen.iter().find(|(k, _)| k == key).map(|(_, t)| t.as_str());
    let needed = project
        .entries
        .iter()
        .any(|e| tip_of(&e.key()).is_some_and(|tip| stale(e, tip)));
    if !needed {
        return;
    }
    let result = config::update(state, |config| {
        if let Some(p) = config.projects.iter_mut().find(|p| p.id == project_id) {
            for e in &mut p.entries {
                if let Some(tip) = tip_of(&e.key()) {
                    if stale(e, tip) {
                        e.last_known_tip = Some(LastKnownTip {
                            sha: tip.to_string(),
                            seen_at: now(),
                        });
                    }
                }
            }
        }
        Ok(())
    });
    if let Err(e) = result {
        log::warn!("cannot save last known tips of {project_id}: {e}");
    }
}

/// Points an entry at another branch of the same repo (e.g. after a rename).
pub fn repoint_entry(
    state: &AppState,
    project_id: &str,
    key: &str,
    branch: &str,
) -> Result<Config, AppError> {
    let snapshot = config::snapshot(state);
    let project = snapshot
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| not_found(project_id))?;
    let entry = project
        .entries
        .iter()
        .find(|e| e.key() == key)
        .ok_or_else(|| AppError::NotFound(format!("entry {key}")))?;
    let repo_id = entry.repo_id.clone();
    let [fresh] = with_tips(
        state,
        &[EntryRef {
            repo_id: repo_id.clone(),
            branch: Some(branch.to_string()),
            worktree_path: None,
        }],
    )?
    .try_into()
    .map_err(|_| AppError::NotFound(format!("branch {branch}")))?;
    config::update(state, |config| {
        let project = find_mut(config, project_id)?;
        let new_key = fresh.key();
        if new_key != key && project.entries.iter().any(|e| e.key() == new_key) {
            return Err(AppError::NameConflict(format!(
                "{branch} is already in this project"
            )));
        }
        let e = project
            .entries
            .iter_mut()
            .find(|e| e.key() == key)
            .ok_or_else(|| AppError::NotFound(format!("entry {key}")))?;
        *e = fresh;
        Ok(config.clone())
    })
}

/// Every entry of the project summarized, active or not, in project order.
pub fn project_view(state: &AppState, project_id: &str) -> Result<ProjectView, AppError> {
    let config = config::snapshot(state);
    let project = config
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| not_found(project_id))?
        .clone();
    let entries = project
        .entries
        .iter()
        .map(|e| match config.repos.iter().find(|r| r.id == e.repo_id) {
            Some(repo_cfg) => scan::summarize_one(
                &state.pool,
                &state.cache,
                repo_cfg,
                &config,
                e.branch.as_deref(),
                e.worktree_path.as_deref(),
                None,
            ),
            None => scan::removed_repo_summary(e, &config),
        })
        .collect::<Vec<_>>();
    remember_tips(state, project_id, &seen_tips(&entries));
    Ok(ProjectView { project, entries })
}

/// `(entry key, current tip)` of the summaries whose branch or worktree still exists.
pub fn seen_tips(summaries: &[crate::model::EntrySummary]) -> Vec<(String, String)> {
    summaries
        .iter()
        .filter(|s| s.state != crate::model::EntryState::BranchDeleted)
        .filter_map(|s| Some((s.key.clone(), s.head_sha.clone()?)))
        .collect()
}

/// Entries as stored: a branch entry keeps no worktree path; each remembers the current tip.
fn with_tips(state: &AppState, refs: &[EntryRef]) -> Result<Vec<EntryConfig>, AppError> {
    let config = config::snapshot(state);
    refs.iter()
        .map(|r| {
            let repo_cfg = config
                .repos
                .iter()
                .find(|c| c.id == r.repo_id)
                .ok_or_else(|| AppError::NotFound(format!("repository {}", r.repo_id)))?;
            let worktree_path = if r.branch.is_some() {
                None
            } else {
                r.worktree_path.clone()
            };
            let tip = scan::current_tip(
                &state.pool,
                repo_cfg,
                r.branch.as_deref(),
                worktree_path.as_deref(),
            );
            Ok(EntryConfig {
                repo_id: r.repo_id.clone(),
                branch: r.branch.clone(),
                worktree_path,
                last_known_tip: tip.map(|sha| LastKnownTip {
                    sha,
                    seen_at: now(),
                }),
            })
        })
        .collect()
}

/// Appends entries whose key is not in the project yet.
fn add_new(project: &mut ProjectConfig, entries: Vec<EntryConfig>) {
    let mut keys: HashSet<String> = project.entries.iter().map(EntryConfig::key).collect();
    for e in entries {
        if keys.insert(e.key()) {
            project.entries.push(e);
        }
    }
}

/// Trimmed, non-empty and unique among the other projects (case-insensitive).
fn valid_name(config: &Config, name: &str, except: Option<&str>) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Forbidden("project name is empty".into()));
    }
    let lower = name.to_lowercase();
    let taken = config
        .projects
        .iter()
        .any(|p| Some(p.id.as_str()) != except && p.name.trim().to_lowercase() == lower);
    if taken {
        return Err(AppError::NameConflict(name.to_string()));
    }
    Ok(name.to_string())
}

fn find_mut<'a>(config: &'a mut Config, id: &str) -> Result<&'a mut ProjectConfig, AppError> {
    config
        .projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| not_found(id))
}

fn not_found(id: &str) -> AppError {
    AppError::NotFound(format!("project {id}"))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(names: &[&str]) -> Config {
        let mut c = Config::default();
        for (i, n) in names.iter().enumerate() {
            c.projects.push(ProjectConfig {
                id: format!("p_{i}"),
                name: n.to_string(),
                created_at: String::new(),
                entries: Vec::new(),
            });
        }
        c
    }

    fn entry(branch: &str) -> EntryConfig {
        EntryConfig {
            repo_id: "r_1".into(),
            branch: Some(branch.into()),
            worktree_path: None,
            last_known_tip: None,
        }
    }

    #[test]
    fn names_are_trimmed_and_unique_ignoring_case() {
        let c = config_with(&["Session auth refresh"]);
        assert_eq!(valid_name(&c, "  New one ", None).unwrap(), "New one");
        assert!(matches!(
            valid_name(&c, "session AUTH refresh ", None),
            Err(AppError::NameConflict(_))
        ));
        // Renaming a project to (a case variant of) its own name is fine.
        assert_eq!(
            valid_name(&c, "Session Auth Refresh", Some("p_0")).unwrap(),
            "Session Auth Refresh"
        );
    }

    #[test]
    fn empty_name_is_refused() {
        let c = config_with(&[]);
        assert!(matches!(
            valid_name(&c, "   ", None),
            Err(AppError::Forbidden(_))
        ));
    }

    #[test]
    fn repeated_entries_are_added_once() {
        let mut c = config_with(&["P"]);
        let p = &mut c.projects[0];
        add_new(p, vec![entry("a"), entry("b"), entry("a")]);
        add_new(p, vec![entry("b"), entry("c")]);
        let keys: Vec<_> = p.entries.iter().map(EntryConfig::key).collect();
        assert_eq!(keys, ["r_1:a", "r_1:b", "r_1:c"]);
    }

    #[test]
    fn find_and_delete() {
        let mut c = config_with(&["A", "B"]);
        assert!(find_mut(&mut c, "p_1").is_ok());
        assert!(matches!(
            find_mut(&mut c, "p_9"),
            Err(AppError::NotFound(_))
        ));
        c.projects.retain(|p| p.id != "p_0");
        assert_eq!(c.projects.len(), 1);
    }
}
