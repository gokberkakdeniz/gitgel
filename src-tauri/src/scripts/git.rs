//! Git actions (SPEC §0, §15 "Writing stashes"): Gitgel's own writes, made by the user's `git`
//! on the scripts' runner. The command text is fixed here; values (folders, the message) go in
//! `GITGEL_*` variables, quoted, so nothing typed or read from disk is ever run as shell. Folders
//! come from the repository's worktree list, never from the frontend.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::config;
use crate::config::new_id;
use crate::error::AppError;
use crate::git::{stash, worktrees};
use crate::model::{entry_key, EntryRef, ScriptRun, UpdateReason};
use crate::scan;
use crate::state::{lock, AppState};

use super::run::{self, Launch};

/// `script_id` of every git action's run; the rest names the action.
pub const ACTION_PREFIX: &str = "git:";
const ICON: &str = "package";

/// A repository as a git action needs it.
struct Repo {
    id: String,
    name: String,
    /// As configured; the pool's key.
    path: PathBuf,
    /// The main worktree's folder.
    main: PathBuf,
    trees: Vec<worktrees::WorktreeInfo>,
}

fn open_repo(state: &AppState, repo_id: &str) -> Result<Repo, AppError> {
    let config = config::snapshot(state);
    let cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let shared = state.pool.get(Path::new(&cfg.path))?;
    let repo = lock(&shared);
    let trees = worktrees::list_worktrees(&state.pool, &repo)?;
    let main = trees
        .iter()
        .find(|w| w.name.is_none())
        .map(|w| w.path.clone())
        .unwrap_or_else(|| PathBuf::from(&cfg.path));
    Ok(Repo {
        id: repo_id.to_string(),
        name: Path::new(&cfg.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: PathBuf::from(&cfg.path),
        main,
        trees,
    })
}

impl Repo {
    /// The worktree an entry is checked out in: by branch, or by folder for a detached HEAD.
    fn tree_of(&self, entry: &EntryRef) -> Option<&worktrees::WorktreeInfo> {
        let wanted = entry
            .worktree_path
            .as_deref()
            .and_then(|p| Path::new(p).canonicalize().ok());
        self.trees.iter().find(|w| match &entry.branch {
            Some(b) => w.branch.as_deref() == Some(b.as_str()),
            None => Some(&w.path) == wanted.as_ref(),
        })
    }

    /// `web-app / feat/x` (the short SHA when detached).
    fn label(&self, tree: &worktrees::WorktreeInfo) -> String {
        let branch = tree
            .branch
            .clone()
            .unwrap_or_else(|| tree.head.chars().take(7).collect());
        format!("{} / {branch}", self.name)
    }

    fn not_busy(&self, state: &AppState) -> Result<(), AppError> {
        if run::git_action_running(state, &self.id) {
            return Err(AppError::Invalid(format!(
                "Another git action is running in {}.",
                self.name
            )));
        }
        Ok(())
    }

    /// `stash@{index}` must still be the stash the screen showed; if not, the screen is behind,
    /// so the repo is rescanned too.
    fn check_stash(&self, state: &AppState, index: u32, sha: &str) -> Result<(), AppError> {
        let now = {
            let shared = state.pool.get(&self.path)?;
            let repo = lock(&shared);
            stash::sha_at(&repo, index)?
        };
        if now.as_deref() != Some(sha) {
            scan::rescan_repo(state, &self.id, UpdateReason::Rescan, None);
            return Err(AppError::Invalid(
                "The stash list changed. Pick the stash again.".into(),
            ));
        }
        Ok(())
    }
}

/// One entry of Stash changes (P4): what to stash in its worktree.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPush {
    #[serde(flatten)]
    pub entry: EntryRef,
    /// The files picked, relative to the worktree (a rename's old path too); `None`: all of them.
    pub paths: Option<Vec<String>>,
    /// Untracked files go too (`--include-untracked`).
    pub untracked: bool,
}

/// How one `git stash push` of the command is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PushStep {
    pub untracked: bool,
    /// Pathspecs (`$GITGEL_PATH_<step>_<n>`); 0: the whole worktree.
    pub paths: usize,
    /// Staged files that were not picked (`$GITGEL_UNSTAGE_<step>_<n>`). git puts every staged
    /// change in a stash, so these are taken out of a copy of the index (`$GITGEL_INDEX_<step>`)
    /// that the stash is made from; the real index then drops the picked files only.
    pub unstage: usize,
}

/// `git stash push` in each entry's worktree, one after another, stopping at the first failure.
pub fn stash_push(
    state: &AppState,
    pushes: Vec<StashPush>,
    message: String,
) -> Result<ScriptRun, AppError> {
    if pushes.is_empty() {
        return Err(AppError::Invalid("Nothing to stash.".into()));
    }
    let mut repos: Vec<Repo> = Vec::new();
    let mut steps: Vec<(PathBuf, String, String)> = Vec::new(); // folder, label, entry key
    let mut env: Vec<(String, String)> = Vec::new();
    let mut shape: Vec<PushStep> = Vec::new();
    let mut temp: Vec<PathBuf> = Vec::new(); // index copies, removed when the run ends
    for (i, push) in pushes.iter().enumerate() {
        let entry = &push.entry;
        let paths = push.paths.as_deref().unwrap_or_default();
        if push.paths.is_some() && paths.is_empty() {
            return Err(AppError::Invalid("Pick at least one file.".into()));
        }
        if paths.iter().any(|p| p.is_empty() || p.contains('\0')) {
            return Err(AppError::Invalid("A picked file has no valid path.".into()));
        }
        for (j, path) in paths.iter().enumerate() {
            env.push((format!("GITGEL_PATH_{}_{}", i + 1, j + 1), path.clone()));
        }
        shape.push(PushStep {
            untracked: push.untracked,
            paths: paths.len(),
            unstage: 0,
        });
        if !repos.iter().any(|r| r.id == entry.repo_id) {
            let repo = open_repo(state, &entry.repo_id)?;
            repo.not_busy(state)?;
            repos.push(repo);
        }
        let repo = repos
            .iter()
            .find(|r| r.id == entry.repo_id)
            .expect("opened");
        let tree = repo.tree_of(entry).ok_or_else(|| {
            AppError::Invalid(format!(
                "{} / {} is not checked out.",
                repo.name,
                entry.branch.as_deref().unwrap_or("detached HEAD")
            ))
        })?;
        steps.push((
            tree.path.clone(),
            repo.label(tree),
            entry_key(
                &entry.repo_id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
        ));
        // Picked files with other staged changes: stash from a copy of the index without them.
        if !paths.is_empty() {
            let (staged, index) = {
                let shared = state.pool.get(&tree.path)?;
                let wt = lock(&shared);
                worktrees::staged(&wt)?
            };
            let keep: Vec<&String> = staged.iter().filter(|p| !paths.contains(p)).collect();
            if !keep.is_empty() {
                let copy = std::env::temp_dir().join(format!("gitgel-{}.index", new_id("stash")));
                std::fs::copy(&index, &copy)?;
                env.push((
                    format!("GITGEL_INDEX_{}", i + 1),
                    copy.to_string_lossy().into_owned(),
                ));
                for (k, p) in keep.iter().enumerate() {
                    env.push((format!("GITGEL_UNSTAGE_{}_{}", i + 1, k + 1), (*p).clone()));
                }
                shape[i].unstage = keep.len();
                temp.push(copy);
            }
        }
    }
    let message = message.trim().to_string();
    env.extend(steps.iter().enumerate().map(|(i, (folder, _, _))| {
        (
            format!("GITGEL_FOLDER_{}", i + 1),
            folder.to_string_lossy().into_owned(),
        )
    }));
    // Picked paths are file names, never pathspec magic (`:(glob)`, `*`).
    env.push(("GIT_LITERAL_PATHSPECS".into(), "1".into()));
    if !message.is_empty() {
        env.push(("GITGEL_MESSAGE".into(), message.clone()));
    }
    let one = steps.len() == 1;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-push"),
            name: "Stash changes".into(),
            icon: ICON.into(),
            entry_key: if one {
                steps[0].2.clone()
            } else {
                format!("{ACTION_PREFIX}stash-push")
            },
            repo_label: if one {
                steps[0].1.clone()
            } else {
                format!("{} entries", steps.len())
            },
            repo_id: repos[0].id.clone(),
            also_rescan: repos[1..].iter().map(|r| r.id.clone()).collect(),
            folder: steps[0].0.clone(),
            command: push_command(&shape, !message.is_empty()),
            env: with_git_env(env),
            cleanup: temp,
        },
    )
}

/// `git stash apply` (or `pop`) of `stash@{index}` in one of the repository's worktrees.
pub fn stash_apply(
    state: &AppState,
    repo_id: &str,
    index: u32,
    sha: &str,
    worktree_path: &str,
    pop: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let wanted = Path::new(worktree_path).canonicalize()?;
    let tree = repo
        .trees
        .iter()
        .find(|w| w.path == wanted)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "{worktree_path} is not a worktree of {}.",
                repo.name
            ))
        })?;
    repo.check_stash(state, index, sha)?;
    let verb = if pop { "pop" } else { "apply" };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-{verb}"),
            name: format!("{} stash@{{{index}}}", if pop { "Pop" } else { "Apply" }),
            icon: ICON.into(),
            entry_key: entry_key(
                &repo.id,
                tree.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: format!("git stash {verb} 'stash@{{{index}}}'"),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// `git stash drop` of `stash@{index}`, in the repository folder.
pub fn stash_drop(
    state: &AppState,
    repo_id: &str,
    index: u32,
    sha: &str,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    repo.check_stash(state, index, sha)?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-drop"),
            name: format!("Drop stash@{{{index}}}"),
            icon: ICON.into(),
            entry_key: repo.id.clone(),
            repo_label: repo.name.clone(),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: format!("git stash drop 'stash@{{{index}}}'"),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// `git -C "$GITGEL_FOLDER_1" stash push … [-- "$GITGEL_PATH_1_1" …] && git -C "$GITGEL_FOLDER_2" …`:
/// only fixed text and quoted variables, which sh, bash, zsh and fish all read the same way.
pub(super) fn push_command(steps: &[PushStep], message: bool) -> String {
    steps
        .iter()
        .enumerate()
        .map(|(i, step)| {
            let n = i + 1;
            let git = format!("git -C \"$GITGEL_FOLDER_{n}\"");
            let list = |name: &str, count: usize| {
                (1..=count)
                    .map(|j| format!(" \"${name}_{n}_{j}\""))
                    .collect::<String>()
            };
            let mut push = String::from(" stash push");
            if step.untracked {
                push.push_str(" --include-untracked");
            }
            if message {
                push.push_str(" --message \"$GITGEL_MESSAGE\"");
            }
            if step.paths > 0 {
                push.push_str(" --");
                push.push_str(&list("GITGEL_PATH", step.paths));
            }
            if step.unstage == 0 {
                return format!("{git}{push}");
            }
            // `env` sets the variable the same way in every shell.
            let copy = format!("env GIT_INDEX_FILE=\"$GITGEL_INDEX_{n}\" {git}");
            format!(
                "{copy} reset -q --{} && {copy}{push} && {git} reset -q --{}",
                list("GITGEL_UNSTAGE", step.unstage),
                list("GITGEL_PATH", step.paths)
            )
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

/// git never waits on a pager in the pty.
fn with_git_env(mut env: Vec<(String, String)>) -> Vec<(String, String)> {
    env.push(("GIT_PAGER".into(), "cat".into()));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_commands_hold_no_values() {
        let all = PushStep {
            untracked: false,
            paths: 0,
            unstage: 0,
        };
        assert_eq!(
            push_command(&[all], false),
            r#"git -C "$GITGEL_FOLDER_1" stash push"#
        );
        let picked = PushStep {
            untracked: true,
            paths: 2,
            unstage: 0,
        };
        assert_eq!(
            push_command(&[picked, all], true),
            r#"git -C "$GITGEL_FOLDER_1" stash push --include-untracked --message "$GITGEL_MESSAGE" -- "$GITGEL_PATH_1_1" "$GITGEL_PATH_1_2" && git -C "$GITGEL_FOLDER_2" stash push --message "$GITGEL_MESSAGE""#
        );
        let around = PushStep {
            untracked: false,
            paths: 1,
            unstage: 1,
        };
        assert_eq!(
            push_command(&[around], false),
            r#"env GIT_INDEX_FILE="$GITGEL_INDEX_1" git -C "$GITGEL_FOLDER_1" reset -q -- "$GITGEL_UNSTAGE_1_1" && env GIT_INDEX_FILE="$GITGEL_INDEX_1" git -C "$GITGEL_FOLDER_1" stash push -- "$GITGEL_PATH_1_1" && git -C "$GITGEL_FOLDER_1" reset -q -- "$GITGEL_PATH_1_1""#
        );
    }
}
