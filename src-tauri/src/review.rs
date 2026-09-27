//! Review data for a project or a single branch.

use std::path::Path;

use crate::cache::CommittedDetail;
use crate::config;
use crate::error::AppError;
use crate::git::{diff, history, refs, Repo};
use crate::model::{
    CommitChanges, Config, EntryState, EntrySummary, FilesByMode, RepoConfig, ReviewData,
    ReviewGroup, ReviewTarget,
};
use crate::scan;
use crate::state::{lock, AppState};
use crate::timing::Timings;

/// Commits listed per entry.
const COMMIT_LIMIT: usize = 200;

pub fn get_review(state: &AppState, target: &ReviewTarget) -> Result<ReviewData, AppError> {
    let config = config::snapshot(state);
    match target {
        ReviewTarget::Branch {
            repo_id,
            branch,
            worktree_path,
            tip_override,
        } => {
            let repo_cfg = config
                .repos
                .iter()
                .find(|r| &r.id == repo_id)
                .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
            let mut t = Timings::start();
            let summary = t.time("summary", || {
                scan::summarize_one(
                    &state.pool,
                    &state.cache,
                    repo_cfg,
                    &config,
                    branch.as_deref(),
                    worktree_path.as_deref(),
                    tip_override.as_deref(),
                )
            });
            let mut data = ReviewData {
                groups: Vec::new(),
                not_in_review: Vec::new(),
                total_entries: 1,
            };
            let key = summary.key.clone();
            if reviewable(&summary) {
                data.groups
                    .push(group(state, &config, repo_cfg, summary, &mut t)?);
            } else {
                data.not_in_review.push(summary);
            }
            log::info!("review {key}: {t}");
            Ok(data)
        }
        ReviewTarget::Project { project_id } => {
            let project = config
                .projects
                .iter()
                .find(|p| &p.id == project_id)
                .ok_or_else(|| AppError::NotFound(format!("project {project_id}")))?;
            let mut data = ReviewData {
                groups: Vec::new(),
                not_in_review: Vec::new(),
                total_entries: project.entries.len() as u32,
            };
            let mut t = Timings::start();
            // Two entries from the same repo are two groups; project order is kept.
            for e in &project.entries {
                let Some(repo_cfg) = config.repos.iter().find(|r| r.id == e.repo_id) else {
                    data.not_in_review
                        .push(scan::removed_repo_summary(e, &config));
                    continue;
                };
                let summary = t.time("summary", || {
                    scan::summarize_one(
                        &state.pool,
                        &state.cache,
                        repo_cfg,
                        &config,
                        e.branch.as_deref(),
                        e.worktree_path.as_deref(),
                        None,
                    )
                });
                if !reviewable(&summary) {
                    data.not_in_review.push(summary);
                    continue;
                }
                match group(state, &config, repo_cfg, summary.clone(), &mut t) {
                    // A merged entry with nothing left to show is not reviewable.
                    Ok(g) if summary.state == EntryState::Merged && is_empty(&g) => {
                        data.not_in_review.push(summary)
                    }
                    Ok(g) => data.groups.push(g),
                    Err(e) => {
                        log::warn!("review of {} failed: {e}", summary.key);
                        data.not_in_review.push(EntrySummary {
                            state: EntryState::GitError,
                            error: Some(e.to_string()),
                            ..summary
                        });
                    }
                }
            }
            let mut seen: Vec<_> = data.groups.iter().map(|g| g.entry.clone()).collect();
            seen.extend(data.not_in_review.iter().cloned());
            crate::projects::remember_tips(state, project_id, &crate::projects::seen_tips(&seen));
            log::info!(
                "review project {}: {t} · {} groups, {} not in review",
                project.name,
                data.groups.len(),
                data.not_in_review.len()
            );
            Ok(data)
        }
    }
}

/// One commit's own changes (flow D7), cached by SHA.
pub fn get_commit_changes(
    state: &AppState,
    repo_id: &str,
    sha: &str,
) -> Result<CommitChanges, AppError> {
    if let Some(c) = lock(&state.cache).commit(repo_id, sha) {
        return Ok(c);
    }
    let config = config::snapshot(state);
    let repo_cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let mut t = Timings::start();
    let changes = {
        let shared = state.pool.get(Path::new(&repo_cfg.path))?;
        let repo = lock(&shared);
        t.time("diff", || diff::commit_changes(&repo, sha))?
    };
    log::info!(
        "commit {} in {}: {t} · {} files",
        &sha[..sha.len().min(7)],
        repo_cfg.path,
        changes.files.len()
    );
    lock(&state.cache).put_commit(repo_id, changes.clone());
    Ok(changes)
}

fn is_empty(g: &ReviewGroup) -> bool {
    g.files.committed.is_empty() && g.files.uncommitted.is_empty() && g.files.all.is_empty()
}

fn reviewable(s: &EntrySummary) -> bool {
    matches!(
        s.state,
        EntryState::Ok | EntryState::Detached | EntryState::Merged
    )
}

fn group(
    state: &AppState,
    config: &Config,
    repo_cfg: &RepoConfig,
    entry: EntrySummary,
    t: &mut Timings,
) -> Result<ReviewGroup, AppError> {
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let Some(tip) = entry.head_sha.clone() else {
        return Err(AppError::NotFound(format!("{} has no tip", entry.key)));
    };
    // A base branch without an upstream has nothing to compare with: only its working tree.
    let (merge_base, detail) = match entry.base.clone() {
        Some(base) => committed_layer(state, config, repo_cfg, &repo, &entry, &tip, &base, t)?,
        None => (
            None,
            CommittedDetail {
                files: Vec::new(),
                commits: Vec::new(),
                suggested: Vec::new(),
            },
        ),
    };

    // The working-tree layers come from the worktree cache (dropped when the watcher reports a
    // change there, or when HEAD moves).
    let (uncommitted, all) = match &entry.worktree_path {
        Some(wt) => {
            let wt = Path::new(wt);
            let read = |wt_repo: &Repo, t: &mut Timings| -> Result<_, AppError> {
                let uncommitted = t.time("uncommitted", || {
                    scan::cached_uncommitted(&state.cache, wt_repo, wt, &tip)
                })?;
                let all = match &merge_base {
                    Some(mb) => t.time("all", || {
                        scan::cached_all(
                            &state.cache,
                            wt_repo,
                            wt,
                            &tip,
                            mb,
                            &detail.files,
                            &uncommitted,
                        )
                    })?,
                    None => uncommitted.clone(),
                };
                Ok((uncommitted, all))
            };
            if canonical(wt) == canonical(Path::new(&repo_cfg.path)) {
                read(&repo, t)?
            } else {
                let shared = state.pool.get(wt)?;
                let wt_repo = lock(&shared);
                read(&wt_repo, t)?
            }
        }
        None => (Vec::new(), detail.files.clone()),
    };

    // The best candidate, unless it already is the base.
    let stack_hint = detail
        .suggested
        .into_iter()
        .next()
        .filter(|h| Some(&h.branch) != entry.base.as_ref());

    Ok(ReviewGroup {
        entry,
        merge_base,
        files: FilesByMode {
            committed: detail.files,
            uncommitted,
            all,
        },
        commits: detail.commits,
        stack_hint,
    })
}

fn canonical(path: &Path) -> std::path::PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

/// Merge-base and the committed files and commits of `tip` against `base`, cached by
/// (repo, tip, base tip).
#[allow(clippy::too_many_arguments)]
fn committed_layer(
    state: &AppState,
    config: &Config,
    repo_cfg: &RepoConfig,
    repo: &Repo,
    entry: &EntrySummary,
    tip: &str,
    base: &str,
    t: &mut Timings,
) -> Result<(Option<String>, CommittedDetail), AppError> {
    let base_tip = refs::resolve_commit(repo, base)
        .ok_or_else(|| AppError::NotFound(format!("base {base}")))?;
    let stats = t.time("stats", || {
        scan::committed_stats(&state.cache, &repo_cfg.id, repo, tip, &base_tip)
    })?;
    let merge_base = stats
        .merge_base
        .ok_or_else(|| AppError::NotFound("no common ancestor".into()))?;

    if let Some(detail) = lock(&state.cache).detail(&repo_cfg.id, tip, &base_tip) {
        t.add("detail cached", std::time::Duration::ZERO);
        return Ok((Some(merge_base), detail));
    }
    let default_tip = refs::resolve_default_base(repo, &config.settings.default_base_order)
        .and_then(|(name, _)| refs::resolve_commit(repo, &name));
    let stack = t.time("stack", || {
        history::stack(
            repo,
            entry.branch.as_deref(),
            tip,
            &base_tip,
            default_tip.as_deref(),
        )
    })?;
    let mut commits = t.time("commits", || {
        history::commits(repo, &base_tip, tip, COMMIT_LIMIT)
    })?;
    for c in &mut commits {
        c.from_branch = stack.from_branch.get(&c.sha).cloned();
    }
    let detail = CommittedDetail {
        files: t.time("files", || diff::committed_changes(repo, &merge_base, tip))?,
        commits,
        suggested: stack.suggested,
    };
    lock(&state.cache).put_detail(&repo_cfg.id, tip, &base_tip, detail.clone());
    Ok((Some(merge_base), detail))
}
